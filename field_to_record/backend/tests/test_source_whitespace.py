from test_review_audit import extracted, accept


def test_original_whitespace_and_evidence_are_preserved(client):
    text = "  \nAt 14:05 gave  5 mg fictional agent X IV.  \n"
    body = accept(extracted(client, text))
    assert body["narrative"] == text
    e = body["events"][0]
    for field in e["fields"].values():
        if field["evidence"]:
            a, b = field["evidence"]
            assert e["source_text"][a:b] == field["raw"]
    result = client.post("/api/records", json=body)
    assert result.status_code == 200, result.text
