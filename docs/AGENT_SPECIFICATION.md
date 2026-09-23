# Agent Specification

This file will hold the concrete spec for each of the 20 agents once Phase 5
implements them. For now, it fixes the **shape** every agent definition
file must have — implemented as a Zod schema in
`agents/system/agent-protocol.ts`, one file per agent under
`/agents/{category}/{id}.ts` — so the first agent (`new-user`) already
sets the pattern correctly for the ones that follow.

## Agent definition shape

```ts
// agents/system/agent-protocol.ts
interface AgentDefinition {
  id: string; // stable, file-referenceable id — e.g. "new-user"
  name: string;
  category: "EXPERIENCE" | "QA" | "DESIGN" | "STRATEGY" | "ORCHESTRATION";
  role: string; // who this agent is pretending to be / acting as
  objective: string; // what it's trying to accomplish
  responsibilities: string[];
  constraints: string[];
  whenNotToCall: string; // "when should I NOT be called?" — required, not optional
  systemPrompt: string;
  outputSchema?: Record<string, unknown>; // optional — defaults to the shared contract, see below
  tokenBudget: number;
  modelTier: "LOW_COST" | "BALANCED" | "HIGH_REASONING";
  enabled: boolean;
}
```

`whenNotToCall` is not decorative — the Smart Router reads it to decide
whether an agent belongs in a given LAP at all.

`tokenBudget`/`modelTier`/`enabled` here are the agent author's *defaults*.
The `Agent` database table holds the actual operational values, seeded
from these the first time the agent is discovered — see
`docs/AGENT_ARCHITECTURE.md` and `docs/DECISIONS.md`.

## Output contract (implemented, Phase 2)

Every agent's actual output is validated against **one shared schema**,
`src/domain/agent-output.ts` — see `docs/AGENT_ARCHITECTURE.md` for the
field list. It is deliberately not customized per agent: the whole point
of "every agent returns the same shape" (original spec §14) is that the
Orchestrator and Findings pipeline can treat any agent's result uniformly.

**Known gap:** `AgentDefinition.outputSchema` (optional, in the file) is
not currently read by the Runtime — it always validates against the
shared schema regardless of what an individual agent file sets. No agent
sets it today (`new-user` omits it). Revisit if a real need for genuinely
per-agent output shapes shows up; until then, this gap is written down
rather than silently ignored.

## Per-agent specs

_(Filled in per agent as Phase 5 implements each one — not written in bulk
ahead of time, so each spec reflects a real, tested prompt rather than a
guess.)_

### Experience Lab
- **New User** — ✅ built (`agents/experience/new-user.ts`), small and cheap
  (LOW_COST tier, 800-token budget) — built to validate the pipeline, not
  as a finished, tuned prompt. Simulates a first-time user, flags obvious
  friction in their very first session.
- Clinic / Office User — TBD
- Impatient User — TBD
- Confused User — TBD
- Mobile User — TBD
- Returning User — TBD

### QA Lab
- QA Investigator — TBD
- Visual QA — TBD

### Design Lab
- UX Architect — TBD
- UI Designer — TBD
- Visual Designer — TBD
- Grid & Layout Designer — TBD
- Content Designer — TBD
- Responsive Designer — TBD
- Accessibility Designer — TBD
- Design System Architect — TBD
- Art Director — TBD
- Page / Frame Creator — TBD

### Product Strategy
- Product Strategist — TBD
- CEO / Head of Product — TBD
