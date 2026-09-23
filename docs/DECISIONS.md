# Decisions

Running log of decisions that would otherwise only live in chat history.
Newest first.

---

## 2026-09-23 — Foundation pages render dynamically, not statically

**Problem:** `next build` prerendered `/`, `/projects`, `/agents`,
`/settings` as static HTML at build time, since nothing told Next.js
otherwise — even though each reads live data from Postgres.

**Interpretation:** `revalidatePath` (already called after creating a
project) patches this correctly for that one write path, but every other
future writer to these tables would need to remember to do the same, or
the page silently goes stale. That's a footgun worth avoiding now rather
than debugging later.

**Decision:** `export const dynamic = "force-dynamic"` on all four pages.
Trade a small amount of caching for pages always reflecting real DB state.
Revisit per-page once there's an actual performance reason to.

---

## 2026-09-23 — Prisma 7 requires an explicit driver adapter

**Problem:** `new PrismaClient()` (the pre-7 pattern) throws at runtime.
Prisma 7 removed the implicit query-engine-binary connection.

**Decision:** install `@prisma/adapter-pg` + `pg`, and construct the client
as `new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) })`
in `src/lib/db.ts`. Import the client from `@/generated/prisma/client`
(not the bare `@/generated/prisma` — that path has no entry point in
Prisma 7's new generator output).

---

## 2026-09-23 — Reversed: Agent definitions now live in the database, not only code

**Problem:** the Phase 0 decision below (agents as code) turned out not to
match what was actually asked for once the foundation's entity list was
specified explicitly: `Agent` and `ProjectAgent` as real tables.

**Facts:** the product spec's own agent fields (system prompt, input/output
schema, token budget, priority, model, version, enabled, allowed tools,
supported task types) are exactly the shape of a database row, and the
spec explicitly lists `Agent`/`ProjectAgent` among the database entities.

**Decision:** `Agent` is now a Prisma model (see `docs/DATABASE.md`). The
`src/domain/agent.ts` Zod schema still defines and validates the shape —
code still owns *what a valid agent looks like*, the database owns
*which agents currently exist and their configuration*. No agents are
seeded yet (Phase 5). This supersedes the "agent definitions live in code"
decision immediately below, which is kept here for the historical record.

---

## 2026-09-23 — LAP-related tables removed from the schema, deferred to the LAP Engine phase

**Problem:** Phase 1 had already created `Lap`, `Finding`, `Decision`,
`Task`, `AgentExecution`, `TokenUsage` (a deliberate small over-build at
the time). The foundation-only pass explicitly scoped down to 9 named
entities that don't include any of these.

**Decision:** dropped all six tables (and their enums) via a fresh
migration. No data existed in them (dev database, never used). They come
back, redesigned if needed against real Agent Runtime/LAP requirements,
when that phase actually starts.

---

## 2026-09-23 — Kept Prisma on 7.10.0 despite 4 "high" npm audit findings

**Problem:** `npm audit` flags 4 high-severity advisories after installing
Prisma.

**Facts:** all 4 are in `deepmerge-ts` and `mysql2`, both transitive
dependencies of Prisma's CLI config/introspection tooling — not of
`@prisma/client` (what actually runs in the deployed app). `mysql2`'s
advisories require an actual MySQL connection to a malicious/compromised
server; we only ever connect to Postgres. `npm audit fix --force`'s
suggested fix is downgrading to `prisma@6.19.3`.

**Interpretation:** these are non-issues for how this project uses Prisma.
Downgrading to chase an audit count would trade a real stability/feature
regression for a false sense of security.

**Decision:** stay on `prisma@7.10.0` / `@prisma/client@7.10.0`. Revisit
only if a future advisory actually touches the Postgres driver path or
`@prisma/client` itself.

---

## 2026-09-23 — `latest` npm dist-tag for `prisma` pointed at a release candidate

**Problem:** a plain `npm install -D prisma` pulled `8.0.0-rc.15`, which
drags in experimental "Prisma Postgres platform" dev tooling
(`@prisma/dev`, `alchemy`, `@prisma/composer-cli`) with several vulnerable
transitive deps.

**Decision:** pin explicitly to `prisma@7.10.0` / `@prisma/client@7.10.0`
(the `prev` dist-tag — the actual last stable release) instead of trusting
`latest`.

---

## 2026-09-23 — Agent definitions live in code, not the database (superseded)

> **Superseded the same day** — see "Reversed: Agent definitions now live
> in the database" above. Kept for the historical record of why this was
> the first call.

**Problem:** where should the 20 agents' configs (system prompt, schemas,
capabilities, etc.) be stored?

**Facts:** an agent definition is logic — it changes together with the
runtime code that executes it, needs type-checking against its own
schemas, and benefits from code review before it affects a live analysis.

**Interpretation:** a database-backed agent registry (editable from an
admin screen) sounds flexible, but only pays off once there's a real need
to add/change agents without a deploy — which doesn't exist yet.

**Decision:** agent *definitions* live in `src/core/agents` as TypeScript.
The `AgentExecution` database table only records that a run happened
(`agentId` is a plain string matching the code registry, not a foreign
key). Revisit if/when non-developers need to create agents themselves.

---

## 2026-09-23 — GATE 0: stack, structure, and phase plan approved

- Frontend + backend: Next.js (App Router) + TypeScript + Tailwind, single
  app (no monorepo yet).
- Database: PostgreSQL + Prisma.
- Package manager: npm.
- AI provider: Anthropic (Claude) — Haiku/Sonnet/Opus map to the
  low-cost/balanced/high-reasoning model tiers.
- Phase order and Approval Gates as listed in `docs/DEVELOPMENT.md`,
  unchanged from the original build prompt.

---

## 2026-09-23 — Repository: new repo instead of reusing an existing one

**Problem:** where should AI Product Lab live?

**Facts:** the session's existing repo (`shared-db-hub`) is a live,
Lovable-connected nutrition-clinic tool (TanStack Start + Vite + Supabase)
— a different product, different stack, and rewriting its history is
explicitly forbidden by its own `AGENTS.md`. A second existing repo
(`LAB`) was available but not inspected before this decision.

**Decision:** create a fresh repository, `nutritakamori-prog/ai-product-lab`,
rather than repurposing either existing repo.
