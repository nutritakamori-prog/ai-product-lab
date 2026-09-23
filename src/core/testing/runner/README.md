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

**Not this module's job:** choosing which scenario/agent to run
automatically (`core/orchestrator`, not built), or comparing two `TestRun`s
against each other over time (`core/lap`'s Retest Engine, Phase 8).
