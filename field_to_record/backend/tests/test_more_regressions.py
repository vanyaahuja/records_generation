from app.extraction import extract_events
from test_review_audit import extracted, accept


def test_unknown_drug_is_suggested_without_replacement():
    e = extract_events("At 14:05 gave 5 mg paracetmol IV.")[0]
    assert e.medication is None
    assert "suggested_medication:paracetamol" in e.flags


def test_revision_export_matches_selected_revision(client):
    body = accept(extracted(client))
    rid = client.post("/api/records", json=body).json()["record_id"]
    body["expected_version"] = 1
    body["events"][0]["dose"]["value"] = 2
    client.put("/api/records/" + rid, json=body)
    exported = client.get("/api/records/" + rid + "/json?version=1").json()
    assert (
        exported["version"] == 1
        and exported["record"]["events"][0]["dose"]["value"] == 5
    )


def test_original_tampering_is_detected(client):
    from app.database import connect

    body = accept(extracted(client))
    client.post("/api/records", json=body)
    with connect(True) as c:
        c.execute("DROP TRIGGER immutable_extractions_update")
        c.execute("UPDATE extractions SET payload='{}'")
    assert not client.get("/api/audit/verify").json()["valid"]


def test_unicode_evidence_uses_code_point_offsets():
    text = "🩺 Synthetic note. At 14:05 gave 5 mg fictional agent X IV."
    e = extract_events(text)[-1]
    a, b = e.fields["dose"].evidence
    assert text[e.source_offset + a : e.source_offset + b] == "5 mg"


def test_negated_observation_is_not_a_final_measurement(client):
    body = accept(extracted(client, "At 14:10 did not record blood pressure 120/80."))
    result = client.post("/api/records", json=body)
    assert result.status_code == 200, result.text
    resource = client.get(
        "/api/records/" + result.json()["record_id"] + "/fhir"
    ).json()["entry"][0]["resource"]
    assert resource["status"] == "cancelled"


def test_draft_edits_do_not_imply_reviewer_acceptance(client):
    body = extracted(client)
    body["record_status"] = "pending_review"
    body["events"][0]["dose"]["value"] = 2
    result = client.post("/api/records", json=body)
    assert result.status_code == 200
    saved = client.get("/api/records/" + result.json()["record_id"]).json()
    assert saved["record"]["events"][0]["review_status"] == "needs_human_confirmation"
