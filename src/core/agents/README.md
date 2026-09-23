# Agents

**Responsibility:** the *definitions* of every agent (New User, QA Investigator, UX Architect, etc).

Each agent is a row in the `Agent` table (name, type, description,
responsibility, capabilities, system prompt, input/output schema, token
budget, priority, recommended model, version, enabled flag, allowed tools,
supported task types). The shape is defined once as a Zod schema in
`src/domain/agent.ts` — see `docs/AGENT_SPECIFICATION.md` for the exact
fields and `docs/DECISIONS.md` for why this lives in the database rather
than only in code.

`registry.ts` (Phase 2) is the only place that looks an agent up to run it —
`getBySlug` / `listEnabled` / `list`, thin wrappers over `db.agent`. Adding
a new agent is inserting a row; this file never changes for that. Callers
(the future Orchestrator, or a script) use the registry to load an `Agent`,
then hand it to `core/runtime`'s `runAgent()`.

Agent-specific logic that isn't just config (e.g. per-agent output
post-processing) lands here too, once agents exist (Phase 5).

**Not this module's job:** running an agent (`core/runtime`), deciding which agents
to call (`core/orchestrator`), or building the prompt context (`core/context`).

_(Registry exists; no actual agent rows yet — Phase 5.)_
