import os, json, uuid, tempfile
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from dotenv import load_dotenv
from .schemas import ExtractRequest, SaveRecordRequest
from .extraction import extract_events
from .database import init_db, save_record, get_record
from .pdf_generator import create_pdf

BACKEND_DIR=Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")
app=FastAPI(title="Field-to-Record API",version="0.1.0")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:5173","http://127.0.0.1:5173"],allow_credentials=False,allow_methods=["GET","POST"],allow_headers=["*"])
init_db()

def resolve_whisper_model_path(configured_path):
    if not configured_path or not configured_path.strip():
        raise HTTPException(503,"Local Whisper is not configured. Use typed input or set WHISPER_MODEL_PATH.")
    configured_path=configured_path.strip().strip('"').strip("'")
    model_path=Path(configured_path)
    if not model_path.is_absolute():
        model_path=BACKEND_DIR / model_path
    model_path=model_path.resolve()
    if not model_path.is_dir() or not (model_path / "model.bin").is_file():
        raise HTTPException(
            503,
            f"Local Whisper model files were not found at {model_path}. Download the faster-whisper model into this folder, set WHISPER_MODEL_PATH to it, and keep each .env setting on its own line.",
        )
    return str(model_path)

@app.get("/health")
def health():
    try:
        resolve_whisper_model_path(os.getenv("WHISPER_MODEL_PATH",""))
        speech_configured=True
    except HTTPException:
        speech_configured=False
    return {"status":"ok","mode":"offline-first","speech_configured":speech_configured}

@app.post("/api/extract")
def extract(req: ExtractRequest):
    now=datetime.now(timezone.utc).isoformat()
    return {"case_id":req.case_id,"responder_id":req.responder_id,"record_status":"pending_review","narrative":req.text,
        "events":[e.model_dump(mode="json") for e in extract_events(req.text)],"recorded_at":now,"updated_at":now,
        "notice":"Rule-based candidates only. Review all fields; no clinical verification."}

@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    model_path=resolve_whisper_model_path(os.getenv("WHISPER_MODEL_PATH",""))
    content=await file.read()
    if len(content)>int(os.getenv("MAX_AUDIO_MB","25"))*1024*1024: raise HTTPException(413,"Audio exceeds configured size limit.")
    try:
        from faster_whisper import WhisperModel
    except ImportError: raise HTTPException(503,"Optional package faster-whisper is not installed.")
    tmp_path=None
    try:
        with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "audio.wav").suffix or ".wav",delete=False) as tmp:
            tmp.write(content); tmp_path=tmp.name
        model=WhisperModel(model_path,device=os.getenv("WHISPER_DEVICE","cpu"),compute_type=os.getenv("WHISPER_COMPUTE_TYPE","int8"),local_files_only=True)
        segments,info=model.transcribe(tmp_path,vad_filter=True)
        transcript=" ".join(s.text.strip() for s in segments).strip()
        return {"text":transcript,"language":info.language,"duration":info.duration,"notice":"Check the transcript for medication names, numbers, units and times before extraction."}
    except Exception as exc: raise HTTPException(500,f"Local transcription failed: {type(exc).__name__}: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path): os.unlink(tmp_path)

@app.post("/api/records")
def create_record(req: SaveRecordRequest):
    rid=str(uuid.uuid4()); now=datetime.now(timezone.utc).isoformat()
    payload={"case_id":req.case_id,"responder_id":req.responder_id,"record_status":req.record_status,"narrative":req.narrative,
        "events":[e.model_dump(mode="json") for e in req.events],"recorded_at":now,"updated_at":now,"reviewer_id":req.reviewer_id}
    meta=save_record(rid,req.case_id,req.responder_id,payload,req.reviewer_id or req.responder_id)
    return {**meta,"record_status":req.record_status}

@app.get("/api/records/{record_id}")
def read_record(record_id:str):
    bundle=get_record(record_id)
    if not bundle: raise HTTPException(404,"Record not found.")
    return bundle

@app.get("/api/records/{record_id}/json")
def export_json(record_id:str):
    bundle=get_record(record_id)
    if not bundle: raise HTTPException(404,"Record not found.")
    return Response(json.dumps(bundle,indent=2,ensure_ascii=False),media_type="application/json",headers={"Content-Disposition":f'attachment; filename="field-record-{record_id}.json"'})

@app.get("/api/records/{record_id}/pdf")
def export_pdf(record_id:str):
    bundle=get_record(record_id)
    if not bundle: raise HTTPException(404,"Record not found.")
    return Response(create_pdf(bundle),media_type="application/pdf",headers={"Content-Disposition":f'attachment; filename="field-record-{record_id}.pdf"'})
