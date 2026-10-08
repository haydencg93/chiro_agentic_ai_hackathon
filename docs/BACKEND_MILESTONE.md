# Backend milestone

The backend preserves Hayden's frontend. The original frontend contract lives in
`frontend/docs/API_CONTRACT.md`. The backend additionally exposes `/health`,
`POST /api/agent/run` with `{"patient_id":"<real ID>"}`, and
`POST /api/actions/{action_id}/approve`. Interactive schemas: `/docs` and `/openapi.json`.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
# Configure a user-selected authenticated profile and verified warehouse:
export CHIRO_PROFILE='<selected profile>'
export CHIRO_WAREHOUSE_ID='<verified warehouse ID>'
.venv/bin/uvicorn chiro_backend.app:app --app-dir backend --host 127.0.0.1 --port 8000
```

No credentials are embedded. Databricks SDK unified authentication uses existing
local configuration. Do not place tokens in frontend VITE variables.
Frontend integration settings (Hayden can set these in his local environment):
`VITE_USE_MOCK_API=false`, `VITE_API_BASE_URL=http://localhost:8000/api`.
No frontend files were edited. CORS defaults to `http://localhost:5173`;
`CHIRO_CORS_ORIGINS` accepts a JSON list. Local API is intended for localhost.

`GET /health` is liveness only and explicitly reports `databricks: not_checked`.
`GET /api/cases` returns `{"cases": [...]}` as required by the actual React gateway
consumers; patient IDs and `CASE-<patient_id>` IDs are both accepted by detail routes.
`GET /health?check_databricks=true` runs `SELECT 1`; data failure returns 503.
All data routes use real Databricks queries. Missing patients/actions return 404;
invalid approval state returns 409. Blocking SDK calls run in FastAPI's synchronous
route thread pool.

## Behavioral calculations

Analysis is anchored to the latest observed visit/appointment date. A recent window
is `(as_of - 90 days, as_of]`; the prior window is `(as_of - 180 days, as_of - 90 days]`.
Generated patient risk scores/statuses are never used. Missing future bookings
are not evidence because the generator does not create future appointments.

- Visit decline: `max(0, (prior_visits - recent_visits) / prior_visits)` when prior >= 2.
- Missed appointment rate: recent cancellations/no-shows divided by recent appointments.
- Gap signal: `clamp((gap_days - 30) / 60, 0, 1)` with at least two visits in 180 days.
- Heuristic score: `0.45 * decline + 0.30 * missed_rate + 0.25 * gap_signal`.
- Estimated 90-day gross exposure: `max(prior_visits, recent_visits) * mean_nonnegative_visit_revenue * score`.

This is a ranking heuristic, not a calibrated probability, prognosis, or causal model.
The revenue column must be checked against actual table semantics before treating
exposure as collected revenue. No price/scheduling cause is inferred from cancellations.
Cases are the top 100 from a bounded 1000-patient baseline-revenue candidate pool;
summary totals cover this queue only. Historical detail is limited to 100 visits.

## Workflow and approval semantics

The initial runner is explicitly `orchestration_mode: deterministic`; it is not an
LLM agent. It executes real data tools, records an operational hypothesis, compares
three scenario options, selects highest assumed net value, and persists a demo task.
Scenario recovery probabilities and costs are explicitly unvalidated assumptions.
All outreach demo tasks await human approval. Approval records the local task and
an expected scenario outcome; it never contacts a patient or changes patient data.
Reject returns the case to manual review. Repeated runs/approvals are idempotent in
a single worker process. Run one Uvicorn worker; SQLite state is not a distributed
production action ledger. Restart preserves saved cases; delete/refresh semantics
and data-snapshot invalidation are deferred.

`outcome.revenue_recovered`, `observed_revenue_recovered`, and summary
`revenue_recovered` remain zero. Expectations appear only in
`simulated_expected_recovery` and `simulated_expected_net_value`. The existing UI's
Recovered tile therefore remains zero; no fake actual recovery is shown.
`diagnosis.confidence` is null because deterministic rules have no calibrated confidence.
UI trace is an audit log, not private chain-of-thought or verified MLflow tracing.

Model endpoint and MLflow availability require workspace verification. No configured
endpoint is silently claimed to have been used. `CHIRO_MODEL_ENDPOINT` is reserved
for the next LLM integration; this milestone does not invoke it.

## Verification and deployment plan

```sh
.venv/bin/python -m pytest -q
PYTHONPATH=backend .venv/bin/python scripts/inspect_workspace.py --profile '<selected profile>' --warehouse-id '<warehouse ID>'
databricks bundle validate --strict -t dev --profile '<selected profile>'
```

The probe lists capabilities, schemas, and two synthetic rows per table; it does
not print credentials. Unit fixtures are labeled synthetic test data and never
loaded by the application.

Proposed first deployment: one serverless read-only notebook job in the existing
bundle to verify all eight source tables. It creates no tables, has no schedule,
and sends no messages. Backend hosting remains local for this milestone. Do not
run bundle deploy or the job until the user reviews and approves this plan.
Next deployment phase, after capability checks: add UC action/event tables and
verified MLflow trace storage, and choose backend hosting supported by this workspace.
