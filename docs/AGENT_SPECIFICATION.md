# Agent Specification

This file will hold the concrete spec for each of the 20 agents once Phase 5
implements them. For now, it fixes the **shape** every agent config must have,
so the first agent built in Phase 5 already sets the pattern correctly.

## Agent config shape

```ts
interface AgentDefinition {
  id: string; // stable, code-level id — e.g. "new-user"
  name: string;
  type: "experience" | "qa" | "design" | "strategy";
  description: string;
  responsibility: string; // "what problem do I solve?"
  whenNotToCall: string; // "when should I NOT be called?" — required, not optional
  capabilities: string[];
  systemPrompt: string;
  inputSchema: ZodSchema;
  outputSchema: ZodSchema; // the AGENT/STATUS/FINDING/... contract
  tokenBudget: number;
  priority: "low" | "medium" | "high";
  recommendedModelTier: "low_cost" | "balanced" | "high_reasoning";
  version: string;
  enabled: boolean;
  allowedTools: string[];
  supportedTaskTypes: string[];
}
```

`whenNotToCall` is not decorative — the Smart Router reads it to decide
whether an agent belongs in a given LAP at all.

## Per-agent specs

_(Filled in per agent as Phase 5 implements each one — not written in bulk
ahead of time, so each spec reflects a real, tested prompt rather than a
guess.)_

### Experience Lab
- New User — TBD (Phase 5)
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
