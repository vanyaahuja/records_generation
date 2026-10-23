"""Compact deterministic handover record with complete source and audit identity."""

from io import BytesIO
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)
from .database import digest


def create_pdf(bundle):
    record = bundle["record"]
    output = BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(
        output,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=32,
        bottomMargin=36,
        title="Field-to-Record synthetic handover",
        author="Field-to-Record",
    )

    def p(text, style="BodyText"):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), styles[style])

    def table(rows):
        result = Table(
            [[p(label), p(value)] for label, value in rows],
            colWidths=[100, 428],
            hAlign="LEFT",
        )
        result.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d9d9d9")),
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef3f4")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        return result

    story = [
        p("Field-to-Record - Synthetic Handover", "Title"),
        p("Prototype only. Not a clinically verified record.", "Italic"),
        Spacer(1, 12),
        table(
            [
                (
                    "Case / responder",
                    record["case_id"] + " / " + record["responder_id"],
                ),
                (
                    "Review",
                    record["record_status"]
                    + " / "
                    + (record.get("reviewer_id") or "NOT DOCUMENTED"),
                ),
                (
                    "Captured / revision",
                    record["recorded_at"] + " / " + str(bundle["version"]),
                ),
            ]
        ),
        Spacer(1, 10),
        p("Original narrative", "Heading2"),
        p(record["narrative"]),
        Spacer(1, 8),
        p("Time-ordered events", "Heading2"),
    ]
    for index, event in enumerate(
        sorted(record["events"], key=lambda e: e.get("event_time") or "99:99"), 1
    ):
        rows = [
            (
                "Action / review",
                event["action_status"].replace("_", " ")
                + " / "
                + event["review_status"],
            )
        ]
        if event["event_type"] == "medication_administration":
            dose = event.get("dose") or {}
            rows += [
                ("Medication", event.get("medication") or "NOT DOCUMENTED"),
                (
                    "Dose",
                    f"{dose['value']:g} {dose.get('unit') or 'NOT DOCUMENTED'}"
                    if dose.get("value") is not None
                    else "NOT DOCUMENTED",
                ),
                ("Route", event.get("route") or "NOT DOCUMENTED"),
            ]
        elif event["event_type"] == "observation":
            obs = event.get("observation") or {}
            unit = obs.get("unit") or "NOT DOCUMENTED"
            value = (
                f"{obs.get('systolic', 'NOT DOCUMENTED')}/{obs.get('diastolic', 'NOT DOCUMENTED')} {unit}"
                if obs.get("type") == "blood_pressure"
                else f"{obs.get('value', 'NOT DOCUMENTED')} {unit}"
            )
            rows.append(("Observation", value))
        block = [
            p(
                f"{index}. {event.get('event_time') or 'TIME NOT DOCUMENTED'} - {event['description']}",
                "Heading3",
            ),
            table(rows),
            Spacer(1, 5),
            p("Source: " + event["source_text"]),
        ]
        if event["flags"]:
            block.append(
                p(
                    "Flags: "
                    + ", ".join(event["flags"])
                    + " | Accepted: "
                    + (", ".join(event["accepted_flags"]) or "None")
                )
            )
        block.append(Spacer(1, 9))
        story.append(KeepTogether(block))
    story += [
        p("Audit identity", "Heading2"),
        p("Record ID: " + bundle["record_id"]),
        p("Record hash: " + digest(record)),
        p(
            "Original extraction hash: "
            + record.get("extraction_hash", "NOT DOCUMENTED")
        ),
    ]
    for event in bundle.get("audit", []):
        story.append(
            p(
                f"{event['timestamp']} - {event['action']} by {event['actor']} - {event['entry_hash'][:20]}"
            )
        )

    def footer(canvas, doc):
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#526970"))
        canvas.drawString(36, 20, "Synthetic demonstration - review required")
        canvas.drawRightString(576, 20, f"Page {doc.page}")

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
