from app.database import connect
from test_review_audit import extracted, accept


def test_malformed_payload_returns_failed_verification(client):
    body = accept(extracted(client))
    client.post("/api/records", json=body)
    with connect(True) as c:
        c.execute("DROP TRIGGER immutable_revisions_update")
        c.execute("UPDATE revisions SET payload='broken json'")
    assert not client.get("/api/audit/verify").json()["valid"]


def test_missing_record_head_is_detected(client):
    body = accept(extracted(client))
    client.post("/api/records", json=body)
    with connect(True) as c:
        c.execute("DELETE FROM record_heads")
    assert not client.get("/api/audit/verify").json()["valid"]
