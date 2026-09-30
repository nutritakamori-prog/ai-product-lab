import type { EvaluationMission } from "./evaluation-mission";
import type { Observation } from "@/core/testing/runner/test-runner";

/**
 * "This agent is evaluating this mission, on this system, based on these
 * real observations." The single explicit contract for what an agent
 * receives when its run is part of an EvaluationMission-based evaluation —
 * not a new layer: `mission` is a slice of the already-validated
 * EvaluationMission (evaluation-mission.ts's own Zod schema already
 * validated it; `requestedAgents` is deliberately excluded here — that's a
 * routing concern, not something the agent being evaluated needs to know
 * about), and `observations` is exactly what a real Browser run already
 * produced (test-runner.ts's own Observation type, imported here as a type
 * only — never redeclared). Pure data: no Playwright, no BrowserAdapter, no
 * Prisma, no HTTP, no model provider.
 */
export interface EvaluationAgentInput {
  mission: Pick<EvaluationMission, "id" | "target" | "objective" | "task">;
  observations: Observation[];
}

export function buildEvaluationAgentInput(
  mission: Pick<EvaluationMission, "id" | "target" | "objective" | "task">,
  observations: Observation[],
): EvaluationAgentInput {
  return { mission, observations };
}
