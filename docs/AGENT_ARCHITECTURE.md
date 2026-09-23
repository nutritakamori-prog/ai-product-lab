# Agent Architecture

## Where agents live

Agent definitions are **database rows** (the `Agent` table) — see
`docs/DATABASE.md`. `src/domain/agent.ts` defines the Zod schema every
agent must validate against; Phase 5 populates real rows through that
schema, one reviewed agent at a time (not seeded in bulk). See
`docs/DECISIONS.md` for why this reverses an earlier "code only" call.

## What every agent must know

Beyond its config (id, capabilities, system prompt, schemas — full shape in
`docs/AGENT_SPECIFICATION.md`), every agent's system prompt must answer two
questions explicitly:

1. **"What problem do I solve?"**
2. **"When should I NOT be called?"**

The second question is what lets the Smart Router avoid running, say, the
CEO agent or the Art Director on a plain "this button doesn't work" bug —
which is where most wasted tokens come from in a naive multi-agent system.

## Communication contract (implemented, Phase 2)

Every agent returns the same shape, regardless of type — enforced by
`src/domain/agent-output.ts` and the Output Validator
(`src/core/runtime/output-validator.ts`):

```
agent             — the agent's own slug, self-reported
status            — "FINDING" | "NO_FINDING"
finding           — required when status is FINDING, otherwise null
evidence          — ACTION/EXPECTED/OBSERVED evidence; required when status is FINDING
impact            — CRITICAL | HIGH | MEDIUM | LOW; required when status is FINDING
recommendation    — required when status is FINDING
confidence        — LOW | MEDIUM | HIGH
needsOtherAgent   — slug of another agent to also weigh in, or null
```

Guaranteed two ways: the Anthropic call uses Structured Outputs
(`messages.parse` + a JSON Schema generated from the Zod object), so the
*shape* always matches; the Output Validator then checks the one business
rule Structured Outputs can't express — `status: "FINDING"` requires the
other four fields to be non-null. Never chain-of-thought — only the fields
above are ever stored.

**Deferred to Phase 7 (Findings):** `FREQUENCY` (isolated/recurrent/
generalized) and a finding-type `CLASSIFICATION` (bug/UX/UI/...). Both are
properties of comparing *multiple* executions against each other — a
single agent run has no way to know if a problem is recurrent, so they
belong to the Finding record the Findings module creates by consolidating
executions, not to this per-execution contract.

## Evidence-first

```
ACTION:    what was done
EXPECTED:  what should have happened
OBSERVED:  what actually happened
EVIDENCE:  what supports that observation
CONFIDENCE: LOW / MEDIUM / HIGH
```

If there's no evidence, the agent must return `status: "NO_FINDING"` rather
than assert something as fact — the Runtime's prompt builder
(`src/core/runtime/build-prompt.ts`) says this explicitly on every call.

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
