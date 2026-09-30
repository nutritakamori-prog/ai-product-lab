import { z } from "zod";

/**
 * The domain contract for the LAB's next objective: an external, reusable
 * evaluator of systems — not just of itself. An Evaluation Mission is the
 * request that starts that evaluation. It is pure data: no Playwright, no
 * BrowserAdapter, no model provider, no concrete Observations, no
 * AgentExecution. Nothing here executes anything — see docs/DECISIONS.md's
 * same separation between a Test Lab scenario's definition and its actual
 * run (src/core/testing/runner/test-runner.ts) for the same spirit applied
 * one level up.
 *
 * `target` is deliberately never assumed to be the LAB itself — the LAB
 * evaluating its own /projects page today and a mission evaluating some
 * other product's URL tomorrow use the exact same shape.
 */

export const evaluationTargetSchema = z.object({
  url: z.string().trim().min(1, "Target URL is required"),
  name: z.string().trim().min(1).optional(),
});

export type EvaluationTarget = z.infer<typeof evaluationTargetSchema>;

export const evaluationMissionSchema = z.object({
  id: z.string().trim().min(1, "Mission id is required"),
  target: evaluationTargetSchema,
  objective: z.string().trim().min(1, "Objective is required"),
  task: z.string().trim().min(1, "Task is required"),
  // Agent slugs (e.g. "new-user", "qa-agent", "ux-agent") — roles the
  // mission wants involved, not new agents. Which of these actually get
  // called, and how, is entirely a later step's concern.
  requestedAgents: z.array(z.string().trim().min(1, "Agent id cannot be empty")),
});

export type EvaluationMission = z.infer<typeof evaluationMissionSchema>;

/**
 * The same contract minus `id` — for a Mission that doesn't have one yet
 * because it hasn't been persisted (see EvaluationMissionRun in
 * prisma/schema.prisma and createAndRunMissionEvaluation in
 * evaluation-orchestrator.ts, which assigns the persisted row's own id as
 * the Mission's id). Never a second, divergent shape.
 */
export const evaluationMissionInputSchema = evaluationMissionSchema.omit({ id: true });
export type EvaluationMissionInput = z.infer<typeof evaluationMissionInputSchema>;
