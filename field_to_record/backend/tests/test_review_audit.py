import copy, json, sqlite3
import pytest
from app.database import connect


def extracted(client, text="At 14:05 gave 5 mg fictional agent X intravenously."):
    r = client.post("/api/extract", json={"text": text, "encounter_date": "2026-10-24"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "case_id": d["case_id"],
        "responder_id": d["responder_id"],
        "narrative": d["narrative"],
        "events": d["events"],
        "extraction_id": d["extraction_id"],
        "record_status": "reviewed",
        "reviewer_id": "Reviewer 1",
        "encounter_date": "2026-10-24",
    }


def accept(body):
    for e in body["events"]:
        e["review_status"] = "confirmed"
        e["accepted_flags"] = list(e["flags"])
    return body


def test_review_cannot_be_bypassed(client):
    body = extracted(client)
    assert client.post("/api/records", json=body).status_code == 422
    body["events"][0]["dose"]["value"] = 2
    assert client.post("/api/records", json=body).status_code == 422
    body["events"] = []
    assert client.post("/api/records", json=body).status_code == 422


def test_flags_cannot_be_deleted_or_hidden(client):
    body = extracted(client, "Administered fictional agent X.")
    body["events"][0].update(flags=[], review_status="confirmed")
    r = client.post("/api/records", json=body)
    assert r.status_code == 422
    assert "missing_dose" in r.text


def test_narrative_change_invalidates_extraction(client):
    body = accept(extracted(client))
    body["narrative"] += " New statement."
    assert client.post("/api/records", json=body).status_code == 409


def test_save_revision_exports_and_original(client):
    body = accept(extracted(client))
    saved = client.post("/api/records", json=body)
    assert saved.status_code == 200, saved.text
    rid = saved.json()["record_id"]
    assert saved.json()["version"] == 1
    body["events"][0]["dose"]["value"] = 2
    body["expected_version"] = 1
    revised = client.put("/api/records/" + rid, json=body)
    assert revised.status_code == 200, revised.text
    assert revised.json()["version"] == 2
    assert client.put("/api/records/" + rid, json=body).status_code == 409
    assert (
        client.get("/api/records/" + rid + "?version=1").json()["record"]["events"][0][
            "dose"
        ]["value"]
        == 5
    )
    latest = client.get("/api/records/" + rid).json()
    assert latest["record"]["events"][0]["fields"]["dose"]["status"] == "corrected"
    assert (
        client.get("/api/records/" + rid + "/original").json()["events"][0]["dose"][
            "value"
        ]
        == 5
    )
    for format in ["json", "fhir", "pdf", "html", "text"]:
        result = client.get("/api/records/" + rid + "/" + format)
        assert result.status_code == 200, result.text
        if format == "pdf":
            assert result.content.startswith(b"%PDF")
    fhir = client.get("/api/records/" + rid + "/fhir").json()
    assert (
        fhir["entry"][0]["resource"]["effectiveDateTime"] == "2026-10-24T14:05:00+05:30"
    )
    assert client.get("/api/audit/verify").json()["valid"]
    assert client.get("/api/records?q=DEMO-001").json()[0]["record_id"] == rid


def test_uncertainty_can_be_explicitly_accepted(client):
    body = accept(extracted(client, "Administered fictional agent X."))
    r = client.post("/api/records", json=body)
    assert r.status_code == 200, r.text
    resource = client.get("/api/records/" + r.json()["record_id"] + "/fhir").json()[
        "entry"
    ][0]["resource"]
    assert "effectiveDateTime" not in resource
    assert "dosage" not in resource


def test_append_only_and_tamper_detection(client):
    body = accept(extracted(client))
    client.post("/api/records", json=body)
    with connect(True) as c:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("UPDATE revisions SET actor='intruder'")
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("DELETE FROM audit_log")
        # Simulate a privileged attacker bypassing the trigger in a temporary database.
        c.execute("DROP TRIGGER immutable_revisions_update")
        payload = json.loads(
            c.execute("SELECT payload FROM revisions").fetchone()["payload"]
        )
        payload["events"][0]["dose"]["value"] = 999
        c.execute("UPDATE revisions SET payload=?", (json.dumps(payload),))
    assert not client.get("/api/audit/verify").json()["valid"]


def test_validation_and_missing_records(client):
    assert client.post("/api/extract", json={"text": "  "}).status_code == 422
    assert (
        client.post("/api/extract", json={"text": "Test", "tz": "bad/zone"}).status_code
        == 422
    )
    assert client.get("/api/records/missing").status_code == 404
    body = accept(extracted(client))
    body["events"][0]["dose"]["value"] = -5
    assert client.post("/api/records", json=body).status_code == 422


def test_manual_event_is_explicit_and_audited(client):
    body = accept(extracted(client))
    manual = copy.deepcopy(body["events"][0])
    manual.update(
        event_id="manual-1",
        manual=True,
        fields={},
        review_status="corrected",
        accepted_flags=["manual_entry"],
    )
    body["events"].append(manual)
    result = client.post("/api/records", json=body)
    assert result.status_code == 200, result.text


def test_original_evidence_is_server_owned(client):
    body = accept(extracted(client))
    body["events"][0]["fields"]["dose"]["evidence"] = [0, 2]
    result = client.post("/api/records", json=body)
    assert result.status_code == 200
    actual = client.get("/api/records/" + result.json()["record_id"]).json()["record"][
        "events"
    ][0]
    assert actual["fields"]["dose"]["raw"] == "5 mg"
