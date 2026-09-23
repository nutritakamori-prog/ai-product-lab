# Agent Runtime

**Responsibility:** actually execute one agent, for real. Given an Agent (from
`core/agents`) + a Task + a Context (from `core/context`) + a Project + execution
config, it must: load the agent's config, pick a model, assemble the prompt,
call the model, validate the output against the agent's schema, record tokens/cost/
duration/status, save the result, and return a structured result.

On error: record the error (never swallow it) and allow a controlled retry — never
retry silently in a loop.

**Not this module's job:** deciding *which* agents to run (`core/orchestrator`),
or *what* context to hand the agent (`core/context`).

_(Empty until Phase 2 — Agent Runtime.)_
