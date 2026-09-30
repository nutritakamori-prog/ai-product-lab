# LAB QG

A visual, spatial presentation layer over the LAB's existing data — not a second product, not a second source of truth.

## Route

`/qg`, rendered inside the same `AppShell` every other page uses (same sidebar, same "back to the LAB" affordance through the nav).

## Components

- `src/app/qg/page.tsx` — Server Component. Fetches the snapshot via `getQgSnapshot()`, derives every visual state with the pure functions in `qg-helpers.ts`, and passes a single plain-data prop down to the client.
- `src/app/qg/qg-office.tsx` — Client Component. The office itself: the floor-plan grid, zoom controls, Quick View, and the panels opened by clicking a station (Agent, Head, Meeting, Reports, Clock). Purely presentational — it receives data, it never fetches.
- `src/app/qg/panel.tsx` — one reusable modal shell every station detail uses.
- `src/app/qg/qg-helpers.ts` — the only logic worth unit-testing: `deriveAgentQgState`, `deriveGlobalStatus`, `buildWeeklyReport`, `agentsWithPendingDecision`. Pure functions, no I/O.

## Data source

Everything comes from `src/services/qg.ts`'s `getQgSnapshot()`, which composes services that already exist and are used elsewhere (`listAgents`, `getLatestMissionRun`, `listMissionRuns`, `listRecommendations`) — no new Prisma model, no new table, no new query beyond what those already run. The Weekly Report and the per-agent states are computed in memory from that same snapshot.

| Element | Real data source | Derived by |
|---|---|---|
| Agent station state | `EvaluationMissionRun.report.coverage` (latest run) + `Recommendation.status` | `deriveAgentQgState` |
| Head panel | `EvaluationMissionRun.headReport` | read directly (same shape `HeadReportSection` already renders) |
| Global status badge | `Recommendation.status` (pending count) + latest run's `status` | `deriveGlobalStatus` |
| Quadro / Product Intelligence | `Recommendation` rows | navigates to the existing `/product-intelligence` route |
| Implementation | `Recommendation.status === "APPROVED"` count | navigates to `/product-intelligence`, where the real Implementation Task flow already lives |
| Retest / Test Lab | — | navigates to the existing `/test-lab` route |
| Arquivo | `EvaluationMissionRun[]` | navigates to `/product-intelligence#historico` (the existing History section) |
| Relatórios | `EvaluationMissionRun[]` + `Recommendation[]` from the last 7 days | `buildWeeklyReport` |
| Relógio | `EvaluationMissionRun.createdAt` (latest) + the browser's own current time | rendered client-side, never invented |

## What the QG deliberately does NOT do

- No new agent, no new persisted status, no new table.
- No realtime/WebSocket polling — data is fetched once per page load (`force-dynamic`), same as every other page in the LAB.
- No true 3D/isometric rendering — the office is a categorized, responsive CSS grid with a floor texture, not a canvas/WebGL scene. This was a deliberate scope decision for a first version (see the Fase 9 report's "Não implementado" section), not an oversight.
- Never shows an agent as "working" unless a Mission Run genuinely is `RUNNING` at read time.
