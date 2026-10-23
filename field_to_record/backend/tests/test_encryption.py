import base64, os
from app.database import connect
from test_review_audit import extracted, accept


def test_encrypted_payload_round_trip_and_wrong_key(client, monkeypatch):
    monkeypatch.setenv(
        "RECORD_ENCRYPTION_KEY", base64.b64encode(os.urandom(32)).decode()
    )
    body = accept(extracted(client))
    r = client.post("/api/records", json=body)
    assert r.status_code == 200, r.text
    rid = r.json()["record_id"]
    with connect() as c:
        for table in ["revisions", "extractions"]:
            payload = c.execute("SELECT payload FROM " + table).fetchone()["payload"]
            assert payload.startswith("aesgcm:v1:") and "fictional" not in payload
    assert (
        client.get("/api/records/" + rid).json()["record"]["narrative"]
        == body["narrative"]
    )
    assert client.get("/api/audit/verify").json()["valid"]
    monkeypatch.setenv(
        "RECORD_ENCRYPTION_KEY", base64.b64encode(os.urandom(32)).decode()
    )
    assert client.get("/api/records/" + rid).status_code == 503
