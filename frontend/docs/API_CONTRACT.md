# NAME TBD Frontend API Contract

This is the contract Hayden's React app expects from Eva's backend. The frontend works against mock data until `VITE_USE_MOCK_API=false`.

## Endpoints

```text
GET  /api/summary
GET  /api/cases
GET  /api/cases/:caseId
POST /api/cases/:caseId/run
POST /api/cases/:caseId/approve
POST /api/cases/:caseId/reject
```

## Summary response

```json
{
  "cases_detected": 137,
  "high_risk_cases": 24,
  "revenue_at_risk": 84250,
  "potentially_recoverable": 31800,
  "revenue_recovered": 32690,
  "actions_executed": 18,
  "awaiting_approval": 4
}
```

## Case shape

```json
{
  "case_id": "CASE-0054827",
  "patient": { "patient_id": "PT0054827" },
  "status": "READY",
  "risk": {
    "level": "HIGH",
    "score": 0.91,
    "revenue_at_risk": 1240
  },
  "signals": [],
  "diagnosis": null,
  "interventions": [],
  "action": null,
  "outcome": null,
  "trace": []
}
```

## Trace event shape

The UI intentionally displays an auditable trace, not private model chain-of-thought.

```json
{
  "id": "evt-2",
  "stage": "INVESTIGATE",
  "type": "TOOL_CALL",
  "title": "Appointment behavior retrieved",
  "tool": "get_appointment_behavior",
  "summary": "Found 2 recent cancellations and no upcoming appointment.",
  "status": "COMPLETED"
}
```

Allowed workflow stages:

```text
OBSERVE
INVESTIGATE
DIAGNOSE
SIMULATE
DECIDE
ACT
MEASURE
```

## Run response

`POST /api/cases/:caseId/run` should return the completed case. The frontend animates the returned trace locally, so the backend does not need WebSockets or server-sent events for the hackathon MVP.

```json
{
  "success": true,
  "case": { "...": "complete case object" }
}
```

## Approval rules

When a selected intervention changes pricing or otherwise requires human authorization:

```json
{
  "action": {
    "status": "PENDING_APPROVAL",
    "requires_approval": true,
    "approval_status": "PENDING"
  }
}
```

The frontend then enables Approve and Reject actions.

After approval, the backend should return an updated case that continues from `ACT` through `MEASURE`, including an `outcome` and a final `MEASURE` trace event.

After rejection, the backend may either return the case to manual review or re-run the safe decision path. For the demo flow, the mock backend re-enters `SIMULATE`, selects a non-financial fallback in `DECIDE`, executes it in `ACT`, and completes `MEASURE`.
