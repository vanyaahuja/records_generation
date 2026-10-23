import socket
from test_review_audit import extracted, accept


def test_full_text_workflow_with_outbound_sockets_forbidden(client, monkeypatch):
    def deny(*args, **kwargs):
        raise AssertionError("Runtime network access attempted")

    monkeypatch.setattr(socket.socket, "connect", deny)
    body = accept(extracted(client))
    result = client.post("/api/records", json=body)
    assert result.status_code == 200
    rid = result.json()["record_id"]
    for format in ["json", "fhir", "pdf", "html", "text"]:
        assert client.get("/api/records/" + rid + "/" + format).status_code == 200
    assert client.get("/api/audit/verify").json()["valid"]
