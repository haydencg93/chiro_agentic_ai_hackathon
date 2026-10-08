# Chiro Revenue Backend

FastAPI backend for the Revenue Rescue agentic workflow. It serves patient risk data, executes the deterministic action workflow, and exposes a REST API for the frontend judge demo.

## Overview

The backend connects to Databricks workspace data, evaluates risk and intervention scenarios, and records operational decisions in a local ledger. It is intentionally structured for a judge-facing demo: the API is simple, deterministic, and audit-friendly, while remaining compatible with future LLM-backed orchestration.

The service exposes:

- a health endpoint for app liveness checks
- patient case listing and detail routes
- a run endpoint that executes the agent workflow
- approval and rejection endpoints for intervention decisions
- a local persistence layer for the demo ledger

## Repository layout

```text
backend/
├── chiro_backend/
│   ├── agent.py
│   ├── agent_tools.py
│   ├── app.py
│   ├── config.py
│   ├── databricks.py
│   ├── delta.py
│   ├── ledger.py
│   ├── runtime.py
│   ├── schemas.py
│   ├── scope.py
│   ├── service.py
│   ├── tool_models.py
│   └── tools.py
├── tests/
│   ├── test_agent.py
│   ├── test_backend.py
│   ├── test_optimized.py
│   └── test_scope_delta.py
├── README.md
└── requirements.lock.txt
```

## Prerequisites

- Python 3.11+
- access to the Databricks workspace used by the project
- a valid Databricks profile configured with the Databricks CLI or SDK
- a verified warehouse ID for the workspace

Check the local environment:

```bash
python --version
pip --version
```

## Setup

From the repository root:

```bash
python -m venv .venv
. .venv/bin/activate  # Windows PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
```

If using Windows PowerShell, use:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
```

## Configuration

The backend reads settings from environment variables with the `CHIRO_` prefix. Typical values include:

```bash
export CHIRO_PROFILE='YOUR_PROFILE'
export CHIRO_WAREHOUSE_ID='YOUR_WAREHOUSE_ID'
export CHIRO_SCHEMA='chiro_hackathon'
export CHIRO_MODEL_ENDPOINT='databricks-gpt-oss-120b'
export CHIRO_AGENT_MODE='deterministic'
export CHIRO_PERSISTENCE_MODE='delta'
export CHIRO_CORS_ORIGINS='["http://localhost:5173"]'
```

Notes:

- no secrets are committed to the repo
- Databricks authentication should come from the local CLI or standard SDK auth flow
- `CHIRO_CORS_ORIGINS` is a JSON array string

## Run locally

Start the backend API on port 8000:

```bash
uvicorn chiro_backend.app:app --app-dir backend --host 127.0.0.1 --port 8000
```

The app will be available at:

```text
http://127.0.0.1:8000
```

Swagger documentation is available at:

```text
http://127.0.0.1:8000/docs
```

## API summary

Main endpoints:

```text
GET    /health
GET    /health?check_databricks=true
GET    /api/cases
GET    /api/cases/{patient_id}
GET    /api/summary
POST   /api/agent/run
POST   /api/cases/{case_id}/run
POST   /api/cases/{case_id}/approve
POST   /api/cases/{case_id}/reject
POST   /api/actions/{action_id}/approve
```

Example run payload:

```json
{
  "patient_id": "PT0054827",
  "message": "Investigate this patient and recommend the next action."
}
```

## Validation

Run the backend test suite:

```bash
python -m pytest -q
```

This project also includes a workspace capability check script for Databricks verification:

```bash
PYTHONPATH=backend python scripts/inspect_workspace.py --profile '<selected profile>' --warehouse-id '<warehouse ID>'
```

## Deployment

The repo includes a Databricks bundle for deployment configuration:

```bash
databricks bundle validate --strict -t dev --profile '<selected profile>'
```

The current backend milestone is designed for local hosting and controlled Databricks connectivity checks. It is not intended to deploy production actions or patient-facing writes until the workflow is reviewed and approved.

## Frontend integration

The frontend expects the backend at:

```text
http://localhost:8000/api
```

Use the frontend environment setting:

```env
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=http://localhost:8000/api
```

## Notes

- the default orchestration mode is deterministic for the current demo
- patient review and approval actions are logged locally and are demo-safe
- the backend should be treated as a local or workspace API, not as a production distributed action ledger
- more advanced LLM orchestration and production tracing can be added after Databricks capability checks are complete
