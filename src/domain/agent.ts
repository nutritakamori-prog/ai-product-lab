import { z } from "zod";

/**
 * Mirrors the Agent database model (see prisma/schema.prisma). Kept here as a
 * Zod schema — independent of Prisma's generated types — so both the future
 * agent-authoring UI and any seed/import script validate against the same
 * rules. Every agent must answer "what problem do I solve?" (responsibility)
 * and "when should I NOT be called?" (whenNotToCall) — the Smart Router
 * depends on the latter to avoid running irrelevant agents.
 */

export const AGENT_TYPES = ["EXPERIENCE", "QA", "DESIGN", "STRATEGY"] as const;
export const AGENT_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const MODEL_TIERS = ["LOW_COST", "BALANCED", "HIGH_REASONING"] as const;

export const agentSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase kebab-case, e.g. 'new-user'"),
  name: z.string().trim().min(1).max(80),
  type: z.enum(AGENT_TYPES),
  description: z.string().trim().min(1),
  responsibility: z.string().trim().min(1),
  whenNotToCall: z.string().trim().min(1),
  capabilities: z.array(z.string()).default([]),
  systemPrompt: z.string().trim().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  tokenBudget: z.number().int().positive(),
  priority: z.enum(AGENT_PRIORITIES).default("MEDIUM"),
  recommendedModel: z.enum(MODEL_TIERS).default("BALANCED"),
  version: z.string().trim().min(1).default("0.1.0"),
  enabled: z.boolean().default(false),
  allowedTools: z.array(z.string()).default([]),
  supportedTaskTypes: z.array(z.string()).default([]),
});

export type AgentDefinition = z.infer<typeof agentSchema>;
