from datetime import datetime, timezone
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict

class ExtractRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    case_id: str = Field(default="DEMO-001", max_length=100)
    responder_id: str = Field(default="DEMO-RESPONDER", max_length=100)

class Dose(BaseModel):
    value: Optional[float] = None
    unit: Optional[str] = None
    source_text: Optional[str] = None

class ClinicalEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str
    event_type: Literal["medication_administration", "procedure", "observation", "unclassified"]
    description: str
    medication: Optional[str] = None
    dose: Optional[Dose] = None
    route: Optional[str] = None
    event_time: Optional[str] = None
    time_source: Literal["reported", "unknown"] = "unknown"
    status: Literal["reported", "negated", "uncertain", "needs_review"] = "needs_review"
    source_text: str
    review_status: Literal["needs_human_confirmation", "confirmed", "corrected"] = "needs_human_confirmation"
    flags: list[str] = Field(default_factory=list)

class SaveRecordRequest(BaseModel):
    case_id: str = Field(min_length=1, max_length=100)
    responder_id: str = Field(min_length=1, max_length=100)
    narrative: str = Field(min_length=1, max_length=20000)
    events: list[ClinicalEvent]
    record_status: Literal["pending_review", "reviewed"] = "pending_review"
    reviewer_id: Optional[str] = None
