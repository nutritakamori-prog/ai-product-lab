# Context Engine

**Responsibility:** build the *minimum* context a given agent run actually needs.
Never send the whole project to every agent. Priority order when assembling context:
1. Task, 2. Evidence, 3. Relevant project context, 4. Relevant memory, 5. Relevant decisions.

Goal: maximum relevance, minimum tokens.

**Not this module's job:** running the agent (`core/runtime`) or deciding which
agents participate (`core/orchestrator`).

_(Empty until Phase 3 — Context Engine.)_
