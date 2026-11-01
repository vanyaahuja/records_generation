"""Deterministic notes and explicitly non-conformant FHIR-lite bundles."""

import json
from datetime import datetime, date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from html import escape
from .database import digest
from .soap import event_rows, classify_event

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
            model_versions=record.get("model_versions", {}), record_hash=digest(record), soap_section=classify_event(event)
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
        if record.get("patient"):
            patient = record["patient"]
            resource["subject"] = {"reference": "urn:uuid:" + patient["patient_id"], "display": patient["name"]}
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
    lines = ["FIELD-TO-RECORD | RECORDED EVENTS | SYNTHETIC DEMO", "Not clinically verified", f"Case: {r['case_id']} | Status: {r['record_status']}", f"Recorded: {r['recorded_at']} | Revision: {bundle['version']}", f"Reviewer: {r.get('reviewer_id') or 'NOT DOCUMENTED'}"]
    if r.get("patient"):
        p = r["patient"]
        lines.append(f"Patient: {p['name']} | Age: {p['age']} | Gender: {p['gender']}")
    lines += ["", "Time | Event | Reading / details | Action | Review"]
    for row in event_rows(r):
        lines.append(" | ".join([row["time"] or "Not documented",row["entry"],row["value"],row["action_status"],row["review_status"]]))
        lines.append("Source: " + row["source_text"])
        if row["flags"]:
            lines.append("Flags: " + ", ".join(row["flags"]) + " | Accepted: " + (", ".join(row["accepted_flags"]) or "None"))
    lines += ["", "SOURCE TRANSCRIPT",r["narrative"],"", "AUDIT",f"Record: {bundle['record_id']}",f"Hash: {digest(r)}","Versions: "+json.dumps(r.get("model_versions", {}))]
    return "\n".join(lines)


def render_html(bundle):
    r = bundle["record"]
    patient = r.get("patient")
    heading = f"{patient['name']} · {patient['age']} · {patient['gender']}" if patient else r["case_id"]
    body = ['<!doctype html><html lang="en"><meta charset="utf-8"><title>Recorded events</title><style>body{font:14px system-ui;max-width:1100px;margin:32px auto;padding:20px;color:#181818}table{border-collapse:collapse;width:100%;margin:24px 0;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:12px;overflow-wrap:anywhere;border-bottom:1px solid #e8e8e8}th{background:#f4f4f4}h2{font-size:17px}p,small{color:#666}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8}@media print{body{margin:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}}</style><body><h1>Recorded events</h1>', '<p>'+escape(heading)+f' · Revision {bundle["version"]}</p><small>Synthetic demonstration · Review required</small>']
    body.append('<table><thead><tr>'+''.join('<th scope="col">'+label+'</th>' for label in ['Time','Event','Reading / details','Action','Review','Source'])+'</tr></thead><tbody>')
    rows = event_rows(r)
    if not rows:
        body.append('<tr><td colspan="6">Not documented</td></tr>')
    for row in rows:
        values=[row['time'] or 'Not documented',row['entry'],row['value'],row['action_status'].replace('_',' '),row['review_status'].replace('_',' '),row['source_text']]
        body.append('<tr>'+''.join('<td>'+escape(str(value))+'</td>' for value in values)+'</tr>')
        if row['flags']:
            body.append('<tr><td colspan="6">Flags: '+escape(', '.join(row['flags']))+' · Accepted: '+escape(', '.join(row['accepted_flags']) or 'None')+'</td></tr>')
    body.append('</tbody></table>')
    body += ['<h2>Source transcript</h2><pre>'+escape(r['narrative'])+'</pre>','<h2>Audit</h2><p>'+escape(bundle['record_id'])+'</p><pre>'+digest(r)+'</pre></body></html>']
    return ''.join(body)
