"use server";

import { runLabTask, type LabTaskResult } from "@/services/lab-task";
import { evaluationMissionInputSchema, type EvaluationMissionInput } from "@/domain/evaluation-mission";
import { createAndRunMissionEvaluation, getMissionRun } from "@/services/evaluation-orchestrator";

export interface RunLabTaskActionState {
  result: LabTaskResult | null;
  error: string | null;
}

/**
 * The simplest mechanism Next.js/App Router already offers for "call a
 * server function and show its result on the same page" — a Server Action
 * used with useActionState, no API route, no client-side fetch. Just a
 * thin adapter from FormData to runLabTask()'s own signature — the task
 * pipeline itself is entirely runLabTask's (and, through it, the Smart
 * Router's) job.
 */
export async function runLabTaskAction(
  _prevState: RunLabTaskActionState,
  formData: FormData,
): Promise<RunLabTaskActionState> {
  const task = String(formData.get("task") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();

  if (!task) return { result: null, error: "Escreva o que você quer que o LAB teste." };
  if (!projectId) return { result: null, error: "Selecione um projeto." };

  try {
    const result = await runLabTask(task, { id: projectId });
    return { result, error: null };
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface RunEvaluationMissionActionState {
  /** Set on success — the caller navigates to /test-lab/missions/[missionRunId]. Never both this and error. */
  missionRunId: string | null;
  error: string | null;
}

/**
 * The real application entry point for the Evaluation Orchestrator
 * (src/services/evaluation-orchestrator.ts): a Server Action, same
 * mechanism and shape as runLabTaskAction above, but for an
 * EvaluationMission instead of a bare task string. Deliberately calls
 * createAndRunMissionEvaluation() — never runLabTask(), never the Smart
 * Router — so a Mission's own requestedAgents stays authoritative, exactly
 * as the Orchestrator already guarantees. Project resolution reuses the
 * exact same convention runLabTaskAction already uses: a plain
 * `{ id: projectId }`, no new lookup/creation logic invented here.
 *
 * Unlike the previous inline-result version, this never returns the report
 * directly: a real execution (successful, blocked, or failed) always gets a
 * persisted EvaluationMissionRun id, and the caller navigates to that run's
 * own page — the one place its result is shown. `error` here is reserved
 * for input validation only (bad Mission shape, no project, no agent
 * selected), never for an execution-time failure, which is instead recorded
 * on the run itself (status FAILED) so it stays visible after the fact
 * instead of vanishing as a transient form error.
 */
export async function runEvaluationMissionAction(
  missionInput: unknown,
  projectId: string,
): Promise<RunEvaluationMissionActionState> {
  const parsed = evaluationMissionInputSchema.safeParse(missionInput);
  if (!parsed.success) {
    return { missionRunId: null, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) return { missionRunId: null, error: "Selecione um projeto." };

  // With no requested agent, the Orchestrator would still run the real
  // Browser (wasted work — nothing would ever consume its Observations) and
  // return an empty `evaluations`/`coverage`, which the UI would otherwise
  // render as "no problems confirmed" — indistinguishable from a real,
  // evaluated pass. Found during a self-evaluation session: caught here,
  // before any execution, same evidence-first discipline runLabTask() (see
  // lab-task.ts) already applies elsewhere in the LAB.
  if (parsed.data.requestedAgents.length === 0) {
    return { missionRunId: null, error: "Selecione ao menos um agente." };
  }

  const run = await createAndRunMissionEvaluation(parsed.data, { id: trimmedProjectId });
  return { missionRunId: run.id, error: null };
}

/**
 * "Executar novamente" — but guarded server-side, not just in the button's
 * own rendering. Re-derives the guard from the persisted run itself (never
 * trusts a client-supplied provider/input) so a stale page, a re-submitted
 * form, or a client bypassing the disabled button can never trigger a
 * silent rerun with a different executor than the original Run's. A Run is
 * only reproducible when its own persisted `provider` is a known,
 * non-CLAUDE_CODE kind — same rule as canRerunMissionRun in
 * evaluation-mission-helpers.ts (duplicated here, not imported, only to
 * avoid a circular module dependency between this "use server" file and
 * that plain helpers file, which itself imports runEvaluationMissionAction
 * from here).
 */
export async function rerunMissionAction(missionRunId: string): Promise<RunEvaluationMissionActionState> {
  const run = await getMissionRun(missionRunId);
  if (!run) {
    return { missionRunId: null, error: "Run não encontrado." };
  }

  if (run.provider == null || run.provider === "CLAUDE_CODE") {
    return {
      missionRunId: null,
      error: "Este Run foi executado externamente e não pode ser repetido pela UI.",
    };
  }

  const input = run.input as unknown as EvaluationMissionInput;
  const newRun = await createAndRunMissionEvaluation(input, { id: run.projectId });
  return { missionRunId: newRun.id, error: null };
}
