from concurrent.futures import ThreadPoolExecutor
from test_review_audit import extracted, accept


def test_concurrent_saves_keep_one_valid_audit_chain(client):
    body = accept(extracted(client))
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(
            pool.map(lambda _: client.post("/api/records", json=body), range(20))
        )
    assert all(r.status_code == 200 for r in responses)
    result = client.get("/api/audit/verify").json()
    assert result["valid"] and result["entries_verified"] == 20


def test_competing_revisions_cannot_overwrite_each_other(client):
    body = accept(extracted(client))
    rid = client.post("/api/records", json=body).json()["record_id"]
    body["expected_version"] = 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(
                lambda _: client.put("/api/records/" + rid, json=body).status_code,
                range(2),
            )
        )
    assert sorted(statuses) == [200, 409]
