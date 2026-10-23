from app.extraction import extract_events


def test_medication_fields():
    e = extract_events(
        "At 10:42, administered 5 mg of fictional agent X intravenously."
    )[0]
    assert e.event_type == "medication_administration"
    assert e.dose.value == 5 and e.dose.unit == "mg"
    assert e.route == "intravenous" and e.event_time == "10:42"


def test_negation():
    assert (
        extract_events("No fictional agent X was administered.")[0].status == "negated"
    )


def test_unknown_preserved():
    e = extract_events("Responder noted an unusual sound.")[0]
    assert e.event_type == "unclassified" and "unusual sound" in e.source_text


def test_all_narrative_statements_are_preserved():
    narrative = "Responder arrived at 10:40. At 10:42, administered 5 mg of fictional agent X intravenously. Patient was alert."
    events = extract_events(narrative)
    assert len(events) == 3
    assert [event.source_text for event in events] == [
        "Responder arrived at 10:40.",
        "At 10:42, administered 5 mg of fictional agent X intravenously.",
        "Patient was alert.",
    ]
