"""Stateless extraction worker for independent horizontal scaling."""

from fastapi import FastAPI
from .schemas import ExtractRequest
from .extraction import extract_events, VERSION, DRUGS
from .normalize import normalize_with_offsets
from time import perf_counter

app = FastAPI(title="Field-to-Record NLU")


@app.get("/healthz")
@app.get("/readyz")
def health():
    return {"ready": True, "lexicon_entries": len(DRUGS), "version": VERSION}


@app.post("/v1/extract")
async def extract(req: ExtractRequest):
    start = perf_counter()
    return {
        "events": [
            e.model_dump(mode="json") for e in extract_events(req.text, req.words)
        ],
        "normalized_text": normalize_with_offsets(req.text)[0],
        "model_versions": {"nlu": VERSION},
        "timings_ms": {"nlu": (perf_counter() - start) * 1000},
    }
