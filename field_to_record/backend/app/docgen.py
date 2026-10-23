"""Deterministic notes and explicitly non-conformant FHIR-lite bundles."""

import json
from datetime import datetime, date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from html import escape
from .database import digest

RESOURCE_SCHEMA = {
    "type": "object",
    "required": ["resourceType", "id", "extension"],
    "properties": {
        "resourceType": {
            "enum": ["MedicationAdministration", "Observation", "Procedure", "Basic"]
        },
        "id": {"type": "string"},
        "extension": {"type": "array"},
    },
}
FHIR_LITE_SCHEMA = {
    "type": "object",
    "required": ["resourceType", "type", "entry"],
    "properties": {
        "resourceType": {"const": "Bundle"},
        "type": {"const": "collection"},
        "entry": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["resource"],
                "properties": {"resource": RESOURCE_SCHEMA},
            },
        },
    },
}


def occurred_at(event, record):
    if (
        not record.get("encounter_date")
        or not event.get("event_time")
        or any(
            flag in event.get("flags", [])
            for flag in ["ambiguous_am_pm", "relative_date_rollover"]
        )
    ):
        return None
    try:
        return datetime.combine(
            date.fromisoformat(record["encounter_date"]),
            datetime.strptime(event["event_time"], "%H:%M").time(),
            tzinfo=ZoneInfo(record.get("tz", "UTC")),
        ).isoformat()
    except (ValueError, ZoneInfoNotFoundError):
        return None


def fhir_bundle(bundle):
    from jsonschema import validate

    record = bundle["record"]
    entries = []
    for event in record["events"]:
        kind = event["event_type"]
        neg = event["action_status"] == "not_done"
        completed = event["action_status"] == "completed"
        provenance = {
            k: event[k]
            for k in [
                "source_text",
                "fields",
                "flags",
                "accepted_flags",
                "review_status",
            ]
        }
        provenance.update(
            model_versions=record.get("model_versions", {}), record_hash=digest(record)
        )
        resource = {
            "id": event["event_id"],
            "extension": [
                {
                    "url": "urn:field-to-record:provenance",
                    "valueString": json.dumps(provenance, ensure_ascii=False),
                }
            ],
        }
        dt = occurred_at(event, record)
        if kind == "medication_administration":
            resource.update(
                resourceType="MedicationAdministration",
                status="not-done" if neg else "completed" if completed else "unknown",
                medicationCodeableConcept={
                    "text": event.get("medication") or "NOT DOCUMENTED"
                },
            )
            dosage = {}
            dose = event.get("dose")
            if dose and dose.get("value") is not None and dose.get("unit"):
                dosage["dose"] = {"value": dose["value"], "unit": dose["unit"]}
            if event.get("route"):
                dosage["route"] = {"text": event["route"]}
            if dosage:
                resource["dosage"] = dosage
            if dt:
                resource["effectiveDateTime"] = dt
        elif kind == "procedure":
            resource.update(
                resourceType="Procedure",
                status="not-done" if neg else "completed" if completed else "unknown",
                code={"text": event["description"]},
            )
            if dt:
                resource["performedDateTime"] = dt
        elif kind == "observation":
            obs = event.get("observation") or {}
            resource.update(
                resourceType="Observation",
                status="cancelled"
                if neg
                else "unknown"
                if not completed
                else "final"
                if record["record_status"] == "reviewed"
                else "preliminary",
                code={"text": obs.get("type", event["description"])},
            )
            if obs.get("type") == "blood_pressure":
                resource["component"] = [
                    {
                        "code": {"text": key},
                        "valueQuantity": {"value": obs[key], "unit": obs.get("unit")},
                    }
                    for key in ["systolic", "diastolic"]
                    if key in obs
                ]
            elif obs.get("value") is not None:
                resource["valueQuantity"] = {"value": obs["value"]}
                if obs.get("unit"):
                    resource["valueQuantity"]["unit"] = obs["unit"]
            if dt:
                resource["effectiveDateTime"] = dt
        else:
            resource.update(
                resourceType="Basic",
                code={"text": "Unclassified narrative"},
                text={
                    "status": "generated",
                    "div": '<div xmlns="http://www.w3.org/1999/xhtml">'
                    + escape(event["source_text"])
                    + "</div>",
                },
            )
        entries.append({"resource": resource})
    result = {
        "resourceType": "Bundle",
        "type": "collection",
        "identifier": {"value": bundle["record_id"]},
        "meta": {
            "tag": [
                {"system": "urn:field-to-record", "code": "fhir-lite-not-conformant"}
            ]
        },
        "entry": entries,
    }
    validate(result, FHIR_LITE_SCHEMA)
    return result


def render_text(bundle):
    r = bundle["record"]
    lines = [
        "FIELD-TO-RECORD | SYNTHETIC DEMO",
        "Not clinically verified",
        f"Case: {r['case_id']} | Status: {r['record_status']}",
        f"Recorded: {r['recorded_at']} | Revision: {bundle['version']}",
        f"Reviewer: {r.get('reviewer_id') or 'NOT DOCUMENTED'}",
        "",
        "NEEDS REVIEW / ACCEPTED UNCERTAINTY",
    ]
    flags = [
        f"{e['description']}: {', '.join(e['flags'])}"
        for e in r["events"]
        if e["flags"]
    ]
    lines.extend(flags or ["None"])
    lines += ["", "EVENT TIMELINE"]
    for e in sorted(r["events"], key=lambda e: e.get("event_time") or "99:99"):
        dose = e.get("dose") or {}
        dose_text = (
            f"{dose.get('value')} {dose.get('unit')}"
            if dose.get("value") is not None
            else "NOT DOCUMENTED"
        )
        lines.append(
            f"{e.get('event_time') or 'NOT DOCUMENTED'} | {e['event_type']} | {e['description']} | {e['action_status']} | Review: {e['review_status']}"
        )
        if e["event_type"] == "medication_administration":
            lines.append(
                f"Medication: {e.get('medication') or 'NOT DOCUMENTED'} | Dose: {dose_text} | Route: {e.get('route') or 'NOT DOCUMENTED'}"
            )
        if e.get("observation"):
            lines.append(json.dumps(e["observation"]))
        lines.append("Source: " + e["source_text"])
    lines += [
        "",
        "SOURCE TRANSCRIPT",
        r["narrative"],
        "",
        "AUDIT",
        f"Record: {bundle['record_id']}",
        f"Hash: {digest(r)}",
        "Versions: " + json.dumps(r.get("model_versions", {})),
    ]
    return "\n".join(lines)


def render_html(bundle):
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Field record</title><style>body{font:16px system-ui;max-width:900px;margin:32px auto;padding:20px;color:#12232d}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.6}@media print{body{margin:0;padding:0}pre{font-size:11pt}}</style><body><h1>Field-to-Record</h1><pre>'
        + escape(render_text(bundle))
        + "</pre></body></html>"
    )
