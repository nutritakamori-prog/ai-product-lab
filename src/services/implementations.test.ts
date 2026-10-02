import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { createImplementation, getImplementation, getImplementationForRecommendation, updateImplementationStatus } from "./implementations";

describe("implementations (integration)", () => {
  const projectIds: string[] = [];
  const missionRunIds: string[] = [];

  afterAll(async () => {
    if (missionRunIds.length) await db.evaluationMissionRun.deleteMany({ where: { id: { in: missionRunIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  async function makeRecommendation(status: "PENDING" | "APPROVED" | "IGNORED") {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({
      data: { organizationId: organization.id, name: `implementations test ${status} ${Date.now()}-${Math.random()}` },
    });
    projectIds.push(project.id);

    const missionRun = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test", requestedAgents: ["qa-agent"] },
      },
    });
    missionRunIds.push(missionRun.id);

    const recommendation = await db.recommendation.create({
      data: {
        missionRunId: missionRun.id,
        findingIndex: 0,
        title: "Finding",
        summary: "Summary",
        whyItMatters: "Because",
        recommendedAction: "Do something",
        status,
      },
    });
    return recommendation;
  }

  // Case 1
  it("lets an APPROVED Recommendation start an Implementation", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    const implementation = await createImplementation(recommendation.id);
    expect(implementation.recommendationId).toBe(recommendation.id);
    expect(implementation.status).toBe("PENDING");
    expect(implementation.completedAt).toBeNull();
  });

  // Case 2
  it("rejects starting an Implementation for a PENDING Recommendation", async () => {
    const recommendation = await makeRecommendation("PENDING");
    await expect(createImplementation(recommendation.id)).rejects.toThrow(/PENDING, not APPROVED/);
  });

  // Case 3
  it("rejects starting an Implementation for an IGNORED Recommendation", async () => {
    const recommendation = await makeRecommendation("IGNORED");
    await expect(createImplementation(recommendation.id)).rejects.toThrow(/IGNORED, not APPROVED/);
  });

  // Case 4
  it("keeps the Implementation correctly linked to its Recommendation", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    const created = await createImplementation(recommendation.id, "Fixed the thing");

    const byId = await getImplementation(created.id);
    const byRecommendation = await getImplementationForRecommendation(recommendation.id);

    expect(byId?.recommendationId).toBe(recommendation.id);
    expect(byRecommendation?.id).toBe(created.id);
    expect(byRecommendation?.summary).toBe("Fixed the thing");
  });

  // Case 5
  it("marks an Implementation as COMPLETED, setting completedAt exactly once", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    const created = await createImplementation(recommendation.id);

    const inProgress = await updateImplementationStatus(created.id, "IN_PROGRESS");
    expect(inProgress.status).toBe("IN_PROGRESS");
    expect(inProgress.completedAt).toBeNull();

    const completed = await updateImplementationStatus(created.id, "COMPLETED", "Shipped the fix");
    expect(completed.status).toBe("COMPLETED");
    expect(completed.summary).toBe("Shipped the fix");
    expect(completed.completedAt).not.toBeNull();

    // Moving back to IN_PROGRESS never erases when it was first completed.
    const firstCompletedAt = completed.completedAt;
    const backToProgress = await updateImplementationStatus(created.id, "IN_PROGRESS");
    expect(backToProgress.completedAt).toEqual(firstCompletedAt);
  });

  // Case 10
  it("keeps a Recommendation with no Implementation identifiable as such, not an error", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    expect(await getImplementationForRecommendation(recommendation.id)).toBeNull();
  });

  // Case 14 — no Recommendation/Implementation duplication
  it("never allows a second Implementation for the same Recommendation", async () => {
    const recommendation = await makeRecommendation("APPROVED");
    await createImplementation(recommendation.id);
    await expect(createImplementation(recommendation.id)).rejects.toThrow(/already has an Implementation/);
  });

  it("rejects creating an Implementation for a Recommendation that doesn't exist", async () => {
    await expect(createImplementation("does-not-exist")).rejects.toThrow(/does not exist/);
  });
});
