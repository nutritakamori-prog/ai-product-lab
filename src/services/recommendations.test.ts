import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { listRecommendationsForRun, setRecommendationStatus } from "./recommendations";
import type { Project, EvaluationMissionRun } from "@/generated/prisma/client";

/**
 * Proves the exact relation the Mission page (/test-lab/missions/[id]) and
 * Product Intelligence's approve/ignore actions both rely on: a
 * Recommendation's status lives only on this same row, scoped to its own
 * missionRunId — no second status system, no separate history to go stale.
 */
describe("listRecommendationsForRun (integration)", () => {
  let project: Project;
  let missionRun: EvaluationMissionRun;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Recommendations test project ${Date.now()}` },
    });
    missionRun = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: {
          target: { url: "https://example.com" },
          objective: "test",
          task: "test",
          requestedAgents: ["qa-agent"],
        },
      },
    });
    await db.recommendation.createMany({
      data: [0, 1, 2, 3].map((findingIndex) => ({
        missionRunId: missionRun.id,
        findingIndex,
        title: `Finding ${findingIndex}`,
        summary: `Summary ${findingIndex}`,
        whyItMatters: "Because",
        recommendedAction: "Do something",
      })),
    });
  });

  afterAll(async () => {
    await db.recommendation.deleteMany({ where: { missionRunId: missionRun.id } });
    await db.evaluationMissionRun.delete({ where: { id: missionRun.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("starts with every finding pending, and reflects APPROVED/IGNORED decisions made elsewhere the next time the Mission is read", async () => {
    const initial = await listRecommendationsForRun(missionRun.id);
    expect(initial).toHaveLength(4);
    expect(initial.every((r) => r.status === "PENDING")).toBe(true);
    expect(initial.map((r) => r.findingIndex)).toEqual([0, 1, 2, 3]);

    // Simulates approving one and ignoring another from Product Intelligence.
    await setRecommendationStatus(initial[0].id, "APPROVED");
    await setRecommendationStatus(initial[1].id, "IGNORED");

    const afterDecisions = await listRecommendationsForRun(missionRun.id);
    const byIndex = new Map(afterDecisions.map((r) => [r.findingIndex, r.status]));
    expect(byIndex.get(0)).toBe("APPROVED");
    expect(byIndex.get(1)).toBe("IGNORED");
    expect(afterDecisions.filter((r) => r.status === "PENDING")).toHaveLength(2);
  });
});
