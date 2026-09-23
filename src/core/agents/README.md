# Agents

**Responsibility:** the *definitions* of every agent (New User, QA Investigator, UX Architect, etc).

Each agent is a row in the `Agent` table (name, type, description,
responsibility, capabilities, system prompt, input/output schema, token
budget, priority, recommended model, version, enabled flag, allowed tools,
supported task types). The shape is defined once as a Zod schema in
`src/domain/agent.ts` — see `docs/AGENT_SPECIFICATION.md` for the exact
fields and `docs/DECISIONS.md` for why this lives in the database rather
than only in code.

This module (added in Phase 5) is where agent-specific logic that isn't
just config lives — e.g. building the concrete prompt from a stored
`Agent` row plus a task, or agent-specific output post-processing.

**Not this module's job:** running an agent (`core/runtime`), deciding which agents
to call (`core/orchestrator`), or building the prompt context (`core/context`).

_(Empty until Phase 5 — first agents. `src/domain/agent.ts` and the `Agent`/
`ProjectAgent` tables already exist — see `docs/DATABASE.md`.)_
