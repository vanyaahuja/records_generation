import re, uuid
from typing import Optional
from .schemas import ClinicalEvent, Dose

# Fictional demo terms only. This is a transparent baseline, not clinical-grade NER.
MEDICATIONS = ["fictional agent x", "fictional agent y", "demo medication"]
PROCEDURES = ["simulated airway procedure", "airway procedure", "CPR", "bandaging", "wound dressing", "splinting", "oxygen administration"]
ROUTES = {"intravenously":"intravenous", "intravenous":"intravenous", "iv":"intravenous",
          "intramuscularly":"intramuscular", "intramuscular":"intramuscular", "im":"intramuscular",
          "orally":"oral", "oral":"oral", "by mouth":"oral", "subcutaneously":"subcutaneous",
          "subcutaneous":"subcutaneous", "inhaled":"inhalation", "inhalation":"inhalation"}
TIME_RE = re.compile(r"\b(?:at\s+)?(?P<time>(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?[ap]m)?)\b", re.I)
DOSE_RE = re.compile(r"\b(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mcg|micrograms?|mg|g|ml|units?)\b", re.I)
NEG_RE = re.compile(r"\b(no|not|never|did not|wasn't|were not|without)\b", re.I)
UNCERTAIN_RE = re.compile(r"\b(maybe|possibly|unclear|unsure|approximately|approx\.?|might have|may have)\b", re.I)

def event_time(text):
    m = TIME_RE.search(text)
    return m.group("time").strip() if m else None

def dose_from(text):
    m = DOSE_RE.search(text)
    if not m: return None
    unit = m.group("unit").lower()
    unit = {"microgram":"mcg", "micrograms":"mcg"}.get(unit, unit)
    return Dose(value=float(m.group("value")), unit=unit, source_text=m.group(0))

def route_from(text):
    low = text.lower()
    for phrase in sorted(ROUTES, key=len, reverse=True):
        if re.search(r"\b" + re.escape(phrase) + r"\b", low): return ROUTES[phrase]
    return None

def extract_events(text):
    events = []
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text.strip()) if s.strip()]
    for sentence in sentences:
        low = sentence.lower()
        med = next((m for m in MEDICATIONS if m in low), None)
        proc = next((p for p in sorted(PROCEDURES, key=len, reverse=True) if p.lower() in low), None)
        status, flags = "reported", []
        if NEG_RE.search(low):
            status = "negated"; flags.append("Negation detected; human review required.")
        elif UNCERTAIN_RE.search(low):
            status = "uncertain"; flags.append("Uncertainty detected; human review required.")
        tm = event_time(sentence)
        if med:
            dose = dose_from(sentence); route = route_from(sentence)
            if not dose: flags.append("Dose not extracted; do not infer.")
            if not route: flags.append("Route not extracted; do not infer.")
            if not tm: flags.append("Event time not stated.")
            events.append(ClinicalEvent(event_id=str(uuid.uuid4()), event_type="medication_administration",
                description="Medication mention: " + med, medication=med.title(), dose=dose, route=route,
                event_time=tm, time_source="reported" if tm else "unknown", status=status,
                source_text=sentence, flags=list(flags)))
        if proc:
            pflags = list(flags)
            if not tm: pflags.append("Event time not stated.")
            events.append(ClinicalEvent(event_id=str(uuid.uuid4()), event_type="procedure", description=proc,
                event_time=tm, time_source="reported" if tm else "unknown", status=status,
                source_text=sentence, flags=pflags))
        if not med and not proc:
            events.append(ClinicalEvent(event_id=str(uuid.uuid4()), event_type="unclassified",
                description="Unclassified narrative statement", event_time=tm,
                time_source="reported" if tm else "unknown", status="needs_review", source_text=sentence,
                flags=["No supported pattern matched; review manually."]))
    return events
