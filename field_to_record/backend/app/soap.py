"""Source-only SOAP organization. Never synthesize diagnoses or treatment plans."""
import re

SECTIONS = {"S": "Subjective", "O": "Objective", "A": "Assessment", "P": "Plan"}


def classify_event(event):
    if event.get("soap_section") in SECTIONS:
        return event["soap_section"]
    source = event.get("source_text", "")
    heading = re.match(r"\s*(subjective|objective|assessment|plan|[SOAP])\s*:\s*", source, re.I)
    if heading:
        return heading[1][0].upper()
    if event.get("event_type") == "observation":
        return "O"
    if event.get("event_type") in ["medication_administration", "procedure"]:
        return "P"
    if re.search(r"\b(?:patient|caregiver)\s+(?:reports|states|denies|describes|complains)\b", source, re.I):
        return "S"
    return None


def event_value(event):
    unknown = "Not documented"
    def number(value):
        return f"{value:g}" if isinstance(value, (int, float)) else unknown
    if event.get("event_type") == "medication_administration":
        dose = event.get("dose") or {}
        value = f"{dose['value']:g}" if isinstance(dose.get("value"), (int, float)) else unknown
        return f"{value} {dose.get('unit') or ''} · {event.get('route') or unknown}".strip()
    obs = event.get("observation") or {}
    if obs:
        value = f"{number(obs.get('systolic'))}/{number(obs.get('diastolic'))}" if obs.get("type") == "blood_pressure" else number(obs.get("value"))
        return f"{value} {obs.get('unit') or unknown}"
    return event.get("description") or unknown


def soap_document(record):
    sections = [{"code": code, "title": title, "rows": []} for code, title in SECTIONS.items()]
    grouped = {section["code"]: section["rows"] for section in sections}
    unassigned = []
    for event in sorted(record.get("events", []), key=lambda e: e.get("event_time") or "99:99"):
        section = classify_event(event)
        row = {
            "event_id": event["event_id"], "time": event.get("event_time"),
            "entry": event.get("medication") or event["description"], "value": event_value(event),
            "action_status": event["action_status"], "review_status": event["review_status"],
            "source_text": event["source_text"], "source_offset": event["source_offset"],
            "flags": event["flags"], "accepted_flags": event["accepted_flags"],
        }
        (grouped[section] if section else unassigned).append(row)
    return {"sections": sections, "unassigned": unassigned, "notice": "Source-only organization. Empty sections are not documented; no assessment or treatment recommendation is generated."}
