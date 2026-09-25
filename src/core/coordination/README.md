# Agent Coordination

**Responsibility:** the smallest possible gatekeeper for `needsOtherAgent` —
given an initial agent's run, decide whether it's actually allowed to hand
off to the specialist it named, run that one review round through the
existing `AgentMessageBus`/`runAgent()`/`AgentRegistry`, and deliver the
specialist's `REVIEW_RESPONSE` back. Enforces two explicit, hard-coded
limits (`maxAgentCallsPerTask = 2`, `maxReviewRounds = 1`), refuses any
`needsOtherAgent` the Registry doesn't recognize (`COORDINATION_BLOCKED`),
and never calls the same agent twice for one task. No token/cost tracking
of its own — that's `runAgent`'s job already.

**Not this module's job:** selecting which agent to call, building context,
resolving conflicts between findings, running more than one round, or
persisting anything beyond what `runAgent()` already does. That's the
future Smart Router / Master Orchestrator (`src/core/orchestrator/`, still
empty) — this module only ever runs the single round it's handed, then
stops.
