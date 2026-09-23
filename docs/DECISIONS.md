# Decisions

Running log of decisions that would otherwise only live in chat history.
Newest first.

---

## 2026-09-23 — Agents moved from database rows to versioned files (reverses the Phase 2 reversal)

**Problem:** a user-requested audit flagged that storing agent *behavior*
(systemPrompt, capabilities, schemas) as database rows made "add an agent
without a deploy" true, but lost code review, diffability, and git history
for the thing that most needs it — what an agent is actually told to do.
The ask: treat agents as a modular, versioned library (`/agents`), with
the database reduced to operational state only.

**Decision:**
- Agent *behavior* (role, objective, responsibilities, constraints,
  systemPrompt) now lives in `/agents/{category}/{id}.ts`, one file per
  agent, validated against `agents/system/agent-protocol.ts`'s
  `agentDefinitionSchema`.
- The `Agent` table is now lean and purely operational: `slug`, `category`,
  `modelTier`, `tokenBudget`, `enabled`. Removed: `name`, `description`,
  `responsibility`, `whenNotToCall`, `capabilities`, `systemPrompt`,
  `inputSchema`, `outputSchema`, `priority`, `version`, `allowedTools`,
  `supportedTaskTypes` — all now sourced from the file. The `AgentPriority`
  enum was removed with it (nothing else used it).
- `src/core/agents/registry.ts` (unchanged file, adapted logic — no second
  Registry) now merges a file definition with its DB row: **first
  discovery creates the row seeded from the file's defaults; once it
  exists, the DB's `enabled`/`tokenBudget`/`modelTier` win** — an operator
  can change these without a deploy, which was the whole point of Phase
  2's original database-backed design, kept intact.
- `src/domain/agent.ts` (the old, now-fully-superseded schema) was deleted
  — nothing outside its own test imported it (checked before deleting),
  and keeping both shapes side by side would have been exactly the
  "different structures to represent an agent" duplication this change
  was meant to prevent.
- Added `ORCHESTRATION` to the `AgentType`/category enum, since the
  library's folder layout includes `/agents/orchestration` (for future
  agents that participate in orchestration — distinct from
  `src/core/orchestrator`, the Router/Orchestrator *code*).

**Migration:** additive/simplifying only, on a table with zero rows in
every environment that matters — no data was ever at risk.

---

## 2026-09-23 — Agent discovery: a static index, not a runtime filesystem scan

**Problem:** "discover agents in `/agents`" could mean either scanning the
directory at runtime (`fs.readdir` + dynamic `import()`) or an explicit
list.

**Facts:** this is a bundled Next.js app. A dynamic `import()` over a path
computed at runtime is not reliably included by the bundler in a
production build — dynamic imports need a statically analyzable pattern
to be traced and bundled correctly.

**Decision:** `agents/index.ts` is a plain array of static imports.
Adding an agent costs one import line + one array entry — not "scanning
the filesystem," but not "rebuilding the system" either, and it's the
standard safe pattern for a plugin-style registry in a bundled app.
Verified with a full `next build` after wiring it up.

---

## 2026-09-23 — System rule files under `/agents/system/` are thin re-exports, not new logic

Per the explicit instruction to reuse rather than duplicate: `evidence-rules.ts`
holds the evidence-first reminder text (moved out of
`core/runtime/build-prompt.ts`, which now imports it — one copy, not two).
`token-economy.ts` and `routing-rules.ts` re-export existing constants from
`core/models/provider.ts` and `agent-protocol.ts` respectively.
`decision-framework.ts` is genuinely new but inert — a documented
placeholder for Phase 7, since no Decision entity exists to enforce
anything against yet.

---

## 2026-09-23 — Agent Runtime: model ids, structured outputs, and retry policy

**Model ids (checked against Anthropic's own current pricing table):**
`LOW_COST` → `claude-haiku-4-5`, `BALANCED` → `claude-sonnet-5`,
`HIGH_REASONING` → `claude-opus-5`. Centralized in one map in
`src/core/models/provider.ts` — nothing else in the codebase names a model.

**Structured output, not prompt-and-hope:** `client.messages.parse()` with
`output_config: { format: zodOutputFormat(schema) }` constrains the API
response itself to match the schema, returning `response.parsed_output`
already typed. This is more reliable than asking the model to "please
respond in JSON" and regex-extracting it, and than forcing a fake "tool
call" as a JSON-output workaround.

**Two validation layers, not one:** Structured Outputs guarantees *shape*
(every field present, right type). It can't express "status FINDING
requires evidence/impact/recommendation to be non-null" — that's a
cross-field business rule. So `src/domain/agent-output.ts` keeps a
`agentOutputBaseSchema` (shape only, used to generate the JSON Schema) and
`agentOutputSchema` (same, `.refine()`ed with the business rule, used by
the Output Validator after the model responds). A Zod refinement doesn't
export to JSON Schema cleanly, which is why these are two separate exports
rather than one.

**Retry policy:** invalid output (fails either validation layer) is
retried up to 2 extra times by default, telling the model what was wrong
and asking again — never retried silently, never saved as a success.
Transport/API errors (network, rate limit, auth) are *not* retried by the
Runtime's own loop — the Anthropic SDK already retries transient failures
(408/409/429/5xx) internally; retrying again on top would just duplicate
that with worse error messages.

**Token budget = a real cap, not a logged number:** `agent.tokenBudget` is
passed straight through as the API's own `max_tokens` on every attempt —
the model physically cannot generate past it, rather than the Runtime
checking a count after the fact.

**`AgentExecution` is scoped to Project, not to a future Lap:** a single
agent run is a lower-level primitive than a LAP (which will group many
executions toward one objective). Making `lapId` required now would mean
either inventing a placeholder Lap or leaving it nullable for a phase that
doesn't exist — scoping directly to `Project` avoids both, and adding an
optional `lapId` later is a trivial additive migration.

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
