import asyncio, logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import JSONResponse

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from .speech import engine, router


@asynccontextmanager
async def lifespan(app):
    try:
        await asyncio.to_thread(engine.load)
    except Exception:
        logging.getLogger("speech").warning(
            "Speech unavailable; configure local model and dependencies"
        )
    yield


app = FastAPI(title="Field-to-Record ASR", lifespan=lifespan)
app.include_router(router)


@app.get("/healthz")
def health():
    return {"status": "ok"}


@app.get("/readyz")
def ready():
    return JSONResponse(engine.status(), status_code=200 if engine.model else 503)
