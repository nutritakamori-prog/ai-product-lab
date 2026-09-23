# Agents

**Responsibility:** resolve an agent by id into everything `core/runtime`
needs to execute it.

Agent *behavior* (role, objective, responsibilities, constraints, system
prompt) lives in versioned files under `/agents/{category}/{id}.ts`,
validated against `agents/system/agent-protocol.ts`. Agent *operational
state* (category, model tier, token budget, enabled) lives in the `Agent`
table. See `docs/AGENT_ARCHITECTURE.md` and `docs/DECISIONS.md` for why
it's split this way.

`registry.ts` is the only place that merges the two — `getBySlug` /
`listEnabled` / `list` return a `ResolvedAgent` (the file's behavior plus
the database's current operational values; the database wins for
enabled/tokenBudget/modelTier once a row exists). Adding a new agent means
adding a file to `/agents` and one line in `agents/index.ts` — this file
never changes for that.

Agent-specific logic that isn't just config (e.g. per-agent output
post-processing) lands here too, once real agents exist (Phase 5).

**Not this module's job:** running an agent (`core/runtime`), deciding which agents
to call (`core/orchestrator`), or building the prompt context (`core/context`).

_(Registry + the library scaffold exist; only one real agent — `new-user` —
built to validate the pipeline. Phase 5 adds the rest.)_
