"""Verify the packaged HTTP workflow against a running stack."""

import json, os
from urllib.request import Request, urlopen

BASE = os.getenv("FTR_URL", "http://127.0.0.1:8080")


def call(path, payload=None):
    request = Request(
        BASE + path,
        data=json.dumps(payload).encode() if payload else None,
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        body = response.read()
        return (
            json.loads(body)
            if response.headers["Content-Type"].startswith("application/json")
            else body
        )


d = call("/api/extract", {"text": "At 14:05 gave 5 mg fictional agent X IV."})
for e in d["events"]:
    e.update(review_status="confirmed", accepted_flags=e["flags"])
r = call(
    "/api/records",
    {
        "case_id": d["case_id"],
        "responder_id": d["responder_id"],
        "narrative": d["narrative"],
        "events": d["events"],
        "extraction_id": d["extraction_id"],
        "record_status": "reviewed",
        "reviewer_id": "smoke-test",
    },
)
for format in ["json", "fhir", "pdf", "html", "text"]:
    assert call("/api/records/" + r["record_id"] + "/" + format)
assert call("/api/audit/verify")["valid"]
print("Packaged extract, review, save, export and audit workflow passed")
