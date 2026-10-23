"""Server-owned review rules; the client cannot bypass flags or provenance."""

import re
from fastapi import HTTPException
from .extraction import required_flags
from .schemas import Evidence


def prepare_review(req, original):
    if original and original["narrative"] != req.narrative:
        raise HTTPException(
            409, "Narrative changed since extraction. Extract again before saving."
        )
    baseline = {e["event_id"]: e for e in (original or {}).get("events", [])}
    ids = [e.event_id for e in req.events]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Duplicate event IDs.")
    if req.record_status == "reviewed" and (not req.reviewer_id or not req.events):
        raise HTTPException(422, "A reviewer and at least one event are required.")
    for event in req.events:
        explicitly_reviewed = event.review_status in ["confirmed", "corrected"]
        old = baseline.get(event.event_id)
        if not old and not event.manual:
            raise HTTPException(422, "New events must be explicitly marked manual.")
        if old:
            if (
                event.source_text != old["source_text"]
                or event.source_offset != old["source_offset"]
            ):
                raise HTTPException(422, "Original event evidence cannot be changed.")
            event.fields = {
                k: Evidence.model_validate(v) for k, v in old["fields"].items()
            }
            # Baseline flags cannot silently disappear after editing.
            event.flags = [f for f in old["flags"] if not f.startswith("missing_")]
            for key in [
                "medication",
                "dose",
                "route",
                "event_time",
                "description",
                "observation",
            ]:
                value = getattr(event, key)
                if hasattr(value, "model_dump"):
                    value = value.model_dump()
                if value != old.get(key):
                    prior = event.fields.get(key, Evidence())
                    event.fields[key] = Evidence(
                        value=value,
                        status="corrected",
                        evidence=prior.evidence,
                        raw=prior.raw,
                    )
                    if explicitly_reviewed:
                        event.review_status = "corrected"
            if explicitly_reviewed and any(
                getattr(event, key) != old.get(key) for key in ["status", "event_type"]
            ):
                event.review_status = "corrected"
        else:
            event.flags = ["manual_entry"]
            event.fields = {
                k: Evidence(value=getattr(event, k), status="corrected")
                for k in [
                    "medication",
                    "route",
                    "event_time",
                    "description",
                    "observation",
                ]
            }
        if event.event_time and not re.fullmatch(
            r"(?:[01]\d|2[0-3]):[0-5]\d", event.event_time
        ):
            raise HTTPException(422, "Event time must be HH:MM (24 hour) or unknown.")
        event.time_source = (
            "unknown"
            if not event.event_time
            else event.time_source
            if event.time_source == "relative"
            else "reported"
        )
        event.action_status = {
            "reported": "completed",
            "negated": "not_done",
            "uncertain": "unclear",
            "needs_review": "unclear",
        }[event.status]
        event.flags = list(dict.fromkeys(event.flags + required_flags(event)))
        if req.record_status == "reviewed":
            unresolved = set(event.flags) - set(event.accepted_flags)
            if unresolved or not explicitly_reviewed:
                raise HTTPException(
                    422,
                    {
                        "message": "Review every event and acknowledge unresolved flags as accepted uncertainty.",
                        "event_id": event.event_id,
                        "unresolved_flags": sorted(unresolved),
                    },
                )
    return [e.model_dump(mode="json") for e in req.events]
