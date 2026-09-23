import { z } from "zod";
import { agentOutputBaseSchema, agentOutputSchema, type AgentOutput } from "@/domain/agent-output";

/**
 * The shape every agent DEFINITION FILE must have. This is the library's
 * core contract — the Registry validates every file against it, and the
 * Runtime executes whatever comes back.
 *
 * Behavior (role, objective, responsibilities, constraints, systemPrompt)
 * lives entirely in the file. tokenBudget/modelTier/enabled are also
 * declared here as the agent author's *defaults* — the Agent table in
 * Postgres holds the actual operational values, seeded from these
 * defaults the first time the agent is discovered, and can diverge from
 * them afterward without touching this file. See docs/DECISIONS.md.
 */

// Re-exported, not redefined — these already exist and are the single
// source of truth for the categories/tiers used across the whole app
// (Prisma's AgentType/ModelTier enums mirror these exact string values).
export const AGENT_CATEGORIES = ["EXPERIENCE", "QA", "DESIGN", "STRATEGY", "ORCHESTRATION"] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const MODEL_TIERS = ["LOW_COST", "BALANCED", "HIGH_REASONING"] as const;
export type AgentModelTier = (typeof MODEL_TIERS)[number];

export const agentDefinitionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case, e.g. 'new-user'"),
  name: z.string().trim().min(1).max(80),
  category: z.enum(AGENT_CATEGORIES),
  role: z.string().trim().min(1).describe("Who this agent is pretending to be / acting as."),
  objective: z.string().trim().min(1).describe("What this agent is trying to accomplish."),
  responsibilities: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).min(1),
  whenNotToCall: z
    .string()
    .trim()
    .min(1)
    .describe("Required, not decorative — the future Smart Router reads this."),
  systemPrompt: z.string().trim().min(1),
  // Optional: nearly every agent should just use the shared output contract
  // (agentOutputBaseSchema). Only set this if an agent genuinely needs a
  // different shape — see docs/AGENT_SPECIFICATION.md's "known gap" note.
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  tokenBudget: z.number().int().positive(),
  modelTier: z.enum(MODEL_TIERS),
  enabled: z.boolean(),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

// Re-exported so agent-authoring code only needs one import path
// (`@agents/system/agent-protocol`) for both the definition shape and the
// output contract every agent's response is validated against.
export { agentOutputBaseSchema, agentOutputSchema, type AgentOutput };
