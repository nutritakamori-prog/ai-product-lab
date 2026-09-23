# Agent Architecture

## Where agents live

Agent **behavior** is a versioned file — `/agents/{category}/{id}.ts` —
validated against `agents/system/agent-protocol.ts`'s `agentDefinitionSchema`.
One file per agent: role, objective, responsibilities, constraints,
`whenNotToCall`, `systemPrompt`. Adding an agent means adding a file plus
one line in `agents/index.ts` — no core code changes.

Agent **operational state** (category, model tier, token budget, enabled)
lives in the `Agent` table, seeded from the file's own defaults the first
time it's discovered and independently adjustable after that (an operator
can disable an agent or shrink its budget without a deploy). See
`docs/DATABASE.md` and `docs/DECISIONS.md`.

`src/core/agents/registry.ts` is what merges the two: `AgentRegistry.getBySlug()`
returns the file's behavior with the database's current operational state
layered on top — this merged object is what `core/runtime` actually executes.

## What every agent must know

Beyond its config (full shape in `docs/AGENT_SPECIFICATION.md`), every
agent's definition must answer two questions explicitly:

1. **"What problem do I solve?"**
2. **"When should I NOT be called?"**

The second question is what lets the Smart Router avoid running, say, the
CEO agent or the Art Director on a plain "this button doesn't work" bug —
which is where most wasted tokens come from in a naive multi-agent system.

## Communication contract (implemented, Phase 2)

Every agent returns the same shape, regardless of type — enforced by
`src/domain/agent-output.ts` (re-exported for convenience from
`agents/system/agent-protocol.ts`) and the Output Validator
(`src/core/runtime/output-validator.ts`):

```
agent             — the agent's own slug, self-reported
status            — "FINDING" | "NO_FINDING" | "UNCONFIRMED"
finding           — required when status is FINDING, otherwise null
evidence          — ACTION/EXPECTED/OBSERVED evidence; required when status is FINDING
impact            — CRITICAL | HIGH | MEDIUM | LOW; required when status is FINDING
recommendation    — required when status is FINDING
confidence        — LOW | MEDIUM | HIGH
needsOtherAgent   — slug of another agent to also weigh in, or null
```

`UNCONFIRMED` (added for the Test Lab, `src/core/testing`) is distinct from
`NO_FINDING`: it means something looked suspicious but there wasn't enough
evidence to confirm it as a real problem — for example, a step that
couldn't actually be automated yet. It carries no required fields, same as
`NO_FINDING`.

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

If there's no evidence, the agent must return `status: "NO_FINDING"` (nothing
to report) or `status: "UNCONFIRMED"` (something looked off but couldn't be
confirmed) rather than assert something as fact — the canonical reminder
text lives in `agents/system/evidence-rules.ts`, and the Runtime's prompt
builder (`src/core/runtime/build-prompt.ts`) appends it on every call.

## Agent groups (20 agents, Phase 5+) → library folders

| Group | Folder | Agents |
|---|---|---|
| Experience Lab | `agents/experience/` | New User ✅ (only one built), Clinic/Office User, Impatient User, Confused User, Mobile User, Returning User |
| QA Lab | `agents/qa/` | QA Investigator, Visual QA |
| Design Lab | `agents/design/` | UX Architect, UI Designer, Visual Designer, Grid & Layout Designer, Content Designer, Responsive Designer, Accessibility Designer, Design System Architect, Art Director, Page/Frame Creator |
| Product Strategy | `agents/strategy/` | Product Strategist, CEO/Head of Product |
| — | `agents/orchestration/` | Reserved for future agents that participate in orchestration itself — empty today |

Each has a distinct responsibility — see `docs/AGENT_SPECIFICATION.md` once
Phase 5 fills in the concrete prompts/schemas per agent. They are not
templated copies of each other.

## Routing

The Smart Router (part of `core/orchestrator`, not built) decides which
agents participate in a given LAP, and must record *why* internally
(structured), even though the UI only ever surfaces:

```
AGENT SELECTED
REASON
PRIORITY
```

`agents/system/routing-rules.ts` exists as this logic's documented future
home — today it's a placeholder re-exporting the category list, nothing more.

## Conflict resolution — Design Council

When agents disagree:
- **Round 1:** every involved agent gives FINDING / EVIDENCE / RECOMMENDATION.
- **Round 2:** only the agents still in conflict respond.
- Then: **CONSENSUS** or **ESCALATE**. Never a third round.

Not implemented — depends on the Orchestrator (Phase 4) existing first.
`agents/system/decision-framework.ts` documents the facts/interpretation/
recommendation separation agents should already respect in their
`systemPrompt`, ahead of Phase 7 enforcing it structurally.
