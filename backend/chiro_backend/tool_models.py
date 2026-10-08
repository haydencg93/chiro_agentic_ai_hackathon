"""Typed SQL results and strict native-function arguments for the runtime agent."""
from enum import StrEnum
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

PatientID = str

class ToolResult(BaseModel):
    model_config = ConfigDict(extra='ignore', allow_inf_nan=False)

class Patient(ToolResult):
    patient_id: str
    home_location_id: str | None = None
    acquisition_source: str | None = None
    first_visit_date: str | None = None
    tenure_months: int | None = None
    age_band: str | None = None
    # Generator status/churn score, names, and contact information are excluded.

class Visit(ToolResult):
    visit_id: str
    appointment_id: str
    patient_id: str
    provider_id: str
    location_id: str
    visit_date: str
    service_type: str
    revenue: float = Field(ge=0)
    payment_type: str

class PatientHistory(ToolResult):
    patient: Patient
    visits: list[Visit]
    visits_returned: int = Field(ge=0)
    history_limit: int = 100

class AppointmentBehavior(ToolResult):
    as_of_date: str
    recent_appointments: int = Field(ge=0)
    missed_appointments: int = Field(ge=0)
    missed_rate: float = Field(ge=0, le=1)
    window_days: int = 90
    completed_appointments: int = Field(default=0,ge=0)
    cancelled_appointments: int = Field(default=0,ge=0)
    no_show_appointments: int = Field(default=0,ge=0)

class RevenueRisk(ToolResult):
    patient_id: str
    as_of_date: str
    gap_days: int | None = Field(ge=0)
    recent_visits: int = Field(ge=0)
    prior_visits: int = Field(ge=0)
    mean_revenue: float = Field(ge=0)
    appointments: int = Field(ge=0)
    missed: int = Field(ge=0)
    score: float = Field(ge=0,le=1)
    revenue_at_risk: float = Field(ge=0)
    level: Literal['HIGH','MEDIUM','LOW']
    decline: float = Field(ge=0,le=1)
    miss_rate: float = Field(ge=0,le=1)
    completed_appointments: int = Field(default=0,ge=0)
    cancelled_appointments: int = Field(default=0,ge=0)
    no_show_appointments: int = Field(default=0,ge=0)
    horizon_days: int = 90
    value_type: Literal['ESTIMATED'] = 'ESTIMATED'
    basis: str = '90-day gross exposure = max(prior, recent visits) × mean visit revenue × heuristic risk score; not observed recovery'

class PatientPatterns(ToolResult):
    patient_id: str
    as_of_date: str
    recent_visits: int
    prior_visits: int
    decline: float
    gap_days: int | None
    recent_distinct_locations: int
    prior_distinct_locations: int
    recent_distinct_providers: int
    prior_distinct_providers: int
    location_change_observed: bool
    provider_change_observed: bool
    limitation: str = 'Changes in provider/location identifiers do not prove friction; no notes or affordability evidence exists.'

class Intervention(StrEnum):
    STAFF_OUTREACH='STAFF_OUTREACH'
    SCHEDULING_ASSISTANCE='SCHEDULING_ASSISTANCE'
    ALTERNATE_LOCATION='ALTERNATE_LOCATION'
    ALTERNATE_PROVIDER='ALTERNATE_PROVIDER'
    VALUE_EDUCATION='VALUE_EDUCATION'
    DISCOUNT='DISCOUNT'
    NO_ACTION='NO_ACTION'

class Diagnosis(StrEnum):
    SCHEDULING_FRICTION='SCHEDULING_FRICTION'
    VISIT_FREQUENCY_DECLINE='VISIT_FREQUENCY_DECLINE'
    REPEATED_MISSED_APPOINTMENTS='REPEATED_MISSED_APPOINTMENTS'
    LOCATION_FRICTION='LOCATION_FRICTION'
    PROVIDER_FRICTION='PROVIDER_FRICTION'
    VALUE_CONCERN='VALUE_CONCERN'
    GENERAL_DISENGAGEMENT='GENERAL_DISENGAGEMENT'
    INSUFFICIENT_EVIDENCE='INSUFFICIENT_EVIDENCE'

class StrictArguments(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    patient_id: str = Field(pattern=r'^PT[0-9]{1,12}$')

class PatientArguments(StrictArguments):
    pass

class InterventionArguments(StrictArguments):
    intervention: Intervention

class Evidence(BaseModel):
    model_config = ConfigDict(extra='forbid',strict=True,allow_inf_nan=False)
    tool_call_id: str = Field(min_length=1,max_length=150)
    field: str = Field(pattern=r'^[a-z_]+(?:\.[a-z_]+|\.[0-9]+)*$',max_length=120)
    value: str | int | float | bool | None

class DecisionArguments(StrictArguments):
    phase: Literal['DIAGNOSE','DECIDE']
    diagnosis: Diagnosis
    confidence: float = Field(ge=0,le=1)
    evidence_ids: list[str] = Field(min_length=2,max_length=6)
    rationale: str = Field(min_length=10,max_length=600)
    intervention: Intervention | None

class FinalDecision(StrictArguments):
    diagnosis: Diagnosis
    intervention: Intervention
    decision_id: str
    action_id: str

class Economics(ToolResult):
    intervention_id: Intervention
    name: str
    description: str
    expected_recovery: float = Field(ge=0)
    estimated_cost: float = Field(ge=0)
    net_value: float
    recovery_probability: float = Field(ge=0,le=1)
    requires_approval: bool
    approval_reason: str | None
    selected: bool = False
    value_type: Literal['SIMULATED'] = 'SIMULATED'
    assumption_version: str = 'demo-v1'
    incremental_net_value: float

class DiagnosisPlan(StrictArguments):
    diagnosis: Diagnosis
    confidence: float = Field(ge=0,le=1)
    evidence_ids: list[str] = Field(min_length=2,max_length=6)
    rationale: str = Field(min_length=10,max_length=600)
    interventions: list[Intervention] = Field(min_length=1,max_length=7)

class SelectionArguments(StrictArguments):
    intervention: Intervention
    evidence_ids: list[str] = Field(min_length=2,max_length=6)
    simulation_ids: list[str] = Field(min_length=1,max_length=7)
    rationale: str = Field(min_length=10,max_length=600)

class ObservedVisit(ToolResult):
    visit_id: str
    visit_date: str
    provider_id: str
    location_id: str
    revenue: float = Field(ge=0)

class Snapshot(ToolResult):
    patient: Patient
    visit_history: list[ObservedVisit]
    history_limit: int
    appointment_behavior: AppointmentBehavior
    revenue_risk: RevenueRisk
    snapshot_date: str
    evidence: list[dict]
    interventions: list[dict]
    limitations: list[str]
    snapshot_model_calls: int = 0
