import numpy as np
from app.speech import engine


def test_pcm_stream_finalizes_and_extracts(client, monkeypatch):
    monkeypatch.setattr(engine, "model", object())

    async def fake_decode(audio, partial=False):
        return {
            "text": "At 14:05 gave 5 mg fictional agent X IV.",
            "words": [],
            "inference_ms": 2,
            "rtf": 0.01,
        }

    monkeypatch.setattr(engine, "decode", fake_decode)
    with client.websocket_connect("/api/live") as ws:
        assert ws.receive_json()["type"] == "ready"
        audio = (np.sin(np.arange(1600) * 0.1) * 10000).astype("<i2").tobytes()
        for _ in range(10):
            ws.send_bytes(audio)
        for _ in range(8):
            ws.send_bytes(bytes(3200))
        ws.send_text("stop")
        messages = []
        while True:
            message = ws.receive_json()
            messages.append(message)
            if message["type"] == "complete":
                break
        assert any(m["type"] == "partial" for m in messages)
        final = next(m for m in messages if m["type"] == "final")
        assert final["events"][0]["medication"] == "fictional agent x"
        assert not final["provisional"]


def test_stream_rejects_foreign_origin(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/api/live", headers={"origin": "https://untrusted.example"}
        ):
            pass
