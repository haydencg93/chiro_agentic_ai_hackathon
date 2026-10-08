# REALIGN

REALIGN is an agentic AI demo for chiropractic retention and revenue protection. The project combines a React frontend and a FastAPI backend to show how a clinic can identify at-risk patients, investigate the likely cause, compare interventions, and route sensitive actions to human review.

## Overview

The system is designed around a business workflow rather than a generic chatbot:

- identify patients showing revenue-risk signals
- inspect appointment and visit history
- diagnose likely reasons for disengagement
- compare intervention options
- choose the action with the strongest expected business value
- record the decision and simulate outcome impact
- route financially sensitive actions to approval

This repository contains both the frontend experience and the backend data/API layer needed to support the demo.

## Repository structure

```text
chiro_agentic_ai_hackathon/
├── README.md
├── databricks.yml
├── pyproject.toml
├── backend/
│   ├── README.md
│   ├── chiro_backend/
│   ├── tests/
│   └── requirements.lock.txt
├── frontend/
│   ├── README.md
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   ├── tests/
│   └── vite.config.js
├── docs/
├── resources/
├── sample_data/
├── src/
├── tests/
├── scripts/
└── notebooks/
```

## Tech stack

- Frontend: React, Vite, Tailwind CSS, Vitest, React Testing Library
- Backend: FastAPI, Python 3.11+, Databricks SDK
- Deployment: Databricks Asset Bundle

## Prerequisites

Before setting up the project, install:

- Python 3.11+
- Node.js 20.19+
- npm 10+
- Databricks CLI access and a usable workspace profile if you plan to deploy or validate the bundle

Verify your environment:

```bash
python --version
node --version
npm --version
```

## Setup

### 1) Backend setup

From the repository root:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
```

Configure the backend environment variables if needed:

```bash
export CHIRO_PROFILE='YOUR_PROFILE'
export CHIRO_WAREHOUSE_ID='YOUR_WAREHOUSE_ID'
export CHIRO_SCHEMA='chiro_hackathon'
export CHIRO_MODEL_ENDPOINT='databricks-gpt-oss-120b'
export CHIRO_AGENT_MODE='deterministic'
export CHIRO_PERSISTENCE_MODE='delta'
export CHIRO_CORS_ORIGINS='["http://localhost:5173"]'
```

### 2) Frontend setup

From the repository root:

```bash
cd frontend
cp .env.example .env
npm install
```

The default frontend settings are:

```env
VITE_USE_MOCK_API=true
VITE_API_BASE_URL=http://localhost:8000/api
```

## Run locally

### Backend

Start the API server:

```bash
uvicorn chiro_backend.app:app --app-dir backend --host 127.0.0.1 --port 8000
```

The API will be available at:

```text
http://127.0.0.1:8000
http://127.0.0.1:8000/docs
```

### Frontend

In a separate terminal:

```bash
cd frontend
npm run dev
```

Open the app at:

```text
http://localhost:5173
```

## Validation

Run the backend and frontend validation checks separately.

### Backend validation

```bash
python -m pytest -q
```

### Frontend validation

```bash
cd frontend
npm run test
npm run build
npm run lint
```

These commands cover application behavior, production build output, and lint quality.

## Deployment

### Databricks bundle

This repository includes a Databricks deployment configuration in `databricks.yml`.

Validate the bundle:

```bash
databricks bundle validate --strict -t dev --profile '<selected profile>'
```

Deploy when approved:

```bash
databricks bundle deploy
```

The current milestone is focused on local API hosting and controlled workspace capability checks; production action writes and external patient-facing automation should be reviewed before deployment.

### Frontend static build

For a local production smoke test:

```bash
cd frontend
npm run build
npm run preview
```

## Demo flow

A typical end-to-end demo path:

1. Open the dashboard in the frontend.
2. Select a patient case such as `PT0054827`.
3. Run the agent workflow.
4. Inspect the observed evidence and diagnosis.
5. Compare intervention options.
6. Review the approval path for financially sensitive actions.
7. Examine the simulated business impact and recovered value.

## Additional docs

- Backend docs: [backend/README.md](backend/README.md)
- Frontend docs: [frontend/README.md](frontend/README.md)
- API milestone notes: [docs/BACKEND_MILESTONE.md](docs/BACKEND_MILESTONE.md)

## Notes

- the app intentionally keeps the audit trail readable and business-friendly
- the frontend can use either a mock API or the live backend depending on the environment settings
- backend orchestration currently defaults to a deterministic demo flow, with room for future LLM-backed reasoning and tracing
- no secrets or tokens are checked into the repository
