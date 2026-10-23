"""Feed real synthetic audio at real-time speed through the WebSocket endpoint."""

import json, os, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["WHISPER_MODEL_PATH"] = str(ROOT / "models/whisper-tiny.en")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["WARM_SPEECH"] = "1"
from fastapi.testclient import TestClient
from faster_whisper.audio import decode_audio
from app.main import app
import numpy as np

with tempfile.TemporaryDirectory() as temp:
    os.environ["DATABASE_PATH"] = str(Path(temp) / "stream.sqlite3")
    os.environ.pop("DB_DSN", None)
    audio = decode_audio(str(ROOT / "data/audio/medication.wav"))
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes() + bytes(16000 * 2)
    with TestClient(app) as client, client.websocket_connect("/api/live") as ws:
        message = ws.receive_json()
        while message["type"] != "ready":
            message = ws.receive_json()
        started = time.perf_counter()

        def send():
            for offset in range(0, len(pcm), 3200):
                ws.send_bytes(pcm[offset : offset + 3200])
                time.sleep(0.1)
            ws.send_text("stop")

        producer = threading.Thread(target=send)
        producer.start()
        results = []
        while True:
            result = ws.receive_json()
            result["since_start_ms"] = round((time.perf_counter() - started) * 1000, 2)
            results.append(result)
            if result["type"] == "complete":
                break
        producer.join()
    report = {
        "synthetic_audio": True,
        "model": "tiny.en",
        "first_nonempty_partial_ms": next(
            (
                r["since_start_ms"]
                for r in results
                if r["type"] == "partial" and r.get("text")
            ),
            None,
        ),
        "messages": results,
    }
    directory = ROOT / "eval/reports"
    directory.mkdir(exist_ok=True)
    (directory / "stream.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "first_nonempty_partial_ms": report["first_nonempty_partial_ms"],
                "updates": [
                    {
                        "type": r["type"],
                        "text": r.get("text"),
                        "since_start_ms": r["since_start_ms"],
                        "inference_ms": r.get("inference_ms"),
                    }
                    for r in results
                ],
            },
            indent=2,
        )
    )
