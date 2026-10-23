import importlib.util, socket
from pathlib import Path
import pytest
from app.speech import engine

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "models/whisper-tiny.en"


@pytest.mark.skipif(
    not (MODEL / "model.bin").exists()
    or importlib.util.find_spec("faster_whisper") is None,
    reason="Provision the local tiny.en model and speech dependencies",
)
def test_real_local_transcription_with_outbound_sockets_forbidden(client, monkeypatch):
    monkeypatch.setenv("WHISPER_MODEL_PATH", str(MODEL))
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "1")
    monkeypatch.setattr(engine, "model", None)

    def deny(*args, **kwargs):
        raise AssertionError("Runtime network access attempted")

    monkeypatch.setattr(socket.socket, "connect", deny)
    with (ROOT / "data/audio/medication.wav").open("rb") as file:
        result = client.post(
            "/api/transcribe", files={"file": ("synthetic.wav", file, "audio/wav")}
        )
    assert result.status_code == 200, result.text
    assert "fictional" in result.json()["text"].lower()
    assert result.json()["words"] and result.json()["rtf"] > 0
