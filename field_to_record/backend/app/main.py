"""Local API. Typed requests never wait for speech inference."""

import asyncio, json, logging, os, time, uuid
from pathlib import Path
from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from .schemas import ExtractRequest, SaveRecordRequest, Record
from .extraction import extract_events, VERSION, DRUGS
from .normalize import normalize_with_offsets
from .database import (
    init_db,
    save_record,
    get_record,
    list_records,
    store_extraction,
    get_extraction,
    verify_audit,
    VersionConflict,
    now,
    digest,
    close_storage,
)
from .review import prepare_review
from .pdf_generator import create_pdf
from .docgen import fhir_bundle, render_html, render_text
from .speech import router as speech_router, resolve_whisper_model_path, engine

logger = logging.getLogger("field-to-record")
from .crypto import StorageLocked, cipher
from .metrics import MetricsMiddleware


@asynccontextmanager
async def lifespan(app):
    if os.getenv("RECORD_ENCRYPTION_KEY"):
        cipher(os.environ["RECORD_ENCRYPTION_KEY"])
    init_db()
    if os.getenv("WARM_SPEECH", "0") == "1":
        try:
            await asyncio.to_thread(engine.load)
        except HTTPException:
            logger.warning("Speech unavailable; typed input remains ready")
    try:
        yield
    finally:
        close_storage()


app = FastAPI(title="Field-to-Record API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080",
    ).split(","),
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)
app.include_router(speech_router)
app.add_middleware(MetricsMiddleware)


@app.exception_handler(StorageLocked)
async def storage_locked(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.get("/healthz")
def alive():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/readyz")
def ready():
    try:
        from .database import connect

        with connect() as c:
            c.execute("SELECT 1 FROM record_heads LIMIT 1")
        return {"ready": True, "lexicon_entries": len(DRUGS), "nlu": VERSION}
    except Exception:
        return JSONResponse({"ready": False}, status_code=503)


@app.get("/health")
def health():
    try:
        resolve_whisper_model_path(os.getenv("WHISPER_MODEL_PATH", ""))
        configured = True
    except HTTPException:
        configured = False
    return {
        "status": "ok",
        "mode": "offline-first",
        "speech_configured": configured,
        "speech": engine.status(),
        "nlu": VERSION,
    }


def context_check(req):
    try:
        ZoneInfo(req.tz)
        if req.encounter_date:
            date.fromisoformat(req.encounter_date)
    except (ValueError, ZoneInfoNotFoundError):
        raise HTTPException(422, "Use an ISO encounter date and an IANA time zone.")


@app.post("/api/extract")
def extract(req: ExtractRequest):
    context_check(req)
    start = time.perf_counter()
    events = [e.model_dump(mode="json") for e in extract_events(req.text, req.words)]
    normalized, _ = normalize_with_offsets(req.text)
    payload = {
        "case_id": req.case_id,
        "responder_id": req.responder_id,
        "narrative": req.text,
        "events": events,
        "encounter_date": req.encounter_date,
        "tz": req.tz,
        "model_versions": {"nlu": VERSION},
    }
    eid = store_extraction(payload)
    original = get_extraction(eid)
    return {
        **payload,
        "extraction_id": eid,
        "recorded_at": original["recorded_at"],
        "record_status": "pending_review",
        "normalized_text": normalized,
        "timings_ms": {"extract": round((time.perf_counter() - start) * 1000, 3)},
        "notice": "Candidates require individual review. Missing information stays unknown.",
    }


@app.post("/v1/extract")
async def nlu(req: ExtractRequest):
    context_check(req)
    start = time.perf_counter()
    return {
        "events": [
            e.model_dump(mode="json") for e in extract_events(req.text, req.words)
        ],
        "normalized_text": normalize_with_offsets(req.text)[0],
        "model_versions": {"nlu": VERSION},
        "timings_ms": {"nlu": round((time.perf_counter() - start) * 1000, 3)},
    }


def persist(req, rid=None):
    context_check(req)
    old = get_record(rid) if rid else None
    if rid and not old:
        raise HTTPException(404, "Record not found.")
    original = get_extraction(req.extraction_id) if req.extraction_id else None
    if req.extraction_id and not original:
        raise HTTPException(404, "Extraction not found.")
    if not original:
        raise HTTPException(
            422, "Extract the narrative before saving to preserve the original output."
        )
    if old and old["record"]["extraction_id"] != req.extraction_id:
        raise HTTPException(
            409,
            "A revision must refer to the original extraction. Start a new record for a new narrative.",
        )
    events = prepare_review(req, original)
    payload = Record(
        case_id=req.case_id,
        responder_id=req.responder_id,
        narrative=req.narrative,
        events=events,
        record_status=req.record_status,
        reviewer_id=req.reviewer_id,
        extraction_id=req.extraction_id,
        extraction_hash=digest(original),
        recorded_at=original["recorded_at"],
        updated_at=now(),
        encounter_date=req.encounter_date,
        tz=req.tz,
        model_versions={"nlu": VERSION},
    ).model_dump(mode="json")
    rid = rid or str(uuid.uuid4())
    try:
        meta = save_record(
            rid,
            req.case_id,
            req.responder_id,
            payload,
            req.reviewer_id or req.responder_id,
            action="record_revised" if old else "record_created",
            expected_version=req.expected_version,
        )
    except VersionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    return {**meta, "record_status": req.record_status}


@app.post("/api/records")
def create_record(req: SaveRecordRequest):
    return persist(req)


@app.put("/api/records/{record_id}")
def update_record(record_id: str, req: SaveRecordRequest):
    return persist(req, record_id)


@app.get("/api/records")
def history(q: str = "", limit: int = 50):
    return list_records(q, max(1, min(limit, 100)))


@app.get("/api/audit/verify")
def verify():
    return verify_audit()


@app.get("/api/records/{record_id}")
def read_record(record_id: str, version: int | None = None):
    bundle = get_record(record_id, version)
    if not bundle:
        raise HTTPException(404, "Record not found.")
    return bundle


@app.get("/api/records/{record_id}/original")
def original_record(record_id: str):
    return get_extraction(read_record(record_id)["record"]["extraction_id"])


@app.get("/api/records/{record_id}/{format}")
def export(record_id: str, format: str, version: int | None = None):
    bundle = read_record(record_id, version)
    if format == "json":
        body, media = (
            json.dumps(bundle, indent=2, ensure_ascii=False),
            "application/json",
        )
    elif format == "fhir":
        body, media = (
            json.dumps(fhir_bundle(bundle), indent=2, ensure_ascii=False),
            "application/fhir+json",
        )
    elif format == "pdf":
        body, media = create_pdf(bundle), "application/pdf"
    elif format == "html":
        body, media = render_html(bundle), "text/html"
    elif format == "text":
        body, media = render_text(bundle), "text/plain"
    else:
        raise HTTPException(404, "Unknown export format.")
    return Response(
        body,
        media_type=media,
        headers={
            "Content-Disposition": f'inline; filename="field-record-{record_id}.{format}"'
        },
    )
