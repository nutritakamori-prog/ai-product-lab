# Scenarios

**Responsibility:** define what a test is. A `TestScenario`
(`test-protocol.ts`) is structured, versioned content — objective,
preconditions, steps, expected outcome, priority, category, **agent** — one
file per scenario under this folder, listed in `index.ts`, read through
`registry.ts`. Same pattern as the agent library
(`agents/system/agent-protocol.ts` + `agents/index.ts` +
`core/agents/registry.ts`), applied to a second kind of versioned content.

`agent` is the slug of the agent this scenario is written for (a static,
author-declared fact — like an `AgentDefinition`'s own `category` — not a
runtime decision). It's what lets `runner/round-runner.ts` run every
enabled scenario without a human picking the agent each time, without
needing a Smart Router.

## Why files, not a database table (for now)

Unlike `Agent`, a `TestScenario` has no operational state an operator needs
to change without a deploy yet — no per-scenario token budget or model tier
to override independently of the file. `ScenarioRegistry` is a plain
read-only lookup over `TEST_SCENARIOS`, with no database merge step.
Everything the agent library's file+DB split (`docs/DECISIONS.md`) solves
does not yet apply here — reconsider if a real need for editing scenarios
without a deploy shows up (e.g. a QA-facing screen to author new ones).

## Adding a scenario

1. Add a file here, validated with `testScenarioSchema.parse(...)`.
2. Add it to `TEST_SCENARIOS` in `index.ts`.
3. Add a matching entry to `STEP_EXECUTORS` in `../runner/test-runner.ts` —
   without one, a `TestRun` for that scenario comes back `BLOCKED`.

_(Two scenarios today: `new-user-creates-first-project` and
`new-user-discovers-and-creates-first-project`, both written for `new-user`.)_
