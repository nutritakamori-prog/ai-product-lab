# Agent Architecture

## Where agents live

Agent definitions are **code**, under `src/core/agents/registry/*.ts` (created
in Phase 5) — not database rows. See `docs/DECISIONS.md` for the reasoning.
`AgentExecution` (the database table) only records that a run happened.

## What every agent must know

Beyond its config (id, capabilities, system prompt, schemas — full shape in
`docs/AGENT_SPECIFICATION.md`), every agent's system prompt must answer two
questions explicitly:

1. **"What problem do I solve?"**
2. **"When should I NOT be called?"**

The second question is what lets the Smart Router avoid running, say, the
CEO agent or the Art Director on a plain "this button doesn't work" bug —
which is where most wasted tokens come from in a naive multi-agent system.

## Communication contract

Every agent returns the same shape, regardless of type:

```
AGENT
STATUS
FINDING
EVIDENCE
IMPACT
FREQUENCY
RECOMMENDATION
CONFIDENCE
NEEDS_OTHER_AGENT
```

Never chain-of-thought. Only observations, evidence, conclusions,
recommendations, confidence, and a short justification are ever stored.

## Evidence-first

```
ACTION:    what was done
EXPECTED:  what should have happened
OBSERVED:  what actually happened
EVIDENCE:  what supports that observation
CLASSIFICATION: finding type
CONFIDENCE: LOW / MEDIUM / HIGH
```

If there's no evidence, the finding is `UNCONFIRMED` — never asserted as fact.

## Agent groups (20 agents, Phase 5+)

- **Experience Lab:** New User, Clinic/Office User, Impatient User, Confused
  User, Mobile User, Returning User.
- **QA Lab:** QA Investigator, Visual QA.
- **Design Lab:** UX Architect, UI Designer, Visual Designer, Grid & Layout
  Designer, Content Designer, Responsive Designer, Accessibility Designer,
  Design System Architect, Art Director, Page/Frame Creator.
- **Product Strategy:** Product Strategist, CEO/Head of Product.

Each has a distinct responsibility — see `docs/AGENT_SPECIFICATION.md` once
Phase 5 fills in the concrete prompts/schemas per agent. They are not
templated copies of each other.

## Routing

The Smart Router (part of `core/orchestrator`) decides which agents
participate in a given LAP, and must record *why* internally (structured),
even though the UI only ever surfaces:

```
AGENT SELECTED
REASON
PRIORITY
```

## Conflict resolution — Design Council

When agents disagree:
- **Round 1:** every involved agent gives FINDING / EVIDENCE / RECOMMENDATION.
- **Round 2:** only the agents still in conflict respond.
- Then: **CONSENSUS** or **ESCALATE**. Never a third round.
