import { z } from "zod";

/**
 * The structured contract every agent must return — see
 * docs/AGENT_ARCHITECTURE.md. All fields are required (never omitted) but
 * nullable, because Structured Outputs works best when every key is always
 * present; a plain-optional field is more likely to be dropped by the model.
 *
 * agentOutputBaseSchema (no refine) is what gets turned into a JSON Schema
 * for the model via zodOutputFormat — a Zod refinement doesn't export
 * cleanly to JSON Schema. agentOutputSchema (with refine) is the extra
 * business-rule check the Output Validator runs after the model responds:
 * you cannot report FINDING without evidence, impact, and a recommendation.
 */

// "UNCONFIRMED" added for the Test Lab (src/core/testing): there's a real
// difference between "nothing to report" (NO_FINDING) and "something looked
// off but there wasn't enough evidence to confirm it" (UNCONFIRMED) — see
// src/core/testing/README.md's fundamental rule. Purely additive: existing
// FINDING/NO_FINDING data and callers are unaffected.
export const AGENT_OUTPUT_STATUSES = ["FINDING", "NO_FINDING", "UNCONFIRMED"] as const;
export const IMPACT_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

// "classification" added for the Test Lab's consolidated round report
// (src/core/testing/runner/round-report.ts): what KIND of problem/opportunity
// this is. Deliberately separate from the "FREQUENCY" concept the original
// design deferred to Phase 7 (docs/AGENT_ARCHITECTURE.md) — frequency needs
// comparing multiple executions against each other, which a single run has
// no way to know; classification doesn't, a single run can self-assess it.
export const FINDING_CLASSIFICATIONS = [
  "BUG",
  "UX",
  "UI",
  "NAVIGATION",
  "DATA",
  "PERFORMANCE",
  "ACCESSIBILITY",
  "OPPORTUNITY",
  "FUTURE_RISK",
] as const;
export type FindingClassification = (typeof FINDING_CLASSIFICATIONS)[number];

export const agentOutputBaseSchema = z.object({
  agent: z.string().min(1).describe("The agent's own slug, self-reported for cross-checking."),
  status: z.enum(AGENT_OUTPUT_STATUSES),
  finding: z
    .string()
    .min(1)
    .nullable()
    .describe('Short description of what was found. Required when status is "FINDING", otherwise null.'),
  evidence: z
    .string()
    .min(1)
    .nullable()
    .describe(
      'ACTION/EXPECTED/OBSERVED evidence backing the finding. Required when status is "FINDING". Never state something as fact without this.',
    ),
  impact: z.enum(IMPACT_LEVELS).nullable(),
  recommendation: z.string().min(1).nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  classification: z
    .enum(FINDING_CLASSIFICATIONS)
    .nullable()
    .describe(
      'What kind of problem or opportunity this is (BUG, UX, UI, NAVIGATION, DATA, PERFORMANCE, ACCESSIBILITY, OPPORTUNITY, FUTURE_RISK). Required when status is "FINDING", otherwise null.',
    ),
  needsOtherAgent: z
    .string()
    .nullable()
    .describe("Slug of another agent whose input is needed, or null if none."),
});

export const agentOutputSchema = agentOutputBaseSchema.refine(
  (value) =>
    value.status !== "FINDING" ||
    (value.finding && value.evidence && value.impact && value.recommendation && value.classification),
  {
    message:
      'status "FINDING" requires finding, evidence, impact, recommendation, and classification to all be non-null',
  },
);

export type AgentOutput = z.infer<typeof agentOutputBaseSchema>;
