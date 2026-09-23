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

_(Empty until Phase 4 — Master Orchestrator, though the Smart Router's first
simple version arrives together with the first agents in Phase 5.)_
