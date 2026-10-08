from typing import Any, Literal
from pydantic import BaseModel, Field

class Risk(BaseModel):
    level: Literal["HIGH", "MEDIUM", "LOW"]
    score: float = Field(ge=0, le=1)
    revenue_at_risk: float = Field(ge=0)
    basis: str = "Estimated 90-day gross revenue exposure; score is a heuristic, not a churn probability"

class TraceEvent(BaseModel):
    id: str
    stage: Literal["OBSERVE", "INVESTIGATE", "DIAGNOSE", "SIMULATE", "DECIDE", "ACT", "MEASURE"]
    type: str
    title: str
    summary: str
    status: str = "COMPLETED"
    tool: str | None = None
    confidence: float | None = None
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    tool_call_id: str | None = None

class Case(BaseModel):
    case_id: str
    patient: dict[str, Any]
    status: str = "READY"
    risk: Risk
    signals: list[dict[str, Any]] = Field(default_factory=list)
    diagnosis: dict[str, Any] | None = None
    investigate: dict[str, Any] | None = None
    interventions: list[dict[str, Any]] = Field(default_factory=list)
    action: dict[str, Any] | None = None
    outcome: dict[str, Any] | None = None
    trace: list[TraceEvent] = Field(default_factory=list)
    issue: str = "Behavioral disengagement signals"
    last_visit_label: str = "Unknown"
    last_activity_at: str = ""
    as_of_date: str
    orchestration_mode: str = "deterministic"
    limitations: list[str] = Field(default_factory=list)
    agent_run: dict[str, Any] | None = None
    decision: dict[str, Any] | None = None

class RunRequest(BaseModel):
    patient_id: str | None = Field(default=None, pattern=r'^PT[0-9]{1,12}$')
    message: str | None = Field(default=None, max_length=2000)

class CasesResponse(BaseModel):
    cases: list[Case]

class RunResponse(BaseModel):
    success: bool = True
    case: Case
