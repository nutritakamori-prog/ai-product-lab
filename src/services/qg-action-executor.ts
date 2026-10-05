import { isQgActionId, type QgActionId } from "@/core/qg-command-router/qg-command-router";
import { setRecommendationStatus, getRecommendationAgents } from "@/services/recommendations";
import { createImplementation, updateImplementationStatus } from "@/services/implementations";
import { createValidation } from "@/services/validations";
import { createAndRunMissionEvaluation } from "@/services/evaluation-orchestrator";
import { DEFAULT_MISSION_TASK } from "@/services/operational-brain";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { ValidationStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * FASE 12 — QG Actions. The ONLY file in the QG Runtime that changes
 * state. Every function here is a thin, direct call to an already-existing,
 * already-tested service (setRecommendationStatus, createImplementation,
 * createValidation — 10B.3) — no business rule is duplicated, and no new
 * check is invented here: an invalid transition (e.g. CREATE_IMPLEMENTATION
 * for a PENDING Recommendation) is rejected by the underlying service
 * itself, exactly as it already was before this phase.
 *
 * This is called exactly once, by confirmQgActionAction (src/app/qg/qg-
 * command-actions.ts), and only after the UI has shown the user exactly
 * what will change and the user has explicitly clicked Confirmar — never
 * from the read-only command dispatch in qg-command-router.ts, and never
 * automatically.
 */

export interface QgActionOutcome {
  action: QgActionId;
  message: string;
}

/**
 * `action` arrives as a plain string from a Server Action, callable
 * directly over the network outside TypeScript's own type checking — this
 * is the runtime allow-list check that guarantees only one of the four
 * known actions can ever reach a state-changing call, never an arbitrary
 * string.
 */
export async function executeQgAction(action: string, targetId: string): Promise<QgActionOutcome> {
  if (!isQgActionId(action)) {
    throw new Error("Ação desconhecida — nada foi alterado.");
  }

  switch (action) {
    case "APPROVE_RECOMMENDATION": {
      const recommendation = await setRecommendationStatus(targetId, "APPROVED");
      return { action, message: `Recommendation "${recommendation.title}" aprovada.` };
    }
    case "IGNORE_RECOMMENDATION": {
      const recommendation = await setRecommendationStatus(targetId, "IGNORED");
      return { action, message: `Recommendation "${recommendation.title}" ignorada.` };
    }
    case "CREATE_IMPLEMENTATION": {
      const implementation = await createImplementation(targetId);
      return { action, message: `Implementation criada (status ${implementation.status}).` };
    }
    case "CREATE_VALIDATION": {
      // No retest reference — executing a new Evaluation Mission is explicitly
      // out of scope for this phase (FASE 12 §12). PENDING is the service's
      // own real default for a Validation with no evidence attached yet,
      // never a fabricated PASSED/FAILED verdict. RUN_RETEST below (FASE 18)
      // is the real, retest-backed path this one never became.
      const validation = await createValidation({ implementationId: targetId, status: "PENDING" });
      return { action, message: `Validation criada (status ${validation.status}).` };
    }
    case "COMPLETE_IMPLEMENTATION": {
      // FASE 18 — the real gap FASE 17 found: updateImplementationStatus()
      // already existed (FASE 10B.3) and is already tested; it was simply
      // never reachable from the QG/Brain layer. The code change itself
      // still happens outside this call (a human — or Claude Code acting as
      // one — actually does the work); this only records that it did.
      await updateImplementationStatus(targetId, "COMPLETED");
      return { action, message: `Implementation marcada como COMPLETED.` };
    }
    case "RUN_RETEST": {
      // FASE 18 — the other real gap FASE 17 found: closes it for real,
      // never fabricated. targetId is an Implementation id. Resolves the
      // exact same target/agents the original finding came from (never a
      // new/different target), runs a genuinely new EvaluationMissionRun
      // through the exact same createAndRunMissionEvaluation() every other
      // real mission in this product already goes through, then records a
      // Validation whose verdict is read off that run's own real coverage —
      // never assumed, and never created at all if the retest mission
      // itself failed to produce evidence (e.g. a 429 from the configured
      // provider) — the honest thing in that case is to report the failure,
      // not to invent a verdict.
      const implementation = await db.implementation.findUnique({
        where: { id: targetId },
        include: { recommendation: { include: { missionRun: true } } },
      });
      if (!implementation) {
        throw new Error(`Implementation "${targetId}" não existe.`);
      }
      if (implementation.status !== "COMPLETED") {
        throw new Error(`Implementation "${targetId}" ainda não está COMPLETED — não há o que retestar.`);
      }
      const recommendation = implementation.recommendation;
      const missionRun = recommendation.missionRun;
      const input = missionRun.input as unknown as EvaluationMissionInput;
      const requestedAgents = getRecommendationAgents({ findingIndex: recommendation.findingIndex, missionRun: { report: missionRun.report } });
      if (requestedAgents.length === 0) {
        throw new Error("Não foi possível identificar quais agentes originaram este finding — reteste não iniciado.");
      }

      const retestRun = await createAndRunMissionEvaluation(
        {
          target: input.target,
          objective: `Reteste real da Recommendation "${recommendation.title}" após a Implementation.`,
          task: DEFAULT_MISSION_TASK,
          requestedAgents,
        },
        { id: missionRun.projectId },
      );

      if (retestRun.status === "FAILED" || !retestRun.report) {
        return {
          action,
          message: `O reteste não pôde ser concluído: ${retestRun.error ?? "o provider de modelo configurado não respondeu"}. Nenhuma Validation foi criada — isso não é uma falha do roteamento.`,
        };
      }

      const report: FinalEvaluationReport = retestRun.report;
      const retestOutcomes = report.coverage.filter((c) => requestedAgents.includes(c.agentId));
      const anyStillFinding = retestOutcomes.some((c) => c.output?.status === "FINDING");
      const allNoFinding = retestOutcomes.length > 0 && retestOutcomes.every((c) => c.output?.status === "NO_FINDING");
      const verdict: ValidationStatus = anyStillFinding ? "FAILED" : allNoFinding ? "PASSED" : "INCONCLUSIVE";

      const validation = await createValidation({
        implementationId: targetId,
        status: verdict,
        retestMissionRunId: retestRun.id,
        notes: `Reteste real (missionRunId=${retestRun.id}) com os mesmos agentes que originaram o finding: ${requestedAgents.join(", ")}.`,
      });

      return { action, message: `Reteste concluído — Validation ${validation.status} (missionRunId=${retestRun.id}).` };
    }
  }
}
