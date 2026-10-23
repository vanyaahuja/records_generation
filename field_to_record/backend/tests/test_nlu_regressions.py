import pytest
from hypothesis import given, strategies as st
from app.extraction import extract_events
from app.normalize import normalize_with_offsets, number


@pytest.mark.parametrize(
    "alias,canonical",
    [
        ("paracetamol", "paracetamol"),
        ("acetaminophen", "paracetamol"),
        ("albuterol", "salbutamol"),
        ("epinephrine", "adrenaline"),
        ("GTN", "nitroglycerin"),
    ],
)
def test_aliases(alias, canonical):
    e = extract_events(f"At 14:05 gave 5 mg {alias} IV.")[0]
    assert e.medication == canonical and e.dose.value == 5 and e.route == "intravenous"


def test_multiple_events_keep_their_fields():
    events = extract_events(
        "At 10:42 gave 5 mg fictional agent X IV and at 10:44 gave 10 mg fictional agent Y orally."
    )
    assert len(events) == 2
    assert [(e.dose.value, e.route, e.event_time) for e in events] == [
        (5, "intravenous", "10:42"),
        (10, "oral", "10:44"),
    ]


def test_clause_negation_and_refusal():
    e = extract_events(
        "No allergy reported; administered 5 mg fictional agent X intravenously at 14:42."
    )[-1]
    assert e.status == "reported"
    assert (
        extract_events("Patient refused fictional agent X.")[0].action_status
        == "not_done"
    )
    assert (
        extract_events("Considering fictional agent X.")[0].action_status == "unclear"
    )


def test_spoken_numbers_and_times():
    e = extract_events("Gave five milligrams fictional agent X orally at ten thirty.")[
        0
    ]
    assert e.dose.value == 5 and e.event_time == "10:30"
    assert "ambiguous_am_pm" in e.flags


def test_asr_clock_formats_and_pause():
    for time in ["1405", "14.05", "14:05"]:
        e = extract_events(f"At {time}. Gave 5 mg fictional agent X IV.")[0]
        assert e.medication == "fictional agent x" and e.event_time == "14:05"
        assert e.fields["event_time"].raw.lower().startswith("at")


def test_procedures_and_observations():
    e = extract_events("At 14:42 performed CPR and bandaging.")
    assert len(e) == 2
    e = extract_events("At 14:10 recorded blood pressure one twenty over eighty.")[0]
    assert e.observation == {
        "type": "blood_pressure",
        "systolic": 120,
        "diastolic": 80,
        "unit": "mmHg",
    }
    assert (
        extract_events("At 14:15 measured temperature 37 celsius.")[0].observation[
            "unit"
        ]
        == "Cel"
    )


def test_correction_and_negative_dose_are_flagged():
    events = extract_events(
        "At 14:42 gave 5 mg fictional agent X IV. Correction: dose was 2 mg."
    )
    assert all("conflicting_values" in e.flags for e in events)
    e = extract_events("Administered -5 mg fictional agent X intravenously.")[0]
    assert e.dose is None and "invalid_dose" in e.flags


def test_relative_time_and_evidence():
    text = "At 14:05 gave 5 mg fictional agent X IV. Two minutes later performed bandaging."
    events = extract_events(text)
    assert events[1].event_time == "14:07" and events[1].time_source == "relative"
    for e in events:
        assert (
            text[e.source_offset : e.source_offset + len(e.source_text)]
            == e.source_text
        )
        for field in e.fields.values():
            if field.evidence:
                a, b = field.evidence
                assert e.source_text[a:b] == field.raw


@given(
    st.text(
        alphabet="abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,",
        max_size=200,
    )
)
def test_offset_map_is_in_original_bounds(text):
    normalized, offsets = normalize_with_offsets(text)
    assert len(normalized) == len(offsets)
    assert all(0 <= a < b <= len(text) for a, b in offsets)


@pytest.mark.parametrize(
    "raw,value",
    [(str(i), i) for i in range(60)]
    + [
        ("five", 5),
        ("five hundred", 500),
        ("one twenty", 120),
        ("zero point five", 0.5),
    ],
)
def test_number_golden(raw, value):
    assert number(raw) == value
