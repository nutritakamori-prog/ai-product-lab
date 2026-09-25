# Test Runner

**Responsibility:** run one `TestScenario` attempt end to end and record it
as a `TestRun`. `test-runner.ts`'s `runTestScenario({ scenario, agent,
project })`:

1. Opens a `TestRun` (`status: RUNNING`).
2. Runs the scenario's step executor (`STEP_EXECUTORS[scenario.id]`) to
   gather real `Observation`s (`ACTION`/`EXPECTED`/`OBSERVED`/`EVIDENCE`) —
   for `new-user-creates-first-project`, by actually driving a real browser
   against a real running instance of the app (see below). If browser
   automation itself fails (server didn't start, a selector never became
   actionable), that's recorded as an infrastructure failure observation,
   never as a claim about the app.
3. Hands those observations to the agent through the existing Runtime
   (`core/runtime`'s `runAgent()` — not reimplemented here) for analysis.
4. Closes the `TestRun` with a status derived from what the agent reported:
   `NO_FINDING` → `PASSED`, `FINDING` → `FAILED` (findings recorded),
   `UNCONFIRMED` → `NEEDS_REVIEW` (findings recorded, but flagged as
   unconfirmed), an execution failure → `NEEDS_REVIEW`. No matching step
   executor → `BLOCKED`, without calling the agent at all.

Steps 3–4 run inside a try/catch: anything that throws there (a missing
`ANTHROPIC_API_KEY`, a dropped connection — infrastructure, never the
app) closes the TestRun as `NEEDS_REVIEW` with `finishedAt` set and
`RunTestScenarioResult.infrastructureError` populated, instead of leaving
the row stuck at `RUNNING` or letting the exception escape and abort a
round. See `docs/DECISIONS.md`.

Token usage/cost/model are deliberately not stored again on `TestRun` — it
references the `AgentExecution` it produced (`executionId`), which already
has them; join through that row instead of trusting a second copy.
`TestRun.durationMs` is its own number: the whole run's wall time, not just
the model call.

## Step executors: honest, scenario-specific, not a generic interpreter

`STEP_EXECUTORS` is a small map from scenario id to the code that actually
attempts it. For `new-user-creates-first-project`, every step is driven
through the real UI: open the app, click the real "Projects" nav link,
read the real form, fill the real name field, submit it, and poll the real
page body until the new project's name actually appears (or give up and
say so). Each step's `EVIDENCE` is a real DOM read (`getText`) taken
*after* the action — a `click`/`fill` call resolving without throwing is
never itself treated as evidence, per the fundamental rule.

This is deliberately not a generic "run these steps" engine — with one
scenario, building that would be solving a problem that doesn't exist yet.
Each new scenario earns its own executor entry (see `../scenarios/README.md`).

Test-data hygiene: the project created through the UI is deleted from the
database afterward (`cleanupTestProject`), same reasoning as
`agents/experience/new-user.test.ts`'s own fixture — this scenario's job is
to prove creation works, not to leave a permanent project behind.

## The browser adapter and app server

`browser-adapter.ts`'s `PlaywrightBrowserAdapter` is a real implementation
of `BrowserAdapter` — real Chromium (pre-installed in this environment,
launched via its known `executablePath` rather than letting Playwright try
to download a browser matching its own npm package version), real
actionability-checked clicks/fills, real DOM reads. `app-server.ts` starts
a real `next start` (the existing production build — not `next dev`, and
not a build-on-demand: two test files can start a server concurrently,
and two concurrent `next build`s writing the same `.next` directory would
corrupt each other, so a build must already exist) on a free port, and
owns that child process fully: `close()` kills its whole process group, so
nothing is left running once a run finishes. Every scenario run that needs
the browser starts its own server + browser and tears both down in a
`finally` block, even on failure.

**Prerequisite:** a production build must exist (`npm run build`) before
running anything that starts the app server — it fails fast with a clear
error otherwise, rather than silently building.

## Running a round

`round-runner.ts`'s `runTestRound()` runs every scenario `ScenarioRegistry
.listEnabled()` returns, once each, with the agent each one declares
(`scenario.agent` — resolved via `AgentRegistry.getBySlug`, never chosen
dynamically; a scenario with no matching/enabled agent is recorded in
`skipped`, never silently dropped). Each run goes through the exact same
`runTestScenario()` above — nothing about single-scenario execution is
duplicated. All runs in a round share one fixed, persistent "AI Product Lab
(self-test)" project (created once, lazily, like
`services/organizations.ts`'s default organization) rather than a
throwaway project per round, since the LAB is what's being tested now, not
an external product.

One scenario failing — for infrastructure reasons or otherwise — never
stops the round: `runTestScenario()` itself never throws once a TestRun
exists (see above), and the loop here also catches anything that could
fail even earlier (e.g. resolving the agent), recording it in `skipped`
instead. Every remaining scenario still gets attempted, and the round
still produces a full report at the end. No automatic retry of a failed
scenario — that's explicitly not built here.

`round-report.ts`'s `formatRoundReport()` turns that result into one
consolidated, plain-text report: findings grouped by `classification`
(BUG/UX/UI/NAVIGATION/DATA/PERFORMANCE/ACCESSIBILITY/OPPORTUNITY/
FUTURE_RISK), each with scenario/agent/type/impact/evidence/
recommendation/confidence; every run's status; and a closing "DIRETRIZES
PARA PRÓXIMA ITERAÇÃO" section that lists each recommendation once, sorted
by impact. It only reorganizes what the agents already produced during the
round (via the real Agent Runtime) — no new analysis happens in this step,
and nothing here changes any state.

`scripts/run-test-round.ts` (`npm run test-lab:round`) is the entry point:
it calls `runTestRound()` and prints the report. This is a script invoked
on request — not a UI button, not a cron/background job — and it spends
real Anthropic API tokens each time (unlike the test suite, which always
injects a fake `ModelProvider`). This is what "faça uma rodada de testes no
LAB" means today: running this script and reading its output back.

**Not this module's job:** choosing which scenario/agent to run
automatically based on some evaluated criteria (`core/orchestrator`'s Smart
Router, not built), consolidating findings across *multiple* rounds
(`core/findings`, Phase 7), or comparing two `TestRun`s against each other
over time (`core/lap`'s Retest Engine, Phase 8). And, always: agents never
modify the app themselves — a round only ever produces evidence and
recommendations for a human to act on.
