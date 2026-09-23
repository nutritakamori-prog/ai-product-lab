import { z } from "zod";

/**
 * The shape every TestScenario file must have. Mirrors the agent library's
 * pattern (agents/system/agent-protocol.ts): one Zod schema, one file per
 * scenario, a static index the runner reads — see
 * src/core/testing/scenarios/README.md for why scenarios are files, not
 * database rows, at this stage.
 */

export const SCENARIO_CATEGORIES = [
  "onboarding",
  "navigation",
  "project-management",
  "agents",
  "settings",
  "usability",
  "accessibility",
  "responsive",
  "visual",
  "functional",
] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

export const SCENARIO_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ScenarioPriority = (typeof SCENARIO_PRIORITIES)[number];

export const testScenarioSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case, e.g. 'new-user-creates-first-project'"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1),
  objective: z.string().trim().min(1).describe("What this scenario is trying to verify."),
  preconditions: z.array(z.string().trim().min(1)).min(1),
  steps: z.array(z.string().trim().min(1)).min(1),
  expectedOutcome: z.string().trim().min(1),
  priority: z.enum(SCENARIO_PRIORITIES),
  category: z.enum(SCENARIO_CATEGORIES),
  // The agent slug this scenario is written for — a static, author-declared
  // association (like an AgentDefinition's own `category`), not a runtime
  // decision. This is what lets a round run every enabled scenario without
  // a human picking the agent each time, without needing a Smart Router.
  agent: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "agent must be a lowercase kebab-case agent slug, e.g. 'new-user'"),
  enabled: z.boolean(),
});

export type TestScenario = z.infer<typeof testScenarioSchema>;
