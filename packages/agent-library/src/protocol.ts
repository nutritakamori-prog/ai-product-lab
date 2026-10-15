import { z } from "zod";
import { agentOutputBaseSchema, agentOutputSchema, type AgentOutput } from "./agent-output.js";

/**
 * The shape every agent definition must have. A runtime that wants to
 * execute these agents validates each one against this schema and calls a
 * model with its systemPrompt — this package does not call any model
 * itself (see README.md).
 */

export const AGENT_CATEGORIES = [
  "EXPERIENCE",
  "QA",
  "DESIGN",
  "STRATEGY",
  "ORCHESTRATION",
  "ACCESSIBILITY",
  "PRODUCT",
  "PERFORMANCE",
  "SECURITY",
] as const;
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
    .describe("Required, not decorative — a router/orchestrator reads this."),
  systemPrompt: z.string().trim().min(1),
  // Optional: nearly every agent should just use the shared output contract
  // (agentOutputBaseSchema). Only set this if an agent genuinely needs a
  // different shape.
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  tokenBudget: z.number().int().positive(),
  modelTier: z.enum(MODEL_TIERS),
  enabled: z.boolean(),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export { agentOutputBaseSchema, agentOutputSchema, type AgentOutput };
