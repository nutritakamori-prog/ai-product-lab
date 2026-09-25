# Master Orchestrator + Smart Router

**Responsibility:** the brain. Interprets the objective, identifies the task type,
routes to the relevant agents (Smart Router) with a structured reason for each
selection, controls context, receives results, detects conflicts, deduplicates
findings, requests a second round when needed, consolidates, and decides when to stop.

Hard rule: max 2 discussion rounds. Consensus → stop. No consensus → escalate.
Never an infinite loop.

The Router must justify each agent selection internally (structured), but the UI
only ever shows: AGENT SELECTED / REASON / PRIORITY — never chain-of-thought.

**Not this module's job:** executing an agent (`core/runtime`) or building its
context (`core/context`).

_(Master Orchestrator itself still empty — deferred. The Smart Router's
first, minimal version now exists: `smart-router.ts`. It picks exactly one
initial agent by a small deterministic keyword rule — no LLM call, no agent
discovery — then hands off entirely to the existing coordination layer
(`core/coordination/`), which already enforces the call/round limits. No
routing justification structure, no multi-round consensus, no conflict
detection/deduplication yet — those stay future work for the real Master
Orchestrator described above.)_
