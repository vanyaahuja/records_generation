"""Workspace-wide counts over latest saved revisions, including encrypted records."""
from collections import Counter
from datetime import date, timedelta
from .database import connect, PostgresConnection
from .crypto import unpack


def workspace_summary(days=30, end_date=None):
    ending = end_date or date.today()
    daily = {
        (ending - timedelta(days=i)).isoformat(): {
            "date": (ending - timedelta(days=i)).isoformat(),
            "patients": 0, "records": 0, "events": 0, "pending_events": 0,
            "medication_administration": 0, "procedure": 0,
            "observation": 0, "unclassified": 0,
        }
        for i in reversed(range(days))
    }
    totals = Counter(patients=0, records=0, events=0, accepted_events=0,
                     pending_events=0, reviewed_records=0, pending_records=0)
    kinds = Counter(medication_administration=0, procedure=0, observation=0, unclassified=0)
    flags = Counter()
    recent = []
    with connect() as connection:
        connection.execute("BEGIN ISOLATION LEVEL REPEATABLE READ" if isinstance(connection, PostgresConnection) else "BEGIN")
        for profile in connection.execute("SELECT created_at FROM patients"):
            totals["patients"] += 1
            day = profile["created_at"][:10]
            if day in daily:
                daily[day]["patients"] += 1
        # No list API limit: every head contributes once, regardless of revisions.
        cursor = connection.execute(
            "SELECT r.record_id,r.version,r.created_at,r.payload FROM revisions r "
            "JOIN record_heads h ON r.record_id=h.record_id AND r.version=h.version "
            "ORDER BY r.created_at DESC"
        )
        while batch := cursor.fetchmany(256):
            for row in batch:
                record = unpack(row["payload"])
                events = record["events"]
                totals["records"] += 1
                totals["events"] += len(events)
                totals["reviewed_records" if record["record_status"] == "reviewed" else "pending_records"] += 1
                day = record.get("encounter_date") or record.get("recorded_at",row["created_at"])[:10]
                if day in daily:
                    daily[day]["records"] += 1
                    daily[day]["events"] += len(events)
                for event in events:
                    kind = event["event_type"]
                    kinds[kind] += 1
                    accepted = event["review_status"] != "needs_human_confirmation" and set(event["flags"]).issubset(event["accepted_flags"])
                    totals["accepted_events" if accepted else "pending_events"] += 1
                    flags.update(event["flags"])
                    if day in daily:
                        daily[day][kind] += 1
                        if not accepted: daily[day]["pending_events"] += 1
                if len(recent) < 6:
                    recent.append({"record_id": row["record_id"], "version": row["version"],
                                   "case_id": record["case_id"], "patient": record.get("patient"),
                                   "encounter_date": day, "event_count": len(events),
                                   "record_status": record["record_status"]})
    return {"totals": dict(totals), "daily": list(daily.values()),
            "event_types": dict(kinds), "flags": dict(flags.most_common(5)),
            "recent_records": recent, "start_date": next(iter(daily)),
            "end_date": ending.isoformat(), "days": days}
