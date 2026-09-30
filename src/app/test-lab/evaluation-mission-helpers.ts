import type { ModelProviderKind } from "@/generated/prisma/client";
import type { AgentEvaluationOutcome } from "@/services/evaluation-orchestrator";
import { runEvaluationMissionAction, type RunEvaluationMissionActionState } from "./actions";

/**
 * Pure, framework-free helpers for the Evaluation Mission form
 * (evaluation-mission-form.tsx) — kept separate from the component itself
 * so they can be unit-tested directly under this project's existing Vitest
 * setup (Node environment, no jsdom/@testing-library/react installed — see
 * this file's own test for why component rendering itself isn't tested
 * here).
 */

export interface MissionFormInput {
  target: { url: string; name?: string };
  objective: string;
  task: string;
  requestedAgents: string[];
}

/**
 * Builds the raw Mission object runEvaluationMissionAction already expects
 * (validated there via evaluationMissionInputSchema — never re-validated or
 * re-shaped here), straight from the form's own FormData. The form only
 * asks for what this step's spec requires (Target URL, Objective, Task,
 * Agents solicitados) — there's no `id` field: the persisted
 * EvaluationMissionRun's own row id becomes the Mission's id (see
 * createAndRunMissionEvaluation). `target.name` is genuinely optional
 * (omitted, not an empty string, when the field is left blank).
 */
export function buildMissionInputFromFormData(formData: FormData): MissionFormInput {
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  const targetName = String(formData.get("targetName") ?? "").trim();
  const objective = String(formData.get("objective") ?? "").trim();
  const task = String(formData.get("task") ?? "").trim();
  const requestedAgents = formData.getAll("requestedAgents").map(String);

  return {
    target: targetName ? { url: targetUrl, name: targetName } : { url: targetUrl },
    objective,
    task,
    requestedAgents,
  };
}

/**
 * True only when at least one requested agent's own outcome is something
 * other than a plain, conclusive SUCCESS — i.e. FAILED, BLOCKED, or a
 * SUCCESS whose own AgentOutput.status is UNCONFIRMED. Used only to decide
 * whether the "no findings confirmed" message needs its second, qualifying
 * sentence (see this step's own spec) — never to invent a finding, and
 * never true just because every agent cleanly reported NO_FINDING.
 */
export function hasInconclusiveOrUnexecutedAgents(coverage: AgentEvaluationOutcome[]): boolean {
  return coverage.some((entry) => {
    if (entry.status !== "SUCCESS") return true; // FAILED or BLOCKED
    return entry.output?.status === "UNCONFIRMED";
  });
}

/**
 * True only when at least one agent was requested AND none of them reached
 * a real SUCCESS — e.g. every requested agent was BLOCKED (the Planner
 * couldn't build a Plan) or FAILED. Distinct from
 * hasInconclusiveOrUnexecutedAgents: that one is true for a MIX of some
 * real results plus some issues (where "no confirmed problems" is still an
 * honest headline, just with a caveat); this one is true only when the
 * mission produced no real evaluation at all, so the report must never
 * lead with "no confirmed problems" — that reads as a completed, clean
 * evaluation when none actually happened. False for an empty coverage list
 * on purpose (same reasoning as hasInconclusiveOrUnexecutedAgents([]) —
 * that state is caught earlier, before a report is ever built; see
 * runEvaluationMissionAction's own zero-agents guard).
 */
export function allAgentsUnevaluated(coverage: AgentEvaluationOutcome[]): boolean {
  return coverage.length > 0 && coverage.every((entry) => entry.status !== "SUCCESS");
}

/**
 * A Run is safely rerunnable through the UI only when its persisted
 * `provider` is a real, known, non-CLAUDE_CODE kind. `null` (a legacy Run
 * created before this field existed, or any other unknown state) and
 * "CLAUDE_CODE" (this project's own manual, script-driven executor —
 * getModelProvider() never selects it automatically) are both treated the
 * same conservative way: the system must never present a rerun with a
 * different executor as though it reproduced the original one.
 */
export function canRerunMissionRun(provider: ModelProviderKind | null): boolean {
  return provider != null && provider !== "CLAUDE_CODE";
}

/**
 * The real entry point stays runEvaluationMissionAction (./actions.ts) —
 * this wrapper only adapts the Evaluation Mission form's FormData into the
 * plain object it already expects (via buildMissionInputFromFormData above),
 * so useActionState (evaluation-mission-form.tsx) can drive it the same way
 * RunTaskForm already drives runLabTaskAction. Kept in this plain .ts file
 * (not the .tsx component) so it can be unit-tested directly, without
 * pulling JSX/React rendering into this project's Node-environment Vitest
 * setup (see this file's own test for the coverage this buys).
 */
export async function submitEvaluationMission(
  _prevState: RunEvaluationMissionActionState,
  formData: FormData,
): Promise<RunEvaluationMissionActionState> {
  const missionInput = buildMissionInputFromFormData(formData);
  const projectId = String(formData.get("projectId") ?? "").trim();
  return runEvaluationMissionAction(missionInput, projectId);
}
