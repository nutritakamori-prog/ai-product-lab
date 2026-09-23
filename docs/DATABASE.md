# Database

PostgreSQL + Prisma 7. Schema: `prisma/schema.prisma`.

## Foundation tables (exist now)

| Table | Purpose |
|---|---|
| `User` | A person. |
| `Organization` | Tenant boundary — everything scopes to one eventually. |
| `OrganizationMember` | User ↔ Organization, with a role (OWNER/ADMIN/MEMBER). |
| `Project` | The product/project being analyzed. Has a mode (INTERNAL/PRODUCT/HYBRID). |
| `Agent` | Operational state only — `slug`, `category`, `modelTier`, `tokenBudget`, `enabled`. Behavior (system prompt, role, objective, etc.) lives in `/agents/*` files, not here. See `docs/AGENT_ARCHITECTURE.md`. |
| `ProjectAgent` | Which agents are enabled for a given project, with optional per-project config overrides. |
| `ProjectMemory` | One row per project, a structured Json blob. Nothing reads/writes it yet — exists for Phase 11. |
| `DesignMemory` | Same idea as `ProjectMemory`, for design-specific memory. |
| `AuditLog` | Generic audit trail. Currently written to by `services/projects.ts` on project creation — the one real writer that justifies the table existing now. |
| `AgentExecution` | One row per agent run (Phase 2's Agent Runtime): task, status, model, input/output, tokens, cost, duration, error. Scoped directly to `Project` + `Agent` — not to a LAP, which doesn't exist yet. See `docs/DECISIONS.md`. |

## Deliberately not built yet

`Lap`, `Finding`, `Decision`, `Task`, `TokenUsage` — `Lap`/`Finding`/`Decision`/
`Task` existed briefly in an earlier pass and were removed (see
`docs/DECISIONS.md`); `TokenUsage` as a separate table turned out
unnecessary — `AgentExecution` already carries its own token/cost fields
directly, and nothing needs a per-execution *history* of multiple token
readings yet. They come back, likely redesigned against real requirements,
when the LAP Engine phase starts. Nothing today needs them, and an empty
table with no reader or writer is exactly the premature abstraction this
project avoids.

## Key modeling decisions

- **IDs are `cuid()`**, not auto-increment integers — safe to generate
  client-side, no collision risk across future distributed writes.
- **`Agent` holds operational state, not behavior.** Behavior (system
  prompt, role, objective, responsibilities, constraints) lives in
  versioned files under `/agents`, validated by
  `agents/system/agent-protocol.ts`. The table only tracks what an
  operator might change without a deploy: category, model tier, token
  budget, enabled. See `docs/DECISIONS.md` — this reverses an earlier
  "put everything in the database" call once real usage showed that
  behavior needs code review and git history more than it needs to be
  editable without a deploy.
- **`ProjectMemory.data` / `DesignMemory.data` are `Json`**, not normalized
  tables — each is a structured-but-evolving blob (users, objectives,
  recurring problems, design tokens, ...) that doesn't earn its own tables
  until something is actually reading/writing specific fields of it.
- **No `ProjectAgent` config is seeded** — the table exists so a project
  can enable/configure agents once agents exist (Phase 5); it's empty today.

## Prisma 7: driver adapter is mandatory

Prisma 7 removed the implicit query-engine-binary connection. `new
PrismaClient()` with no arguments throws at runtime. This project uses the
`pg` driver directly via `@prisma/adapter-pg`:

```ts
// src/lib/db.ts
const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
const adapter = new PrismaPg(pool);
export const db = new PrismaClient({ adapter });
```

Import the generated client from `@/generated/prisma/client` — the bare
`@/generated/prisma` path has no entry point in Prisma 7's new
`prisma-client` generator output (it emits raw `.ts` source files, not a
single `index`).

## Local development

A local Postgres is required — see `docs/DEVELOPMENT.md` for exact
commands (Docker or native).

## Commands

```bash
npx prisma migrate dev --name <change>   # create + apply a migration
npx prisma generate                       # regenerate the client (into src/generated/prisma)
npx prisma studio                         # browse data in a GUI
```
