"""Evaluate through the real ASGI API, not a duplicate parser implementation."""

import argparse, json, os, statistics, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from fastapi.testclient import TestClient
from app.main import app

FIELDS = ["medication", "dose", "route", "event_time", "action_status", "observation"]


def value(obj, key):
    v = obj.get(key)
    if key == "dose" and v:
        return {"value": v.get("value"), "unit": v.get("unit")}
    return v


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    reports = {}
    with tempfile.TemporaryDirectory() as temp:
        os.environ["DATABASE_PATH"] = str(Path(temp) / "eval.sqlite3")
        os.environ.pop("DB_DSN", None)
        with TestClient(app) as client:
            for path in sorted((ROOT / "data/gold").glob("*.jsonl")):
                metrics = {
                    k: {"tp": 0, "fp": 0, "fn": 0, "correct": 0, "total": 0}
                    for k in FIELDS
                }
                times = []
                errors = []
                traceable = values = missing = filled_missing = 0
                aligned = True
                rows = [
                    json.loads(line)
                    for line in path.read_text(encoding="utf-8").splitlines()
                    if line
                ]
                for row in rows:
                    start = time.perf_counter()
                    response = client.post("/v1/extract", json={"text": row["text"]})
                    times.append((time.perf_counter() - start) * 1000)
                    response.raise_for_status()
                    events = response.json()["events"]
                    gold = row["events"]
                    if len(events) != len(gold):
                        errors.append(
                            {
                                "id": row["id"],
                                "event_count": {
                                    "expected": len(gold),
                                    "actual": len(events),
                                },
                            }
                        )
                        aligned = False
                    for index in range(max(len(events), len(gold))):
                        expected = gold[index] if index < len(gold) else {}
                        actual = events[index] if index < len(events) else {}
                        for key in FIELDS:
                            if key not in expected and key not in [
                                "medication",
                                "dose",
                                "route",
                                "event_time",
                            ]:
                                continue
                            # Medication-only fields are not scored on procedures/observations.
                            if (
                                key in ["medication", "dose", "route"]
                                and expected.get("event_type")
                                != "medication_administration"
                                and actual.get("event_type")
                                != "medication_administration"
                            ):
                                continue
                            a, g = value(actual, key), value(expected, key)
                            m = metrics[key]
                            m["total"] += 1
                            if a == g:
                                m["correct"] += 1
                            if g is not None and a == g:
                                m["tp"] += 1
                            if a is not None and a != g:
                                m["fp"] += 1
                            if g is not None and a != g:
                                m["fn"] += 1
                            if g is None and key in expected:
                                missing += 1
                                filled_missing += a is not None
                            if a != g:
                                errors.append(
                                    {
                                        "id": row["id"],
                                        "field": key,
                                        "expected": g,
                                        "actual": a,
                                    }
                                )
                        for field in actual.get("fields", {}).values():
                            if field.get("value") is None:
                                continue
                            values += 1
                            span = field.get("evidence")
                            if span and actual["source_text"][
                                span[0] : span[1]
                            ] == field.get("raw"):
                                traceable += 1
                for m in metrics.values():
                    precision = m["tp"] / max(1, m["tp"] + m["fp"])
                    recall = m["tp"] / max(1, m["tp"] + m["fn"])
                    m.update(
                        precision=round(precision, 4),
                        recall=round(recall, 4),
                        f1=round(
                            2 * precision * recall / max(0.0001, precision + recall), 4
                        ),
                        exact_match=round(m["correct"] / max(1, m["total"]), 4),
                    )
                times.sort()
                reports[path.stem] = {
                    "cases": len(rows),
                    "metrics": metrics,
                    "event_count_all_correct": aligned,
                    "fabrication_rate_on_missing": filled_missing / max(1, missing),
                    "traceability": traceable / max(1, values),
                    "latency_ms": {
                        "p50": round(statistics.median(times), 2),
                        "p95": round(times[int(0.95 * (len(times) - 1))], 2),
                    },
                    "errors": errors,
                }
    output = ROOT / "eval/reports"
    output.mkdir(exist_ok=True)
    (output / "text.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
    lines = [
        "# Synthetic text evaluation",
        "",
        "Measured on local ASGI requests. Includes API/thread dispatch; excludes browser and speech. No independently authored wild set or real human audio has been supplied. The challenge set is hand-authored during implementation, not independent validation.",
        "",
    ]
    for name, r in reports.items():
        lines += [
            f"## {name}",
            f"Cases: {r['cases']} | p50/p95: {r['latency_ms']['p50']}/{r['latency_ms']['p95']} ms | traceability: {r['traceability']:.1%} | missing-field fabrication: {r['fabrication_rate_on_missing']:.1%}",
            "",
            "| Field | Precision | Recall | F1 | Exact match |",
            "|---|---:|---:|---:|---:|",
        ]
        lines += [
            f"| {k} | {m['precision']} | {m['recall']} | {m['f1']} | {m['exact_match']} |"
            for k, m in r["metrics"].items()
            if m["total"]
        ]
        lines += ["", f"Mismatches: {len(r['errors'])}", ""]
    (output / "text.md").write_text("\n".join(lines), encoding="utf-8")
    print(
        json.dumps(
            {
                name: {
                    "cases": r["cases"],
                    "mismatches": len(r["errors"]),
                    "latency_ms": r["latency_ms"],
                }
                for name, r in reports.items()
            },
            indent=2,
        )
    )
    if args.check and (
        any(
            m["f1"] < 0.95
            for m in reports["dev"]["metrics"].values()
            if m["tp"] + m["fn"]
        )
        or reports["dev"]["fabrication_rate_on_missing"]
    ):
        raise SystemExit("Dev regression gate failed")


if __name__ == "__main__":
    run()
