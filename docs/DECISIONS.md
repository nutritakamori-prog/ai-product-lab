# Decisions

Running log of decisions that would otherwise only live in chat history.
Newest first.

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

## 2026-09-23 — Agent definitions live in code, not the database

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
