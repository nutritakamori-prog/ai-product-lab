# Agent Runtime

**Responsibility:** actually execute one agent, for real. `run-agent.ts`'s
`runAgent({ agent, project, task, context, executionConfig })`:
loads the model for the agent's tier (`core/models`), builds the prompt
(`build-prompt.ts`, using `core/context` for now-minimal context
serialization), calls the model via Structured Outputs, validates the
result (`output-validator.ts`), records tokens/cost/duration/status, saves
an `AgentExecution` row, and returns a structured result.

On invalid output: retries (default 2 extra attempts, telling the model
what was wrong) before giving up — an invalid response is never saved as
a successful result. On a transport/API error: not retried here (the
Anthropic SDK already retries transient failures) — recorded as FAILED
immediately.

Token budget: `agent.tokenBudget` is passed straight through as the
model's `max_tokens`, so a single response can't run away — a hard cap,
not just a logged number.

**Not this module's job:** deciding *which* agents to run (`core/orchestrator`,
not built yet — for now, callers load an agent via `core/agents/registry.ts`
themselves), or *what* context to select (`core/context`'s smart selection
is Phase 3; today it's a raw pass-through).

Test with a fake `ModelProvider` (`setModelProviderForTesting`) — never
against the real API, since that costs real tokens.
