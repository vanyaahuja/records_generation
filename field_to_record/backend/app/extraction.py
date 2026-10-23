"""Evidence-preserving, clause-scoped offline extraction."""

import json, re, uuid
from pathlib import Path
from difflib import get_close_matches
from datetime import datetime, timedelta
from .normalize import NUM, number, UNIT_ALIASES
from .schemas import ClinicalEvent, Dose, Evidence

VERSION = "rules-2.0"
DATA = next(
    parent / "data/lexicons/drugs.json"
    for parent in Path(__file__).resolve().parents
    if (parent / "data/lexicons/drugs.json").is_file()
)
DRUGS = json.loads(DATA.read_text(encoding="utf-8-sig"))
ALIASES = {
    alias.lower(): canonical
    for canonical, aliases in DRUGS.items()
    for alias in [canonical, *aliases]
}


def matcher(terms):
    return re.compile(
        r"\b(?:"
        + "|".join(re.escape(a) for a in sorted(terms, key=len, reverse=True))
        + r")\b",
        re.I,
    )


DRUG_RE = matcher(ALIASES)
PROCEDURES = [
    "simulated airway procedure",
    "airway procedure",
    "oxygen administration",
    "wound dressing",
    "endotracheal intubation",
    "bag valve mask",
    "supraglottic airway",
    "needle decompression",
    "chest compression",
    "defibrillation",
    "cardioversion",
    "intubation",
    "tourniquet",
    "bandaging",
    "splinting",
    "suctioning",
    "CPR",
]
PROC_RE = matcher(PROCEDURES)
ROUTES = {
    "intravenously": "intravenous",
    "intravenous": "intravenous",
    "iv push": "intravenous",
    "iv": "intravenous",
    "intramuscularly": "intramuscular",
    "intramuscular": "intramuscular",
    "im": "intramuscular",
    "orally": "oral",
    "oral": "oral",
    "by mouth": "oral",
    "po": "oral",
    "subcutaneously": "subcutaneous",
    "subcutaneous": "subcutaneous",
    "sc": "subcutaneous",
    "inhaled": "inhalation",
    "inhalation": "inhalation",
    "nebulized": "inhalation",
    "nebulised": "inhalation",
    "sublingual": "sublingual",
    "sl": "sublingual",
    "intranasal": "intranasal",
    "intraosseous": "intraosseous",
    "io": "intraosseous",
    "rectal": "rectal",
}
ROUTE_RE = matcher(ROUTES)
DOSE_RE = re.compile(
    r"(?<![\w.])(?P<sign>[-−]?)\s*(?P<value>"
    + NUM
    + r")\s*(?P<unit>micrograms?|milligrams?|millilit(?:er|re)s?|mics|mcg|mg|grams?|g|ml|units?)\b",
    re.I,
)
TIME_RE = re.compile(
    r"\b(?:at\s+)?(?P<h>\d{1,2}):(?P<m>\d{2})(?:\s*(?P<ap>[ap]\.?m\.?))?\b|\bat\s+(?P<dh>\d{1,2})\.(?P<dm>\d{2})(?P<dap>)\b",
    re.I,
)
COMPACT_TIME_RE = re.compile(r"\bat\s+(?P<h>[0-2]\d)(?P<m>[0-5]\d)(?P<ap>)\b", re.I)
SPOKEN_TIME_RE = re.compile(
    r"\bat\s+(?P<h>zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:\s+(?:one|two|three))?)\s+(?P<m>"
    + NUM
    + r")(?:\s*(?P<ap>[ap]\s*\.?\s*m\.?))?\b",
    re.I,
)
TRIGGER_RE = matcher(
    [
        "gave",
        "give",
        "given",
        "administered",
        "administer",
        "started",
        "applied",
        "inserted",
        "checked",
        "recorded",
        "measured",
        "noted",
        "performed",
        "initiated",
        "refused",
        "withheld",
        "held",
        "considering",
        "planned",
        "prescribed",
        "reported",
        "received",
    ]
)
NEG_RE = matcher(
    [
        "no",
        "not",
        "never",
        "without",
        "refused",
        "declined",
        "withheld",
        "held",
        "wasn't",
        "weren't",
    ]
)
UNCERTAIN_RE = re.compile(
    r"\b(maybe|possibly|unclear|unsure|approximately|approx|might|may|considering|planned|prescribed|history|allerg(?:y|ic))\b",
    re.I,
)
OBS_PATTERNS = [
    (
        "blood_pressure",
        re.compile(
            r"\b(?:blood pressure|bp)\s*(?:was|is|of|at)?\s*(?P<s>"
            + NUM
            + r")\s*(?:/|over)\s*(?P<d>"
            + NUM
            + r")",
            re.I,
        ),
        "mmHg",
    ),
    (
        "heart_rate",
        re.compile(
            r"\b(?:heart rate|pulse|hr)\s*(?:was|is|of|at)?\s*(?P<v>" + NUM + r")", re.I
        ),
        "beats/min",
    ),
    (
        "spo2",
        re.compile(
            r"\b(?:spo2|oxygen saturation|saturation)\s*(?:was|is|of|at)?\s*(?P<v>"
            + NUM
            + r")",
            re.I,
        ),
        "%",
    ),
    (
        "respiratory_rate",
        re.compile(
            r"\b(?:respiratory rate|respirations|rr)\s*(?:was|is|of|at)?\s*(?P<v>"
            + NUM
            + r")",
            re.I,
        ),
        "breaths/min",
    ),
    (
        "temperature",
        re.compile(
            r"\b(?:temperature|temp)\s*(?:was|is|of|at)?\s*(?P<v>"
            + NUM
            + r")\s*(?P<u>celsius|fahrenheit|[cf])?\b",
            re.I,
        ),
        None,
    ),
]


def clauses(text):
    boundary = re.compile(
        r"(?<=[!?])\s+|(?<!\d)\.\s+(?=[A-Z])|(?<=\d)\.\s+(?=[A-Z])|[;\n]+|\s+(?:and|then|but)\s+(?=(?:at\s+\d{1,2}:\d{2}(?:\s*[ap]m)?\s+)?(?:gave|administered|started|applied|performed|checked|recorded|measured|refused|withheld)\b)",
        re.I,
    )
    start = 0
    for split in boundary.finditer(text):
        raw = text[start : split.start() + (1 if text[split.start()] == "." else 0)]
        if raw.strip():
            yield raw.strip(), start + len(raw) - len(raw.lstrip())
        start = split.end()
    raw = text[start:]
    if raw.strip():
        yield raw.strip(), start + len(raw) - len(raw.lstrip())


def extract_time(source):
    m = (
        TIME_RE.search(source)
        or COMPACT_TIME_RE.search(source)
        or SPOKEN_TIME_RE.search(source)
    )
    if not m:
        return None, None, []
    hour = m.groupdict().get("h") or m.groupdict().get("dh")
    minute_raw = m.groupdict().get("m") or m.groupdict().get("dm")
    try:
        h = int(number(hour))
        minute = int(number(minute_raw))
    except (ValueError, TypeError):
        return None, m, ["invalid_time"]
    ap = re.sub(r"[^apm]", "", (m.group("ap") or "").lower())
    if h > 23 or minute > 59 or (ap and not 1 <= h <= 12):
        return None, m, ["invalid_time"]
    ambiguous = not ap and 1 <= h <= 12 and not hour.startswith("0")
    if ap:
        h = h % 12 + (12 if ap == "pm" else 0)
    return f"{h:02d}:{minute:02d}", m, ["ambiguous_am_pm"] if ambiguous else []


def evidence(value, match, source):
    span = match.span() if match else None
    return Evidence(
        value=value,
        status="extracted" if value is not None else "missing",
        evidence=span,
        raw=source[span[0] : span[1]] if span else None,
    )


def required_flags(event):
    flags = []
    if event.event_type == "medication_administration":
        if not event.medication:
            flags.append("missing_medication")
        if not event.dose or event.dose.value is None or not event.dose.unit:
            flags.append("missing_dose")
        if not event.route:
            flags.append("missing_route")
    if not event.event_time:
        flags.append("missing_time")
    if event.event_type == "unclassified":
        flags.append("unclassified_statement")
    if event.event_type == "observation":
        obs = event.observation or {}
        if not obs.get("type"):
            flags.append("missing_observation_type")
        keys = (
            ["systolic", "diastolic"]
            if obs.get("type") == "blood_pressure"
            else ["value"]
        )
        if any(obs.get(key) is None for key in keys):
            flags.append("missing_observation_value")
        if not obs.get("unit"):
            flags.append("missing_observation_unit")
    return flags


def extract_events(text, words=None):
    events = []
    last_time = None
    inherited_flags = []
    segments = list(clauses(text))
    # Streaming ASR can punctuate a pause immediately after a clock time.
    # Merge a bare timestamp with the next statement, retaining original offsets.
    merged = []
    index = 0
    while index < len(segments):
        source, offset = segments[index]
        bare_time, match, _ = extract_time(source)
        remainder = (
            (source[: match.start()] + source[match.end() :]).strip(" .,")
            if match
            else source
        )
        if bare_time and not remainder and index + 1 < len(segments):
            following, next_offset = segments[index + 1]
            source = text[offset : next_offset + len(following)]
            index += 1
        merged.append((source, offset))
        index += 1
    for source, offset in merged:
        tm, time_match, time_flags = extract_time(source)
        time_source = "reported" if tm else "unknown"
        relative = re.search(r"\b(" + NUM + r")\s+minutes?\s+later\b", source, re.I)
        if relative and not tm:
            if last_time:
                anchor = datetime.strptime(last_time, "%H:%M")
                resolved = anchor + timedelta(minutes=number(relative.group(1)))
                tm = resolved.strftime("%H:%M")
                if resolved.date() != anchor.date():
                    time_flags.append("relative_date_rollover")
                time_source, time_match = "relative", relative
                time_flags += ["relative_time_review", *inherited_flags]
            else:
                time_flags.append("unresolved_relative_time")
        if tm:
            last_time = tm
            inherited_flags = [f for f in time_flags if f == "ambiguous_am_pm"]
        meds, procs = list(DRUG_RE.finditer(source)), list(PROC_RE.finditer(source))
        matches = [
            ("medication_administration", m, ALIASES[m.group().lower()])
            for m in meds
            if not any(p.start() <= m.start() < p.end() for p in procs)
        ]
        matches += [("procedure", m, m.group()) for m in procs]
        matches += [
            ("observation", m, (kind, unit))
            for kind, pattern, unit in OBS_PATTERNS
            for m in pattern.finditer(source)
        ]
        matches.sort(key=lambda v: v[1].start())
        if not matches:
            flags = ["unclassified_statement", *time_flags]
            if TRIGGER_RE.search(source) and DOSE_RE.search(source):
                flags.append("unknown_drug")
                candidate = DOSE_RE.sub(" ", source)
                candidate = TRIGGER_RE.sub(" ", candidate)
                candidate = ROUTE_RE.sub(" ", candidate)
                if time_match:
                    candidate = candidate.replace(time_match.group(), " ")
                candidate = re.sub(
                    r"\b(at|of|the|patient|was)\b", " ", candidate, flags=re.I
                )
                candidate = re.sub(r"[^a-z ]", " ", candidate.lower())
                candidate = " ".join(candidate.split())
                suggestion = get_close_matches(candidate, ALIASES, n=1, cutoff=0.8)
                if suggestion:
                    flags.append("suggested_medication:" + ALIASES[suggestion[0]])
            events.append(
                ClinicalEvent(
                    event_id=str(uuid.uuid4()),
                    event_type="unclassified",
                    description="Unclassified narrative statement",
                    event_time=tm,
                    time_source=time_source,
                    source_text=source,
                    source_offset=offset,
                    flags=flags,
                )
            )
            continue
        for index, (kind, entity, value) in enumerate(matches):
            start = matches[index - 1][1].end() if index else 0
            end = (
                matches[index + 1][1].start()
                if index + 1 < len(matches)
                else len(source)
            )
            doses = [m for m in DOSE_RE.finditer(source) if start <= m.start() < end]
            dm = min(
                doses,
                key=lambda m: min(
                    abs(m.end() - entity.start()), abs(m.start() - entity.end())
                ),
                default=None,
            )
            routes = [m for m in ROUTE_RE.finditer(source) if start <= m.start() < end]
            rm = min(routes, key=lambda m: abs(m.start() - entity.end()), default=None)
            flags, fields = list(time_flags), {}
            if len(meds) > 1:
                flags.append("multiple_entities_review")
            status = (
                "negated"
                if NEG_RE.search(source)
                else "uncertain"
                if UNCERTAIN_RE.search(source)
                else "reported"
            )
            if not TRIGGER_RE.search(source):
                if status != "negated":
                    status = "uncertain"
                flags.append("no_action_trigger")
            if status == "negated":
                flags.append("negated")
            if status == "uncertain":
                flags.append("uncertain_action")
            event = ClinicalEvent(
                event_id=str(uuid.uuid4()),
                event_type=kind,
                description=str(value)
                if kind != "observation"
                else value[0].replace("_", " "),
                source_text=source,
                source_offset=offset,
                event_time=tm,
                time_source=time_source,
                status=status,
                action_status={
                    "reported": "completed",
                    "negated": "not_done",
                    "uncertain": "unclear",
                }[status],
            )
            fields["event_time"] = evidence(tm, time_match, source)
            if kind == "medication_administration":
                event.medication = value
                fields["medication"] = evidence(value, entity, source)
                if dm:
                    if dm.group("sign"):
                        flags.append("invalid_dose")
                    else:
                        try:
                            event.dose = Dose(
                                value=number(dm.group("value")),
                                unit=UNIT_ALIASES.get(
                                    dm.group("unit").lower(), dm.group("unit").lower()
                                ),
                                source_text=dm.group(),
                            )
                        except ValueError:
                            flags.append("invalid_dose")
                event.route = ROUTES[rm.group().lower()] if rm else None
                fields["dose"] = evidence(
                    event.dose.model_dump() if event.dose else None, dm, source
                )
                fields["route"] = evidence(event.route, rm, source)
            elif kind == "procedure":
                fields["description"] = evidence(event.description, entity, source)
            else:
                obs_kind, unit = value
                if obs_kind == "blood_pressure":
                    obs = {
                        "type": obs_kind,
                        "systolic": number(entity.group("s")),
                        "diastolic": number(entity.group("d")),
                        "unit": unit,
                    }
                else:
                    if obs_kind == "temperature":
                        u = entity.groupdict().get("u")
                        unit = (
                            "Cel"
                            if u and u.lower().startswith("c")
                            else "[degF]"
                            if u
                            else None
                        )
                        if not unit:
                            flags.append("missing_observation_unit")
                    obs = {
                        "type": obs_kind,
                        "value": number(entity.group("v")),
                        "unit": unit,
                    }
                event.observation = obs
                fields["observation"] = evidence(obs, entity, source)
            if words and any(
                w.prob < 0.65 and w.w.strip().lower() in source.lower() for w in words
            ):
                flags.append("low_asr_confidence")
            event.fields = fields
            event.flags = list(dict.fromkeys(flags + required_flags(event)))
            events.append(event)
    for i, event in enumerate(events):
        if re.search(r"\b(correction|actually|sorry)\b", event.source_text, re.I):
            event.flags = list(dict.fromkeys(event.flags + ["conflicting_values"]))
            if i:
                events[i - 1].flags = list(
                    dict.fromkeys(events[i - 1].flags + ["conflicting_values"])
                )
    return events
