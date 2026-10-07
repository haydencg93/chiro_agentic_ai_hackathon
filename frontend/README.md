# NAME TBD — Frontend

Judge-facing React experience for the NAME TBD agentic AI hackathon project.

## What is already implemented

- Vite + React + JavaScript
- Tailwind CSS via the official Vite plugin
- React Router
- Dashboard / command center
- Revenue-risk case list
- Patient case detail page
- Mock REST-compatible data layer
- Switch between mock and live backend using environment variables
- Animated agent execution trace
- Explicit `OBSERVE → INVESTIGATE → DIAGNOSE → SIMULATE → DECIDE → ACT → MEASURE` workflow
- Intervention comparison UI
- Human approval UI for financial interventions
- Simulated recovered-revenue outcome UI
- Loading and error states
- API contract for Eva's backend

## 1. Requirements

Use a current Node version supported by Vite. This starter expects Node 20.19+.

Check:

```bash
node --version
npm --version
```

## 2. Install and run

From this `frontend` project directory:

```bash
npm install
cp .env.example .env
npm run dev
```

Open the local Vite URL (normally `http://localhost:5173`).

## 3. Demo path

1. Open the dashboard.
2. Select `PT0054827`.
3. Click **Run agent**.
4. Watch the trace reveal evidence, tool calls, diagnosis, intervention comparison, decision, action, and measurement.
5. Return to the dashboard and open `PT0031829` to demo a human approval gate.

## 4. Mock vs. Eva's real API

During frontend work:

```env
VITE_USE_MOCK_API=true
```

When Eva's REST backend is ready:

```env
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=http://localhost:8000/api
```

The components should not need to change as long as the backend follows `docs/API_CONTRACT.md`.

## 5. Recommended repository layout

Place this directory inside the shared project repository:

```text
name-tbd/
├── databricks.yml
├── frontend/            # this project
├── backend/             # Eva
├── src/agent/           # Eva
├── src/tools/           # Eva
├── resources/           # Databricks resources
├── docs/
└── README.md
```

## 6. Frontend architecture

```text
React pages/components
        |
        v
src/api/agentApi.js
        |
        +--> mockApi.js               (Hayden develops independently)
        |
        +--> Eva REST API             (integration)
```

The case data contract is the seam between both teammates.

## 7. Important product rule

The agent trace does **not** expose raw/private LLM chain-of-thought. It shows an audit-friendly trace containing observed evidence, tool calls, concise rationale, confidence, decisions, approvals, actions, and outcomes.

## 8. Next frontend phases

- Connect Eva's real backend.
- Add automated component/API tests.
- Add one or two small business-impact visualizations only if they improve the two-minute demo.
- Validate mobile/tablet layout.
- Final accessibility pass.
- Final judge-demo polish and timing.
- Integrate frontend deployment into the team's Databricks Asset Bundle strategy.
