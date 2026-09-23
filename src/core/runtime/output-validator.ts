import { agentOutputSchema, type AgentOutput } from "@/domain/agent-output";

export type ValidationResult =
  | { valid: true; data: AgentOutput; error: null }
  | { valid: false; data: null; error: string };

/**
 * The extra business-rule check on top of what Structured Outputs already
 * guarantees shape-wise (see src/core/models/provider.ts): status "FINDING"
 * must carry finding/evidence/impact/recommendation. An invalid result is
 * never treated as a confirmed finding — the Runtime records it as a failed
 * execution and retries instead.
 */
export function validateAgentOutput(raw: unknown): ValidationResult {
  const result = agentOutputSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, data: result.data, error: null };
  }
  const error = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return { valid: false, data: null, error };
}
