# Test Lab

**Responsibility:** the LAB testing itself. This is not the agent library and
not the Agent Runtime — it's the layer that turns a structured `TestScenario`
into a `TestRun`, by driving an existing agent through `core/runtime`'s
`runAgent()` against a real (or, where noted, not-yet-automated) part of the
app.

The LAB is the product being built. Agents are the team that tests, operates,
and analyzes the LAB — they don't exist to build it. This module is where
that testing actually happens.

## The cycle this module exists to support

AGENTE USA O LAB → OBSERVA → ENCONTRA PROBLEMA OU OPORTUNIDADE → REGISTRA
EVIDÊNCIA → FAZ RECOMENDAÇÃO → **você valida** → (separately) alguém
implementa → AGENTE TESTA NOVAMENTE.

This module owns everything up to "você valida" — an agent operating the
LAB, observing, and producing evidenced findings/recommendations for a
human to review. It stops there on purpose: agents never modify the app,
there's no button that triggers a run, and nothing runs on a schedule or in
the background. A round only happens when explicitly asked for (today: `npm
run test-lab:round`, read by a human or relayed by Claude Code) — see
`runner/README.md`'s "Running a round" section.

## Structure

- `scenarios/` — what a test is: a versioned `TestScenario` definition file
  per scenario (including which agent it's written for), validated by
  `test-protocol.ts`, read by `registry.ts`.
- `runner/` — how a test runs: `test-runner.ts`'s `runTestScenario()` opens a
  `TestRun`, gathers real observations for one scenario, hands them to the
  agent for analysis, and closes the run with a status and any findings.
  `round-runner.ts`'s `runTestRound()` runs every enabled scenario once, and
  `round-report.ts` formats the results into one consolidated report.

No `findings/` subfolder here, unlike the structure originally proposed —
see "Why no `findings/` module" below.

## The fundamental rule

No problem is ever created from opinion alone. If there isn't enough
evidence, the result is `UNCONFIRMED` — not a claim. Agents must never
simulate having navigated or clicked through the UI if they didn't. Now
that `runner/browser-adapter.ts` is a real Playwright implementation, this
means: a `click`/`fill` call that doesn't throw is never itself treated as
evidence — every step reads the real DOM afterward (`getText`) and that
reading is what becomes the observation's `EVIDENCE`. See
`agents/system/evidence-rules.ts`'s `EVIDENCE_FIRST_REMINDER` (covers
`UNCONFIRMED`) and `runner/README.md`'s "Step executors" section.

## Why no `findings/` module

A `TestRun`'s findings reuse `src/domain/agent-output.ts`'s existing
`AgentOutput` shape (`finding`/`evidence`/`impact`/`recommendation`/
`confidence`) directly — the FINDING/IMPACT/RECOMMENDATION/CONFIDENCE
contract this step needs already exists and is exactly this shape. Adding a
parallel `TestFinding` type would duplicate it for no reason.

The real Findings module (`core/findings`, Phase 7) does something this
module deliberately does not: deduplicate findings across many executions
and promote them into Decisions/Tasks. A single `TestRun`'s findings are not
deduplicated against anything — they stay exactly what one run produced.
`core/findings` stays empty and unaffected; when Phase 7 arrives, it can
consume `TestRun.findings` as one more source, not a rival implementation.

## What's real vs. not yet, in this step

- Real: the one scenario is driven through a real, running instance of the
  app (`runner/app-server.ts` starts a real `next start`) by a real
  Chromium browser (`runner/browser-adapter.ts`'s `PlaywrightBrowserAdapter`)
  — clicking the real nav link, filling the real form, reading the real DOM
  afterward as evidence. See `docs/DECISIONS.md`.
- Not yet: a generic step-interpreter for arbitrary future scenarios (see
  `runner/README.md`'s "Step executors" section) and a persistent/shared
  server instead of one spun up per run.

**Not this module's job:** deciding *which* agents/scenarios to run
automatically (`core/orchestrator`, not built), or the LAP-level Retest
Engine that compares two `TestRun`s over time (`core/lap`, Phase 8 — a
`TestRun` is the primitive it will eventually compare, not something it
replaces).

_(Two scenarios, both using the existing `new-user` agent. Built to validate
the pipeline, not as a full test suite.)_
