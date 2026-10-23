"""Real PostgreSQL integration checks. CI provisions a separate test database."""

import os, uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import postgres_pool
from test_review_audit import extracted, accept


@pytest.fixture
def pg_client(monkeypatch):
    dsn = os.getenv("TEST_POSTGRES_DSN")
    if not dsn:
        pytest.skip("Set TEST_POSTGRES_DSN for PostgreSQL integration checks")
    import psycopg
    from psycopg.conninfo import make_conninfo

    schema = "test_" + uuid.uuid4().hex
    with psycopg.connect(dsn, autocommit=True) as con:
        con.execute("CREATE SCHEMA " + schema)
    scoped = make_conninfo(dsn, options="-csearch_path=" + schema)
    monkeypatch.setenv("DB_DSN", scoped)
    try:
        with TestClient(app) as client:
            yield client
    finally:
        if postgres_pool.cache_info().currsize:
            postgres_pool(scoped).close()
        postgres_pool.cache_clear()
        with psycopg.connect(dsn, autocommit=True) as con:
            con.execute("DROP SCHEMA " + schema + " CASCADE")


def test_postgres_review_revision_and_audit(pg_client):
    body = accept(extracted(pg_client))
    r = pg_client.post("/api/records", json=body)
    assert r.status_code == 200, r.text
    rid = r.json()["record_id"]
    body["expected_version"] = 1
    body["events"][0]["dose"]["value"] = 2
    assert pg_client.put("/api/records/" + rid, json=body).status_code == 200
    assert pg_client.get("/api/audit/verify").json()["valid"]
    assert pg_client.get("/api/records/" + rid).json()["version"] == 2
