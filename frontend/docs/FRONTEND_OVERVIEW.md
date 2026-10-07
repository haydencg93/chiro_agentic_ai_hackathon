# Frontend Overview

## Backend integration in one sentence

The UI calls `src/api/agentApi.js`; that file either forwards the call to `src/api/mockApi.js` during frontend development or sends a REST request to the real backend when `VITE_USE_MOCK_API=false`.

## Important integration files

| File | Responsibility |
| --- | --- |
| `src/api/agentApi.js` | Single frontend API gateway. Defines summary, case, run, approve, and reject calls. Switches between mock and real REST calls using Vite environment variables. |
| `src/api/mockApi.js` | Temporary in-memory backend used while the real backend is unavailable. Simulates delays, agent runs, approvals, rejections, continuation, and measured outcomes. |
| `src/data/mockCases.js` | Mock case records shaped exactly like the data the real backend should eventually return. |
| `docs/API_CONTRACT.md` | Shared REST/JSON contract between frontend and backend. This is the main handoff document for integration. |

## Application files

| File | Responsibility |
| --- | --- |
| `src/main.jsx` | Browser entry point. Mounts React, enables React Router, and loads global CSS. |
| `src/App.jsx` | Route table. `/` renders the dashboard and `/cases/:caseId` renders a patient case. |
| `src/components/layout/AppShell.jsx` | Shared sidebar/header around every page. Owns global search, header Run Agent behavior, notifications/toasts, and the API-mode indicator. |
| `src/pages/DashboardPage.jsx` | Loads summary + case data, renders the 3-column command center, filters the priority queue, draws the revenue trend, and controls Show More for live activity. |
| `src/pages/CasePage.jsx` | Main patient workflow page. Loads one case, runs/continues the agent, animates the trace, handles approval/rejection, and renders Observe → Investigate → Diagnose → Simulate → Decide → Act → Measure. |
| `src/components/dashboard/CaseTable.jsx` | Displays priority cases and navigates to the selected patient case. |
| `src/components/ui/MetricCard.jsx` | Reusable dashboard KPI card; can be static or clickable for queue filtering. |
| `src/components/ui/Badges.jsx` | Reusable visual labels for risk and case status. |
| `src/utils/formatters.js` | Shared currency and percentage formatting. |
| `src/styles/index.css` | Tailwind import, design tokens, dark AI visual theme, animation, and global long-text wrapping behavior. |

## Project/config files

| File | Responsibility |
| --- | --- |
| `index.html` | HTML shell Vite serves; contains page metadata and the React mount element. |
| `vite.config.js` | Enables the React and Tailwind Vite plugins. |
| `.env.example` | Documents mock/live API environment settings without committing a local `.env`. |
| `package.json` | Frontend dependencies and `npm run dev/build/preview` scripts. |
| `package-lock.json` | Locks exact dependency versions for reproducible installs. |
| `.gitignore` | Prevents generated/local files such as `node_modules`, build output, and `.env` from being committed. |
| `README.md` | Setup, demo path, API-mode switch, and frontend architecture notes. |
| `public/favicon.svg` / `public/icons.svg` | Static browser/public assets. |
| `src/assets/hero.png` | Optional visual asset; currently not required by the active UI. |

## What the real backend must provide

The frontend expects these REST operations:

```text
GET  /api/summary
GET  /api/cases
GET  /api/cases/:caseId
POST /api/cases/:caseId/run
POST /api/cases/:caseId/approve
POST /api/cases/:caseId/reject
```

The backend should return the shapes documented in `docs/API_CONTRACT.md`. The frontend handles presentation and trace animation; the backend should own real calculations, tool calls, agent decisions, approval rules, persisted actions, and outcomes.
