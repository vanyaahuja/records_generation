"""Synthetic gold data, split by template family. No patient records or treatment labels."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = [
    "At 14:05 gave {dose} mg {drug} IV.",
    "At 14:05 administered {drug} {dose} mg intravenously.",
    "At 14:05 administered {dose} milligrams of {drug} intravenously.",
    "Gave {drug} at 14:05, {dose} mg IV.",
    "At 14:05, the responder gave {dose} mg {drug} IV.",
    "At 14:05 received {dose} mg {drug} intravenously.",
    "At 14:05 started {drug}, {dose} mg, IV.",
    "At 14:05 administered {dose} mg {drug} by mouth.",
    "At 14:05 gave {dose} mg {drug} orally.",
    "At 14:05 administered {drug} orally, {dose} mg.",
    "At 14:05 gave {dose} mg of {drug} PO.",
    "Gave {dose} mg {drug} IV at 14:05.",
    "Administered {dose} mg {drug} at 14:05 intravenously.",
    "At 14:05 gave {drug} IV, dose {dose} mg.",
    "At 14:05, gave {dose} mg {drug} IV push.",
    "At 14:05 did not give {dose} mg {drug} IV.",
    "At 14:05 patient refused {dose} mg {drug} orally.",
    "At 14:05 possibly gave {dose} mg {drug} IV.",
    "At 14:05 administered {drug} intravenously.",
    "Gave {dose} mg {drug} IV.",
    "At 14:05 administered {dose} mg {drug}.",
    "At 14:05, administered {drug}.",
    "At 14:05 administered five milligrams {drug} intravenously.",
    "At 14:05 gave {dose} mg {drug} IV and at 14:07 performed bandaging.",
    "At 14:05 gave {dose} mg {drug} IV. At 14:07 recorded blood pressure 120/80.",
]


def generate():
    directory = ROOT / "data/gold"
    directory.mkdir(exist_ok=True)
    sets = {"dev": [], "held_out": []}
    for family, template in enumerate(TEMPLATES):
        split = "dev" if family < 20 else "held_out"
        for i in range(10 if split == "dev" else 20):
            drug = ["fictional agent x", "fictional agent y", "demo medication"][i % 3]
            dose = [2, 5, 10, 20][i % 4]
            text = template.format(dose=dose, drug=drug)
            missing_dose = family in [18, 21]
            missing_route = family in [20, 21]
            missing_time = family == 19
            med = {
                "event_type": "medication_administration",
                "medication": drug,
                "dose": None
                if missing_dose
                else {"value": 5 if family == 22 else dose, "unit": "mg"},
                "route": None
                if missing_route
                else "oral"
                if family in [7, 8, 9, 10, 16]
                else "intravenous",
                "event_time": None if missing_time else "14:05",
                "action_status": "not_done"
                if family in [15, 16]
                else "unclear"
                if family == 17
                else "completed",
            }
            events = [med]
            if family == 23:
                events.append(
                    {
                        "event_type": "procedure",
                        "description": "bandaging",
                        "event_time": "14:07",
                        "action_status": "completed",
                    }
                )
            if family == 24:
                events.append(
                    {
                        "event_type": "observation",
                        "observation": {
                            "type": "blood_pressure",
                            "systolic": 120,
                            "diastolic": 80,
                            "unit": "mmHg",
                        },
                        "event_time": "14:07",
                        "action_status": "completed",
                    }
                )
            sets[split].append(
                {
                    "id": f"{family:02}-{i:03}",
                    "family": family,
                    "text": text,
                    "events": events,
                }
            )
    for name, rows in sets.items():
        (directory / (name + ".jsonl")).write_text(
            "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
        )
    print({name: len(rows) for name, rows in sets.items()})


if __name__ == "__main__":
    generate()
