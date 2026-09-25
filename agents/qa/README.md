# QA agents

`qa-agent` — checks functional behavior, validations, errors, regressions,
and expected-vs-observed outcomes against real evidence. Never diagnoses a
technical root cause without evidence for it; uses `UNCONFIRMED` when the
evidence doesn't clearly show a problem. Same pattern as
`agents/experience/new-user.ts` — see that file's own comments for the
reasoning behind the shape.

Visual QA is not built yet. Add an agent here as a `.ts` file exporting a
default `AgentDefinition` (see `agents/system/agent-protocol.ts`), then
list it in `agents/index.ts`.
