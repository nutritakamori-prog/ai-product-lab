# Agents

**Responsibility:** the *definitions* of every agent (New User, QA Investigator, UX Architect, etc).

Each agent is a code-defined config object with: id, name, type, description,
responsibility, capabilities, system prompt, input schema, output schema, token
budget, priority, recommended model, version, enabled flag, allowed tools, and
which task types it supports. See `docs/AGENT_SPECIFICATION.md` for the exact shape.

Agent definitions live in code (not the database) because they're logic that changes
with the codebase and needs review — see `docs/DECISIONS.md` for why.

**Not this module's job:** running an agent (`core/runtime`), deciding which agents
to call (`core/orchestrator`), or building the prompt context (`core/context`).

_(Empty until Phase 5 — first agents.)_
