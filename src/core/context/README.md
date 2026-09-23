# Context Engine

**Responsibility:** build the *minimum* context a given agent run actually needs.
Never send the whole project to every agent. Priority order when assembling context:
1. Task, 2. Evidence, 3. Relevant project context, 4. Relevant memory, 5. Relevant decisions.

Goal: maximum relevance, minimum tokens.

**Not this module's job:** running the agent (`core/runtime`) or deciding which
agents participate (`core/orchestrator`).

**Current state (Phase 2 stub):** `build-context.ts` only serializes whatever
context object it's handed into text — it does no selection, relevance
ranking, or token budgeting. The real Context Engine (the priority order
above, picking *what* goes into that object) is Phase 3; this stub exists
now only because `core/runtime` needs something to call.
