# Decisions

Running log of decisions that would otherwise only live in chat history.
Newest first.

---

## 2026-09-23 — MockModelProvider: development continues without a paid Anthropic key

**Problem:** the real round (previous entry) surfaced that `ANTHROPIC_API_KEY`
isn't configured in this environment, and development needs to continue
without spending real API tokens on every round — while still exercising
the real browser automation and the real Test Lab pipeline end to end.

**Decision:**
- Added `src/core/models/mock-provider.ts`'s `MockModelProvider` — a second
  `ModelProvider` implementation, deterministic and offline. It reads only
  the `OBSERVED:` text already in the prompt it's given (real evidence
  some earlier real step already gathered — the browser automation is
  never mocked) and applies simple keyword rules: a clear negative result →
  `FINDING`; a not-automated/inconclusive step or no structured evidence at
  all → `UNCONFIRMED`; otherwise → `NO_FINDING`. Findings are capped at
  `MEDIUM` impact/confidence and say so in their own `recommendation` —
  explicitly a low-confidence lead, not a substitute for real analysis.
- `provider.ts`'s `getModelProvider()` now picks automatically:
  `AnthropicModelProvider` when `ANTHROPIC_API_KEY` is set, `MockModelProvider`
  otherwise — no flag, no manual switch. This also means a missing key can
  no longer surface as an uncaught exception the way it did in the
  previous entry: `getModelProvider()` itself never throws for that reason
  anymore, since it always has a provider to return.
- `ModelProvider` gained a required `name` field (`"anthropic"`, `"mock"`,
  or a test double's own descriptive name) — purely additive to the
  interface, but every existing fake `ModelProvider` across the test suite
  needed one added.
- `AgentExecution` gained `provider: ModelProviderKind` (`ANTHROPIC` |
  `MOCK`, migration `mock_model_provider`), resolved and recorded at the
  start of `runAgent()` (before creating the row, not patched in after) so
  a Mock-backed execution is never mistaken for a real one. A test
  double's name maps to `MOCK` — the honest classification for "not the
  real Anthropic provider," since the enum has no third value.
- `getEnv()` gained `resetEnvCacheForTesting()` (same reasoning as
  `setModelProviderForTesting`) so tests can exercise the real
  Anthropic-vs-Mock selection by actually toggling `ANTHROPIC_API_KEY`,
  rather than only testing around it.
- Did not touch the Anthropic provider itself, the agent library, the
  Test Runner, or the BrowserAdapter — this is purely a second
  `ModelProvider` implementation plus the selection logic that picks
  between the two.

---

## 2026-09-23 — Test Lab round: infrastructure failures no longer leave a stuck TestRun or abort the round

**Problem:** the first real round (real Anthropic API call, `npm run
test-lab:round`) failed with no `ANTHROPIC_API_KEY` configured. `runAgent()`
throws synchronously in that case (before returning any result) — and
neither `runTestScenario()` nor `runTestRound()` had a try/catch around
that call. Effect: the `TestRun` stayed stuck at `RUNNING` forever (its
closing `db.testRun.update` never ran), and the whole round aborted after
the first scenario — the second scenario never even started.

**Decision:**
- `runTestScenario()` now wraps everything from the step executor through
  `runAgent()` in a try/catch. Any exception closes the TestRun as
  `NEEDS_REVIEW` with `finishedAt` set and an `observedOutcome` explicitly
  labeled as an infrastructure error — never reinterpreted as something the
  agent found. `RunTestScenarioResult` gained `infrastructureError: string
  | null` so callers can tell this case apart from a real `NEEDS_REVIEW`
  (an `UNCONFIRMED` finding, or a `runAgent` result that came back with
  `status: "FAILED"` after exhausting retries).
- `runTestRound()`'s loop now wraps each scenario's iteration in try/catch
  too (defense in depth, for a failure even before a TestRun could be
  created, e.g. resolving the agent) — on catch, it records the scenario in
  `skipped` with the real error message and continues to the next one,
  instead of the exception propagating out of the whole round.
- `round-report.ts` labels an `infrastructureError` entry distinctly
  ("INFRASTRUCTURE ERROR, not a product finding") in the report; it was
  already impossible for such an entry to appear under "FINDINGS BY TYPE"
  or the DIRETRIZES section, since `finding` stays `null` for it.
- Deliberately not built: automatic retry of a failed scenario (explicitly
  out of scope for this fix) — a failure is recorded and the round moves
  on, nothing more.
- Did not touch `run-agent.ts` (Agent Runtime) or `browser-adapter.ts` —
  the fix is entirely in how the Test Lab layer calls them, not in what
  they do.

---

## 2026-09-23 — Test Lab: the LAB tests itself, round-runner + consolidated report

**Problem:** clarified project philosophy — the LAB is the product;
agents are specialized *users* who operate it, find problems/opportunities,
and produce evidence + recommendations. They never modify the app
themselves. The missing piece: a way to ask for "uma rodada de testes no
LAB" and get back one consolidated report to validate, without an
intelligent router or background automation.

**Decision:**
- Added `agent: string` to `TestScenario` (`test-protocol.ts`) — the slug
  of the agent a scenario is written for, declared statically by the
  scenario's author (both existing scenarios now declare `agent:
  "new-user"`). This is what lets a round pick the right agent per scenario
  without a human specifying it each time, and explicitly **is not** a
  Smart Router: nothing is decided at runtime, it's just naming a fact the
  scenario file already implied.
- Added `classification` to the shared `agentOutputBaseSchema`
  (`src/domain/agent-output.ts`): `BUG | UX | UI | NAVIGATION | DATA |
  PERFORMANCE | ACCESSIBILITY | OPPORTUNITY | FUTURE_RISK`, required
  (via `agentOutputSchema`'s refine) when `status` is `"FINDING"`. This
  revises the earlier "deferred to Phase 7" note in
  `docs/AGENT_ARCHITECTURE.md`: that note lumped `classification` together
  with `FREQUENCY` as both needing cross-execution comparison, but only
  `FREQUENCY` actually does — a single run can self-assess *what kind* of
  problem it found. Purely additive to existing FINDING data going
  forward, but it does make `classification` a new required field on any
  *new* FINDING-status output, so every existing FINDING fixture across the
  test suite was updated (`output-validator.test.ts`, `run-agent.test.ts`,
  `new-user.test.ts`, `test-runner.test.ts`).
- Added `round-runner.ts` (`runTestRound()`): runs every scenario
  `ScenarioRegistry.listEnabled()` returns, once each, resolving each
  one's agent via `scenario.agent` and calling the existing
  `runTestScenario()` — no duplicated execution logic. All runs in a round
  share one fixed, persistent "AI Product Lab (self-test)" `Project` row
  (lazily created once, same shape as `getDefaultOrganization()`), since
  the LAB is now what's being tested, not an external product a `Project`
  row would normally represent. A scenario whose declared agent doesn't
  exist or is disabled is recorded in `skipped` with a reason — never
  silently dropped.
- Added `round-report.ts` (`formatRoundReport()`): pure text formatting
  over a round's results — findings grouped by `classification`, each
  showing scenario/agent/type/impact/evidence/recommendation/confidence,
  followed by a "DIRETRIZES PARA PRÓXIMA ITERAÇÃO" section listing every
  recommendation once, sorted by impact. No new analysis happens here —
  everything printed was already produced by an agent's real run through
  the Agent Runtime; this step only reorganizes it for a human to read.
- Added `scripts/run-test-round.ts` (`npm run test-lab:round`, via the new
  `tsx` devDependency) as the one entry point: it calls `runTestRound()`
  and prints the report, then exits. Deliberately a script run on request
  — no "Run Test" button, no cron/background job, no autonomy for agents to
  change anything. It spends real Anthropic API tokens (real `runAgent()`
  calls, not a test double), unlike the automated test suite.
- Explicitly not built (per the approved scope): Smart Router, Master
  Orchestrator, new agents, new scenarios, a UI trigger, or any code-write
  capability for agents.

---

## 2026-09-23 — Test Lab: a real Playwright BrowserAdapter, not simulated navigation

**Problem:** the Test Lab foundation (previous entry) explicitly recorded
the `new-user-creates-first-project` scenario's UI-navigation steps as "not
automated" rather than fake them, and left `browser-adapter.ts`'s
`BrowserAdapter` interface unimplemented. This step's job: implement it for
real.

**Decision:**
- `browser-adapter.ts` now exports `PlaywrightBrowserAdapter`, a real
  implementation of the *same* `BrowserAdapter` interface (unchanged
  shape) — real Chromium, launched with `executablePath:
  "/opt/pw-browsers/chromium"` (this environment's pre-installed browser)
  rather than letting Playwright try to download one matching its own npm
  package's pinned revision, which doesn't have to match what's actually
  on disk.
- Added `app-server.ts`: starts a real `next start` (production, against
  the existing `.next` build) on a free port. Deliberately does **not**
  build on demand — Vitest can run multiple test files concurrently, and
  two concurrent `next build`s writing the same `.next` directory would
  corrupt each other — so it fails fast if no build exists instead. Owns
  the child process's whole process group (`detached: true` +
  `process.kill(-pid, ...)`), so `close()` actually leaves nothing running.
- `test-runner.ts`'s step executor for `new-user-creates-first-project` now
  drives the real browser through every step (open app, click the real
  "Projects" nav link, read the real form, fill the real name field,
  submit, poll the real page body for the new project's name) instead of
  calling `services/projects.ts` directly. Every `EVIDENCE` field is a real
  DOM read taken *after* an action — a `click`/`fill` resolving without
  throwing is never itself treated as evidence (the fundamental rule from
  the previous entry, now enforced by construction, not just by a comment).
  Any infrastructure failure (server didn't start, a selector never became
  actionable) is recorded as exactly that — an infra failure, not a claim
  about the app — so the agent can tell the difference and answer
  `UNCONFIRMED` rather than invent a verdict.
- Test-data cleanup (deleting the project created through the UI) still
  goes through `db` directly — that's teardown, not part of the tested
  flow, so it doesn't conflict with "use the real server, not
  `services/projects.ts`, for the flow."
- `test-runner.test.ts`'s three scenario-status tests now genuinely start a
  server + browser per test (given real timeouts instead of Vitest's 5s
  default) rather than mocking that away — the cost of that being honest.
  Added `browser-adapter.test.ts`, focused only on the adapter's own
  mechanics (navigate/fill/click/getText, including that a missing selector
  throws rather than silently no-oping) — not a broad end-to-end suite.
- `playwright` added as a devDependency (`--legacy-peer-deps`, same
  `@types/node` peer conflict as every other install in this project;
  installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` since a browser is
  already present).

---

## 2026-09-23 — Test Lab foundation: TestScenario as files, TestRun as a table, findings reuse the existing agent output contract

**Problem:** the LAB needs a first layer for agents to *test* it (not build
it) — a structured scenario, a recorded run, and an honest way to say
"nothing was confirmed" when a step (like real browser navigation) can't
actually be performed yet.

**Decision:**
- `TestScenario` is a versioned file under `src/core/testing/scenarios/`
  (`test-protocol.ts` + `registry.ts`), the same file-based pattern as the
  agent library — but *without* the database-merge half of that pattern:
  scenarios have no operational state an operator needs to override
  without a deploy yet, so `ScenarioRegistry` is a plain read-only lookup,
  not a second Registry that talks to Postgres. Revisit if that changes.
- `TestRun` is a new Prisma table (migration `test_lab_foundation`) —
  operational history, same reasoning as `AgentExecution`. It does **not**
  duplicate token/cost/model fields: it references the `AgentExecution` it
  produced via a unique `executionId` and those numbers are read from
  there. `TestRun.durationMs` is its own field on purpose — it times the
  whole run (step execution + agent call), a different measurement than
  `AgentExecution.durationMs` (just the model call).
- Findings produced by a `TestRun` reuse `src/domain/agent-output.ts`'s
  existing `AgentOutput` shape as-is (stored in `TestRun.findings` as
  JSON) instead of a new `TestFinding` type — FINDING/IMPACT/
  RECOMMENDATION/CONFIDENCE is exactly what that schema already is.
- Added `"UNCONFIRMED"` as a third value to `AGENT_OUTPUT_STATUSES`
  (previously `FINDING`/`NO_FINDING` only) — purely additive, no existing
  caller or stored data is affected. This was already anticipated:
  `src/core/findings/README.md` (Phase 7, still empty) already said
  "unconfirmed things are marked UNCONFIRMED, not asserted" before this
  step existed; this just brings that one piece of vocabulary forward into
  the shared contract now that something needs it, without building the
  rest of Phase 7 (deduplication, Decision/Task promotion — still
  deferred).
- No `core/testing/findings/` subfolder, despite the originally proposed
  `{scenarios,runner,findings}` layout — see the reuse point above, and
  `src/core/testing/README.md`'s "Why no `findings/` module" section.
- Browser automation is explicitly not built. `runner/browser-adapter.ts`
  declares the interface a future implementation must satisfy and is
  `null` today; `test-runner.ts` records any step that would need it as
  **not automated**, never as a passed or failed observation — the agent
  is told exactly which observations are real vs. unautomated and must
  answer `UNCONFIRMED` rather than invent a result for the latter.
- The one real scenario (`new-user-creates-first-project`) exercises the
  real `services/projects.ts` (`createProject`/`listProjects`) directly —
  real database writes/reads, not a browser, but not fabricated either.

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

---

## 2026-09-25 — Security headers: hardened, CSP deferred

**Problem:** an OWASP ZAP baseline scan (FASE 9) flagged missing
`X-Frame-Options`, `X-Content-Type-Options`, a leaked `X-Powered-By`
header, and no `Content-Security-Policy`.

**Facts:** the first three are static, unconditional header values — no
per-request logic needed. CSP is different: inspecting a live response
confirmed the App Router injects real inline `<script>` tags
(`self.__next_f.push(...)`) to stream the RSC hydration payload — this is
core framework behavior, not something this app's own code controls. A
`script-src` without `'unsafe-inline'` would break hydration outright.
Next.js's own documented fix is a per-request nonce generated in
`middleware.ts`, threaded into the CSP header and picked up automatically
by Next's own inline-script injection — but that means introducing a new
file and a new request-handling layer the project doesn't have yet, not a
header tweak.

**Interpretation:** shipping `'unsafe-inline'` just to make a CSP present
would satisfy the scanner without adding real protection — worse, it
would look like a solved problem when it isn't. Adding `middleware.ts`
just for this is a bigger structural change than "fix four headers."

**Decision:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
and `poweredByHeader: false` are set centrally in `next.config.ts`. CSP is
deliberately deferred — revisit once `middleware.ts` exists for another
real reason, or once a nonce-based CSP is worth introducing on its own
merits, not as a reaction to a scanner warning.
