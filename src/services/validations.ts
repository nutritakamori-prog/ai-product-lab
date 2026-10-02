import { db } from "@/lib/db";
import type { Validation, ValidationStatus } from "@/generated/prisma/client";

/**
 * FASE 10B.3 — the persisted half of Recommendation → Implementation →
 * Validation. One row per retest/validation attempt against an existing
 * Implementation — never orphaned, never pointing at a retest source from a
 * different project than the Implementation it validates.
 */

export interface CreateValidationInput {
  implementationId: string;
  status?: ValidationStatus;
  /** A real EvaluationMissionRun id used as this validation's evidence, when there is one — never fabricated. */
  retestMissionRunId?: string | null;
  /** A real TestRun id used as this validation's evidence, when there is one — never fabricated. */
  retestTestRunId?: string | null;
  notes?: string | null;
}

/**
 * Records one retest/validation attempt. Throws a clear domain error rather
 * than letting a raw Prisma FK-violation bubble up when the Implementation
 * doesn't exist — a Validation is never orphaned. When a retest reference is
 * given, it must be a real, existing row belonging to the SAME project as
 * the Implementation's own Recommendation (via recommendation.missionRun.
 * projectId) — cross-project isolation applies here too, not just to reads.
 * At most one retest reference may be given at once: a Validation is
 * evidence of exactly one retest attempt.
 */
export async function createValidation(input: CreateValidationInput): Promise<Validation> {
  if (input.retestMissionRunId && input.retestTestRunId) {
    throw new Error("A Validation can reference at most one retest source — set either retestMissionRunId or retestTestRunId, not both.");
  }

  const implementation = await db.implementation.findUnique({
    where: { id: input.implementationId },
    include: { recommendation: { include: { missionRun: { select: { projectId: true } } } } },
  });
  if (!implementation) {
    throw new Error(`Implementation "${input.implementationId}" does not exist — a Validation must reference an existing Implementation.`);
  }
  const projectId = implementation.recommendation.missionRun.projectId;

  if (input.retestMissionRunId) {
    const retestRun = await db.evaluationMissionRun.findUnique({ where: { id: input.retestMissionRunId }, select: { projectId: true } });
    if (!retestRun) throw new Error(`EvaluationMissionRun "${input.retestMissionRunId}" does not exist.`);
    if (retestRun.projectId !== projectId) {
      throw new Error(`EvaluationMissionRun "${input.retestMissionRunId}" belongs to a different project than this Implementation's Recommendation.`);
    }
  }

  if (input.retestTestRunId) {
    const retestRun = await db.testRun.findUnique({ where: { id: input.retestTestRunId }, select: { projectId: true } });
    if (!retestRun) throw new Error(`TestRun "${input.retestTestRunId}" does not exist.`);
    if (retestRun.projectId !== projectId) {
      throw new Error(`TestRun "${input.retestTestRunId}" belongs to a different project than this Implementation's Recommendation.`);
    }
  }

  return db.validation.create({
    data: {
      implementationId: input.implementationId,
      status: input.status ?? "PENDING",
      retestMissionRunId: input.retestMissionRunId ?? null,
      retestTestRunId: input.retestTestRunId ?? null,
      notes: input.notes ?? null,
    },
  });
}

export function getValidation(id: string) {
  return db.validation.findUnique({ where: { id } });
}

/** Chronological — an Implementation can be retested more than once, and every attempt is kept, never collapsed to the latest. */
export function listValidationsForImplementation(implementationId: string) {
  return db.validation.findMany({ where: { implementationId }, orderBy: { createdAt: "asc" } });
}
