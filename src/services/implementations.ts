import { db } from "@/lib/db";
import type { Implementation, ImplementationStatus } from "@/generated/prisma/client";

/**
 * FASE 10B.3 — the persisted half of Recommendation → Implementation →
 * Validation. Tracks only the fact and state of implementation work — never
 * the rich task content, which stays entirely derived (see
 * src/services/implementation-task.ts's ImplementationTask, unchanged and
 * un-duplicated by this file).
 */

/**
 * Creates the Implementation record for an APPROVED Recommendation. Rejects
 * a Recommendation that is PENDING or IGNORED with a clear domain error —
 * never silently treats either as approved. Also rejects a second
 * Implementation for the same Recommendation with a clear error before ever
 * hitting the database's own @unique constraint on recommendationId (the
 * real, last-line-of-defense guarantee against duplicates).
 */
export async function createImplementation(recommendationId: string, summary?: string): Promise<Implementation> {
  const recommendation = await db.recommendation.findUnique({ where: { id: recommendationId } });
  if (!recommendation) {
    throw new Error(`Recommendation "${recommendationId}" does not exist.`);
  }
  if (recommendation.status !== "APPROVED") {
    throw new Error(
      `Recommendation "${recommendationId}" is ${recommendation.status}, not APPROVED — only an APPROVED Recommendation can start an Implementation.`,
    );
  }

  const existing = await db.implementation.findUnique({ where: { recommendationId } });
  if (existing) {
    throw new Error(`Recommendation "${recommendationId}" already has an Implementation ("${existing.id}").`);
  }

  return db.implementation.create({ data: { recommendationId, summary } });
}

export function getImplementation(id: string) {
  return db.implementation.findUnique({ where: { id }, include: { validations: true } });
}

/**
 * FASE 18 — QG 2.0. The real gap FASE 17 found: nothing lets a human mark a
 * real Implementation COMPLETED through the QG/Brain layer — only
 * createImplementation() (always PENDING) was ever exposed there.
 * updateImplementationStatus() already existed and is already tested
 * (FASE 10B.3); this is the one small query the QG needs to list which real
 * Implementations are still waiting for that step, scoped to a project the
 * same way every other QG candidate list already is (via
 * recommendation.missionRun.projectId — no denormalized copy, same
 * precedent as createImplementation's own doc comment).
 */
export function listImplementationsAwaitingCompletion(projectId: string) {
  return db.implementation.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] }, recommendation: { missionRun: { projectId } } },
    include: { recommendation: true },
  });
}

/** The same Recommendation → Implementation relation, looked up from the Recommendation's own side. Null when that Recommendation has no Implementation yet — a valid, expected state (FASE 10B.3 §8, case 10), never an error. */
export function getImplementationForRecommendation(recommendationId: string) {
  return db.implementation.findUnique({ where: { recommendationId }, include: { validations: true } });
}

/**
 * Moves an Implementation to IN_PROGRESS or COMPLETED (PENDING is only ever
 * the creation default, never re-entered here). completedAt is set exactly
 * once, the first time status becomes COMPLETED — a later call (e.g. moving
 * back to IN_PROGRESS for a correction, then COMPLETED again) never resets
 * or overwrites when it was first marked done.
 */
export async function updateImplementationStatus(
  id: string,
  status: Extract<ImplementationStatus, "IN_PROGRESS" | "COMPLETED">,
  summary?: string,
): Promise<Implementation> {
  const existing = await db.implementation.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Implementation "${id}" does not exist.`);
  }

  return db.implementation.update({
    where: { id },
    data: {
      status,
      summary: summary ?? existing.summary,
      completedAt: status === "COMPLETED" ? (existing.completedAt ?? new Date()) : existing.completedAt,
    },
  });
}
