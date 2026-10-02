import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { executeQgAction } from "./qg-action-executor";

/**
 * FASE 12 — QG Actions. Integration coverage for the ONLY file that
 * changes state in the QG Runtime. Every service it calls
 * (setRecommendationStatus, createImplementation, createValidation) is
 * already exhaustively tested by its own suite (10B.3) — this file only
 * proves the executor's own thin dispatch, runtime allow-list, and error
 * handling, never re-testing the underlying business rules themselves.
 */
describe("executeQgAction (integration)", () => {
  const projectIds: string[] = [];
  const missionRunIds: string[] = [];

  afterAll(async () => {
    if (missionRunIds.length) await db.evaluationMissionRun.deleteMany({ where: { id: { in: missionRunIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  async function makeRecommendation(status: "PENDING" | "APPROVED") {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({ data: { organizationId: organization.id, name: `qg-action-executor ${status} ${Date.now()}-${Math.random()}` } });
    projectIds.push(project.id);

    const missionRun = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg-action-test" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
      },
    });
    missionRunIds.push(missionRun.id);

    return db.recommendation.create({
      data: { missionRunId: missionRun.id, findingIndex: 0, title: "Test recommendation", summary: "s", whyItMatters: "w", recommendedAction: "a", status },
    });
  }

  // "confirmação aprova"
  it("APPROVE_RECOMMENDATION moves a real PENDING Recommendation to APPROVED", async () => {
    const recommendation = await makeRecommendation("PENDING");
    const outcome = await executeQgAction("APPROVE_RECOMMENDATION", recommendation.id);
    expect(outcome.message).toContain("aprovada");

    const updated = await db.recommendation.findUniqueOrThrow({ where: { id: recommendation.id } });
    expect(updated.status).toBe("APPROVED");
  });

  it("IGNORE_RECOMMENDATION moves a real PENDING Recommendation to IGNORED", async () => {
    const recommendation = await makeRecommendation("PENDING");
    const outcome = await executeQgAction("IGNORE_RECOMMENDATION", recommendation.id);
    expect(outcome.message).toContain("ignorada");

    const updated = await db.recommendation.findUniqueOrThrow({ where: { id: recommendation.id } });
    expect(updated.status).toBe("IGNORED");
  });

  // "Recommendation APPROVED permite Implementation"
  it("CREATE_IMPLEMENTATION succeeds for a real APPROVED Recommendation", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    const outcome = await executeQgAction("CREATE_IMPLEMENTATION", recommendation.id);
    expect(outcome.message).toContain("Implementation criada");

    const implementation = await db.implementation.findUnique({ where: { recommendationId: recommendation.id } });
    expect(implementation).not.toBeNull();
    expect(implementation?.status).toBe("PENDING");
  });

  // "Recommendation PENDING não permite Implementation"
  it("CREATE_IMPLEMENTATION rejects a real PENDING Recommendation with a clean, non-technical error", async () => {
    const recommendation = await makeRecommendation("PENDING");
    await expect(executeQgAction("CREATE_IMPLEMENTATION", recommendation.id)).rejects.toThrow(/PENDING, not APPROVED/);

    const implementation = await db.implementation.findUnique({ where: { recommendationId: recommendation.id } });
    expect(implementation).toBeNull();
  });

  // "duplicação é bloqueada"
  it("never creates a second Implementation for the same Recommendation — the second CREATE_IMPLEMENTATION call fails cleanly", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    await executeQgAction("CREATE_IMPLEMENTATION", recommendation.id);
    await expect(executeQgAction("CREATE_IMPLEMENTATION", recommendation.id)).rejects.toThrow(/already has an Implementation/);

    const implementations = await db.implementation.findMany({ where: { recommendationId: recommendation.id } });
    expect(implementations).toHaveLength(1);
  });

  // "Implementation válida permite Validation"
  it("CREATE_VALIDATION succeeds for a real existing Implementation, with no fabricated verdict", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    await executeQgAction("CREATE_IMPLEMENTATION", recommendation.id);
    const implementation = await db.implementation.findUniqueOrThrow({ where: { recommendationId: recommendation.id } });

    const outcome = await executeQgAction("CREATE_VALIDATION", implementation.id);
    expect(outcome.message).toContain("Validation criada");

    const validations = await db.validation.findMany({ where: { implementationId: implementation.id } });
    expect(validations).toHaveLength(1);
    expect(validations[0].status).toBe("PENDING");
    expect(validations[0].retestMissionRunId).toBeNull();
  });

  it("CREATE_VALIDATION rejects an Implementation id that doesn't exist, with a clean error", async () => {
    await expect(executeQgAction("CREATE_VALIDATION", "does-not-exist")).rejects.toThrow(/does not exist/);
  });

  // "erros são tratados" + the runtime allow-list (a Server Action is callable with any string)
  it("rejects an action id outside the known allow-list, even though nothing in TypeScript stops it being called this way", async () => {
    await expect(executeQgAction("DELETE_EVERYTHING", "some-id")).rejects.toThrow(/Ação desconhecida/);
  });
});
