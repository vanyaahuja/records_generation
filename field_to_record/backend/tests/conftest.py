import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "records.sqlite3"))
    monkeypatch.delenv("WARM_SPEECH", raising=False)
    with TestClient(app) as client:
        yield client
