# Database

PostgreSQL + Prisma. Schema: `prisma/schema.prisma`.

## Phase 1 tables (exist now)

| Table | Purpose |
|---|---|
| `User` | A person. |
| `Organization` | Tenant boundary — everything scopes to one eventually. |
| `OrganizationMember` | User ↔ Organization, with a role (OWNER/ADMIN/MEMBER). |
| `Project` | The product/project being analyzed. Has a mode (INTERNAL/PRODUCT/HYBRID). |
| `Lap` | One analysis run. See `docs/LAP_SPECIFICATION.md`. |
| `AgentExecution` | Audit trail of one agent run within a LAP — not the agent's definition. |
| `Finding` | Evidence-backed observation, deduplicated across agents. |
| `Decision` | Facts/interpretation/recommendation, kept explicitly separate. |
| `Task` | Actionable follow-up from a Finding or Decision. |
| `TokenUsage` | Per-execution token/cost record, for budgets and observability. |

## Deliberately not built yet

- `ProjectMemory` / `DesignMemory` — Phase 11. Would just be empty tables
  with no read/write logic today.
- `DesignBlueprint` — Phase 9/10, once the Design Lab exists to produce one.
- `AuditLog` — Phase 13 (Observability), once there's something worth
  auditing beyond what `AgentExecution` already records.
- `ProjectAgent` (per-project agent enable/disable) — not needed until
  there's more than a couple of projects to differentiate; a project's
  enabled agents can start as a simple JSON field on `Project` if/when
  needed, before graduating to its own table.

Adding a table before something reads or writes it is exactly the kind of
premature abstraction this project explicitly avoids (see the project's
build instructions, §41).

## Key modeling decisions

- **Agent definitions are not a table.** `AgentExecution.agentId` is a plain
  string matching an id in the code registry (`src/core/agents`), not a
  foreign key. See `docs/DECISIONS.md`.
- **IDs are `cuid()`**, not auto-increment integers — safe to generate
  client-side, no collision risk across future distributed writes.
- **`Finding.agentIds` is a native Postgres string array**, not a join
  table — it's a simple "which agents contributed" tag list, not a
  relation with its own attributes. If that ever needs per-agent metadata
  (e.g. each agent's individual confidence on a shared finding), it
  graduates to a join table then, not preemptively now.
- **`Decision.options` / `Lap.scenarios` / `Lap.result` are `Json`** — each
  is a structured-but-evolving shape (e.g. a list of `{label, pros, cons}`
  options) that doesn't earn its own normalized tables yet.

## Local development

A local Postgres is required. Two ways to get one — see `docs/DEVELOPMENT.md`
for exact commands:
- `docker compose up -d` (uses `docker-compose.yml` at the repo root).
- A native local Postgres install (what this session used, since Docker's
  daemon wasn't available in the sandbox) — same user/password/db name as
  the Docker setup, so `.env` doesn't need to change either way.

## Commands

```bash
npx prisma migrate dev --name <change>   # create + apply a migration
npx prisma generate                       # regenerate the client (into src/generated/prisma)
npx prisma studio                         # browse data in a GUI
```
