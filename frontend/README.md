# REALIGN Frontend

React + Vite frontend for the Revenue Rescue demo. This app shows the agent workflow for identifying at-risk patients, diagnosing likely causes, comparing interventions, and acting on the highest-value option.

## Overview

The frontend is a judge-facing experience designed to demonstrate the agentic business workflow in a short, understandable flow:

- customer overview dashboard
- patient case detail view
- evidence and diagnosis steps
- intervention comparison
- approval and rejection for financially sensitive actions
- simulated revenue impact

The app supports both a mock data layer and a live backend connection via environment configuration.

## Tech stack

- React 19
- Vite
- JavaScript
- Tailwind CSS
- Vitest
- React Testing Library
- ESLint

## Prerequisites

- Node.js 20.19+
- npm 10+

Verify the installation:

```bash
node --version
npm --version
```

## Setup

From the repository root:

```bash
cd frontend
cp .env.example .env
npm install
```

The default environment file includes:

```env
VITE_USE_MOCK_API=true
VITE_API_BASE_URL=http://localhost:8000/api
```

## Run locally

Start the frontend in development mode:

```bash
cd frontend
npm run dev
```

Then open the local development URL, usually:

```text
http://localhost:5173
```

## Mock vs live backend

During frontend development, keep mock mode enabled:

```env
VITE_USE_MOCK_API=true
```

When the backend is running locally, switch to the live API:

```env
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=http://localhost:8000/api
```

The UI is designed to remain stable as long as the backend follows the API contract used by the app.

## Demo flow

A standard judge demo path is:

1. Open the dashboard.
2. Select a case such as `PT0054827`.
3. Click **Run agent**.
4. Observe the trace: evidence, diagnosis, intervention comparison, and decision.
5. Open a second patient case to show the approval gate.

## Validation

Run the frontend checks before shipping changes:

```bash
cd frontend
npm run test
npm run build
npm run lint
```

The project also includes component tests for the main UI and API integration behavior.

## Deployment

The frontend is intended to be deployed as a standard static Vite app, with a Databricks bundle for workspace-level deployment integration in the repo root.

For local deployment testing:

```bash
cd frontend
npm run build
npm run preview
```

This serves the production bundle locally for final smoke testing.

## Project notes

- the app intentionally avoids exposing raw LLM reasoning traces
- the trace is designed to be audit-friendly and business-readable
- the data layer is isolated to make backend swapping low-risk
- the demo should remain understandable in under two minutes

## Related components

- backend API: [backend/README.md](../backend/README.md)
- root project: [README.md](../README.md)
