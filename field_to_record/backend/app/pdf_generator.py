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
    LongTable,
)
from .database import digest
from .soap import event_rows


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
                ("Patient", f"{record['patient']['name']} / {record['patient']['age']} years / {record['patient']['gender']}" if record.get('patient') else "Not assigned"),
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
    ]
    story += [p('Recorded events', 'Heading2')]
    rows = [[p(label) for label in ['Time','Event','Reading / details','Action / review']]]
    entries = event_rows(record)
    for row in entries:
        rows.append([p(row['time'] or 'Not documented'),p(row['entry']),p(row['value']),p(row['action_status'].replace('_',' ')+' / '+row['review_status'].replace('_',' '))])
    if len(rows) == 1:
        rows.append([p('Not documented'),p(''),p(''),p('')])
    grid = LongTable(rows,colWidths=[70,160,150,148],repeatRows=1,hAlign='LEFT')
    grid.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#f1f1f1')),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#dedede')),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story += [grid,Spacer(1,10)]
    for row in entries:
        if row['flags']:
            story.append(p(row['entry']+' — Flags: '+', '.join(row['flags'])+' | Accepted: '+(', '.join(row['accepted_flags']) or 'None')))
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
