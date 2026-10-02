import { isQgActionId, type QgActionId } from "@/core/qg-command-router/qg-command-router";
import { setRecommendationStatus } from "@/services/recommendations";
import { createImplementation } from "@/services/implementations";
import { createValidation } from "@/services/validations";

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
      // never a fabricated PASSED/FAILED verdict.
      const validation = await createValidation({ implementationId: targetId, status: "PENDING" });
      return { action, message: `Validation criada (status ${validation.status}).` };
    }
  }
}
