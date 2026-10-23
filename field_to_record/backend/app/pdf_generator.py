from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.units import inch
from xml.sax.saxutils import escape

def create_pdf(bundle):
    record = bundle["record"]; out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=.5*inch, rightMargin=.5*inch, topMargin=.5*inch, bottomMargin=.5*inch)
    styles = getSampleStyleSheet()
    story = [Paragraph("Field-to-Record — Synthetic Demo Record", styles["Title"]),
        Paragraph("Prototype only. Not a clinically verified record.", styles["Italic"]), Spacer(1,10),
        Paragraph("<b>Record ID:</b> "+escape(bundle["record_id"]), styles["BodyText"]),
        Paragraph("<b>Case ID:</b> "+escape(record.get("case_id","")), styles["BodyText"]),
        Paragraph("<b>Responder:</b> "+escape(record.get("responder_id","")), styles["BodyText"]),
        Paragraph("<b>Status:</b> "+escape(record.get("record_status","pending_review")), styles["BodyText"]),
        Paragraph("<b>Created:</b> "+escape(bundle.get("created_at","")), styles["BodyText"]), Spacer(1,10),
        Paragraph("Original narrative", styles["Heading2"]),
        Paragraph(escape(record.get("narrative","")).replace("\n", "<br/>"), styles["BodyText"]), Spacer(1,10),
        Paragraph("Extracted events — human review required", styles["Heading2"])]
    events = record.get("events", [])
    if not events:
        story.append(Paragraph("No events were extracted. The original narrative is preserved above.", styles["BodyText"]))
    for index, event in enumerate(events, 1):
        dose = event.get("dose") or {}
        dose_text = " ".join(str(value) for value in (dose.get("value"), dose.get("unit")) if value is not None)
        fields = [
            ("Type", event.get("event_type", "")),
            ("Description", event.get("description", "")),
            ("Medication", event.get("medication") or "Not stated"),
            ("Dose", dose_text or "Not stated"),
            ("Dose source", dose.get("source_text") or "Not stated"),
            ("Route", event.get("route") or "Not stated"),
            ("Event time", event.get("event_time") or "Unknown"),
            ("Time source", event.get("time_source", "unknown")),
            ("Status", event.get("status", "")),
            ("Review status", event.get("review_status", "")),
            ("Source text", event.get("source_text", "")),
            ("Flags", "; ".join(event.get("flags", [])) or "None"),
        ]
        table = Table(
            [[Paragraph(f"<b>{escape(label)}</b>", styles["BodyText"]),
              Paragraph(escape(str(value)).replace("\n", "<br/>"), styles["BodyText"])]
             for label, value in fields],
            colWidths=[1.15*inch, 5.2*inch],
        )
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), .35, colors.grey),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef3f4")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.extend([Paragraph(f"Event {index}", styles["Heading3"]), table, Spacer(1, 8)])
    story.append(Paragraph("Audit history",styles["Heading2"]))
    for a in bundle.get("audit",[]):
        story.append(Paragraph(escape(f'{a["timestamp"]} — {a["action"]} by {a["actor"]} — hash {a["entry_hash"][:16]}…'),styles["BodyText"]))
    doc.build(story); return out.getvalue()
