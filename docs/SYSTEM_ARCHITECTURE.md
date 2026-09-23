# System Architecture

## Stack

- **Frontend + Backend:** Next.js (App Router) + TypeScript + Tailwind CSS.
  A single app for now — no monorepo, no separate backend service. The API
  is Next.js Route Handlers.
- **Database:** PostgreSQL + Prisma.
- **AI provider:** Anthropic (Claude). Model tiers map to Haiku / Sonnet / Opus
  — see `src/core/models/README.md`.

## Orchestration flow

```
USER
 ↓
PROJECT
 ↓
LAP
 ↓
OBJECTIVE
 ↓
MASTER ORCHESTRATOR
 ↓
SMART ROUTER
 ↓
RELEVANT AGENTS
 ↓
STRUCTURED FINDINGS
 ↓
DEDUPLICATION
 ↓
ORCHESTRATOR
 ↓
DECISION
 ↓
TASK
 ↓
DESIGN / IMPLEMENTATION
 ↓
RETEST
 ↓
MEMORY
```

Agents never talk to each other freely. Everything is routed and
consolidated by the Master Orchestrator — see `docs/AGENT_ARCHITECTURE.md`.

## Module map

### `src/core/*` — the product's own domain logic, built out phase by phase

| Module | Owns | Status |
|---|---|---|
| `agents` | The registry (`getBySlug`/`listEnabled`/`list` over the `Agent` table) | **Implemented** (Phase 2) — no agent rows yet (Phase 5) |
| `runtime` | Actually executing one agent: prompt → model → validate → persist | **Implemented** (Phase 2) |
| `models` | Model tier routing + the `ModelProvider` abstraction (Anthropic today) | **Implemented** (Phase 2) |
| `context` | Assembling the minimum relevant context for a run | Stub only — real selection logic is Phase 3 |
| `orchestrator` | Master Orchestrator + Smart Router | Empty — Phase 4 |
| `lap` | LAP lifecycle | Empty — Phase 6 |
| `findings` | Findings / Decisions / Tasks, evidence-first, deduplication | Empty — Phase 7 |
| `memory` | Product Memory + Design Memory | Empty — Phase 11 |

Each has its own `README.md` stating what it owns and — just as
important — what it explicitly does *not* own, to keep responsibilities
from leaking across modules as the system grows.

### Foundation layers (exist now)

| Layer | Where | Owns |
|---|---|---|
| UI / routes | `src/app/*` | Pages — Dashboard, Projects, Agents, Settings |
| Components | `src/components/*` | Reusable presentational pieces (AppShell, nav, buttons, empty states) |
| Services | `src/services/*` | Application logic that talks to the database (create/list project, list agents, audit log) |
| Domain | `src/domain/*` | Framework/DB-agnostic types and Zod validation — what a valid Project, Agent, or agent *output* looks like |
| Database | `prisma/*`, `src/lib/db.ts` | Schema, migrations, the Prisma client singleton |
| Configuration | `src/config/*` | App-wide static config (nav items today) |
| Utilities | `src/lib/*` | Cross-cutting helpers (env validation, the db client) |

Routes call services; services validate input against domain schemas and
talk to the database; nothing reaches into Prisma directly from a page.

## Multitenancy (structure now, not full SaaS yet)

`Organization → OrganizationMember → Project` exists from Phase 1 so every
future entity can be scoped to an organization without a later migration
rewrite. Billing, usage limits, and full permission logic are explicitly
**not** built yet (Phase 14).

## Database

See `docs/DATABASE.md` for the schema and the reasoning behind what's in
Phase 1 vs deferred.

## Non-negotiables (carried through every phase)

- No chain-of-thought is ever stored or displayed — only observations,
  evidence, conclusions, recommendations, confidence, and a short
  justification.
- No finding is stated as fact without evidence. Evidence-first, always
  ACTION → EXPECTED → OBSERVED → EVIDENCE.
- No infinite agent discussion loops — max 2 rounds, then consensus or
  escalate.
- No agent runs "just in case" — the Smart Router must justify every
  selection, to keep cost and noise down.
