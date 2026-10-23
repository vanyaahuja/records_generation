from fastapi import FastAPI
from .schemas import Record
from .docgen import render_html, render_text, fhir_bundle

app = FastAPI(title="Field-to-Record document renderer")


@app.get("/healthz")
@app.get("/readyz")
def health():
    return {"ready": True}


@app.post("/v1/render")
def render(bundle: dict):
    Record.model_validate(bundle["record"])
    return {
        "html": render_html(bundle),
        "text": render_text(bundle),
        "fhir": fhir_bundle(bundle),
    }
