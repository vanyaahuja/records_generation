"""Public contracts, exported as JSON Schema and TypeScript."""

from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, field_validator, StringConstraints
import math

SourceString = Annotated[str, StringConstraints(strip_whitespace=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, allow_inf_nan=False
    )

    @field_validator("text", "narrative", check_fields=False)
    @classmethod
    def nonblank_source(cls, value):
        if not value.strip():
            raise ValueError("Source text cannot be blank")
        return value


class Word(StrictModel):
    w: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    prob: float = Field(ge=0, le=1)


class ExtractRequest(StrictModel):
    text: SourceString = Field(min_length=1, max_length=20000)
    case_id: str = Field(default="DEMO-001", min_length=1, max_length=100)
    responder_id: str = Field(default="DEMO-RESPONDER", min_length=1, max_length=100)
    encounter_date: str | None = None
    tz: str = "Asia/Kolkata"
    words: list[Word] = Field(default_factory=list, max_length=10000)


class Dose(StrictModel):
    value: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=30)
    source_text: SourceString | None = None


class Evidence(StrictModel):
    value: object = None
    status: Literal["extracted", "corrected", "missing", "needs_review"] = "missing"
    confidence: float | None = None
    evidence: tuple[int, int] | None = None
    raw: SourceString | None = None


class ClinicalEvent(StrictModel):
    event_id: str
    event_type: Literal[
        "medication_administration", "procedure", "observation", "unclassified"
    ]
    description: str = Field(min_length=1, max_length=1000)
    medication: str | None = None
    dose: Dose | None = None
    route: str | None = None
    observation: dict | None = None
    event_time: str | None = None
    time_source: Literal["reported", "relative", "unknown"] = "unknown"
    action_status: Literal["completed", "not_done", "unclear"] = "unclear"
    status: Literal["reported", "negated", "uncertain", "needs_review"] = "needs_review"
    source_text: SourceString
    source_offset: int = Field(default=0, ge=0)
    fields: dict[str, Evidence] = Field(default_factory=dict)
    review_status: Literal["needs_human_confirmation", "confirmed", "corrected"] = (
        "needs_human_confirmation"
    )
    flags: list[str] = Field(default_factory=list)
    accepted_flags: list[str] = Field(default_factory=list)
    manual: bool = False

    @field_validator("observation")
    @classmethod
    def validate_observation(cls, value):
        if value is None:
            return value
        if value.get("type") not in [
            None,
            "blood_pressure",
            "heart_rate",
            "spo2",
            "respiratory_rate",
            "temperature",
        ]:
            raise ValueError("Unsupported observation type")
        for key in ["value", "systolic", "diastolic"]:
            number = value.get(key)
            if number is not None and (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
            ):
                raise ValueError("Observation values must be finite numbers or unknown")
        if value.get("unit") is not None and not isinstance(value["unit"], str):
            raise ValueError("Observation unit must be text")
        return value


class SaveRecordRequest(StrictModel):
    case_id: str = Field(min_length=1, max_length=100)
    responder_id: str = Field(min_length=1, max_length=100)
    narrative: SourceString = Field(min_length=1, max_length=20000)
    events: list[ClinicalEvent] = Field(max_length=500)
    extraction_id: str | None = None
    record_status: Literal["pending_review", "reviewed"] = "pending_review"
    reviewer_id: str | None = Field(default=None, max_length=100)
    expected_version: int | None = Field(default=None, ge=1)
    encounter_date: str | None = None
    tz: str = "Asia/Kolkata"


class Record(StrictModel):
    case_id: str
    responder_id: str
    narrative: SourceString
    events: list[ClinicalEvent]
    record_status: Literal["pending_review", "reviewed"]
    reviewer_id: str | None
    extraction_id: str | None
    extraction_hash: str
    recorded_at: str
    updated_at: str
    encounter_date: str | None = None
    tz: str = "Asia/Kolkata"
    model_versions: dict[str, str] = Field(default_factory=dict)


class Transcript(StrictModel):
    text: str
    words: list[Word]
    segments: list[dict]
    duration: float
    rtf: float
    inference_ms: float
    model: str
    language: str


class ErrorEnvelope(StrictModel):
    detail: str | list | dict
    request_id: str | None = None
