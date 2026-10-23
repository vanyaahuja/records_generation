from fastapi import HTTPException

from app.main import resolve_whisper_model_path


def test_resolve_whisper_model_path_accepts_local_model(tmp_path):
    (tmp_path / "model.bin").write_bytes(b"model")

    assert resolve_whisper_model_path(str(tmp_path)) == str(tmp_path.resolve())


def test_resolve_whisper_model_path_rejects_missing_model(tmp_path):
    try:
        resolve_whisper_model_path(str(tmp_path))
    except HTTPException as exc:
        assert exc.status_code == 503
        assert "model files were not found" in exc.detail
    else:
        raise AssertionError("Expected a missing model directory to be rejected")


def test_resolve_whisper_model_path_rejects_combined_env_settings():
    try:
        resolve_whisper_model_path("../models/whisper-smallWHISPER_DEVICE=cpu")
    except HTTPException as exc:
        assert exc.status_code == 503
        assert "each .env setting on its own line" in exc.detail
    else:
        raise AssertionError("Expected a malformed model path to be rejected")
