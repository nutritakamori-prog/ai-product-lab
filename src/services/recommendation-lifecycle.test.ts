import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { createImplementation, updateImplementationStatus } from "./implementations";
import { createValidation } from "./validations";
import { getRecommendationLifecycle } from "./recommendation-lifecycle";
import type { ConsolidatedFinding, FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

const TARGET_URL = "http://localhost:3000/qg";

function report(findings: ConsolidatedFinding[]): FinalEvaluationReport {
  return {
    missionId: "placeholder",
    mission: { target: { url: TARGET_URL }, objective: "test", task: "test" },
    findings,
    coverage: [],
  };
}

function finding(text: string): ConsolidatedFinding {
  return {
    status: "FINDING",
    finding: text,
    duplicated: false,
    sources: [{ agentId: "qa-agent", evidence: `evidence for ${text}`, impact: "MEDIUM", recommendation: "fix it", confidence: "HIGH", classification: "BUG" }],
  };
}

describe("getRecommendationLifecycle (integration)", () => {
  const projectIds: string[] = [];
  const missionRunIds: string[] = [];

  afterAll(async () => {
    if (missionRunIds.length) await db.evaluationMissionRun.deleteMany({ where: { id: { in: missionRunIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  async function makeProject(name: string) {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({ data: { organizationId: organization.id, name: `${name} ${Date.now()}-${Math.random()}` } });
    projectIds.push(project.id);
    return project;
  }

  async function makeMissionRun(projectId: string, findings: ConsolidatedFinding[], createdAt: Date) {
    const missionRun = await db.evaluationMissionRun.create({
      data: {
        projectId,
        status: "COMPLETED",
        input: { target: { url: TARGET_URL }, objective: "test", task: "test", requestedAgents: ["qa-agent"] } as unknown as Prisma.InputJsonValue,
        report: report(findings) as unknown as Prisma.InputJsonValue,
        createdAt,
      },
    });
    missionRunIds.push(missionRun.id);
    return missionRun;
  }

  it("returns null for a Recommendation that doesn't exist", async () => {
    expect(await getRecommendationLifecycle("does-not-exist")).toBeNull();
  });

  // Case 10 / 11 — identifiable with no Implementation and no Validation
  it("shows a Recommendation with no Implementation as null, and includes the original finding and target", async () => {
    const project = await makeProject("lifecycle no-implementation");
    const missionRun = await makeMissionRun(project.id, [finding("Login quebrado")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: { missionRunId: missionRun.id, findingIndex: 0, title: "t", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });

    const lifecycle = await getRecommendationLifecycle(recommendation.id);
    expect(lifecycle?.target.url).toBe(TARGET_URL);
    expect(lifecycle?.finding).toBe("Login quebrado");
    expect(lifecycle?.implementation).toBeNull();
    expect(lifecycle?.validations).toEqual([]);
  });

  // Case 12 / 13 — target context via the real getFindingHistory, never recomputed
  it("relates the Validation's context to the target's real Finding History via the existing getFindingHistory service", async () => {
    const project = await makeProject("lifecycle finding-history");
    const firstRun = await makeMissionRun(project.id, [finding("Botão quebrado")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: { missionRunId: firstRun.id, findingIndex: 0, title: "t", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });

    const implementation = await createImplementation(recommendation.id);
    await updateImplementationStatus(implementation.id, "COMPLETED");

    // The real retest: a later Mission run of the SAME target where the finding no longer appears.
    const retestRun = await makeMissionRun(project.id, [], new Date("2026-01-02"));
    await createValidation({ implementationId: implementation.id, status: "PASSED", retestMissionRunId: retestRun.id });

    const lifecycle = await getRecommendationLifecycle(recommendation.id);
    expect(lifecycle?.implementation?.status).toBe("COMPLETED");
    expect(lifecycle?.validations).toHaveLength(1);
    expect(lifecycle?.validations[0]?.retestMissionRunId).toBe(retestRun.id);

    // findingHistory is the SAME data getFindingHistory() produces directly —
    // both runs are in it, and the finding's own timeline shows the real
    // NOT_REPRODUCED transition the retest actually demonstrated.
    expect(lifecycle?.findingHistory?.runIds).toEqual([firstRun.id, retestRun.id]);
    const timeline = lifecycle?.findingHistory?.timelines.find((t) => t.finding === "Botão quebrado");
    expect(timeline?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED"]);
  });

  // Case 9 — isolation: a lifecycle never reaches into another project's history
  it("never includes another project's mission runs in the target Finding History", async () => {
    const projectA = await makeProject("lifecycle isolation A");
    const projectB = await makeProject("lifecycle isolation B");

    const runA = await makeMissionRun(projectA.id, [finding("A")], new Date("2026-01-01"));
    const recommendationA = await db.recommendation.create({
      data: { missionRunId: runA.id, findingIndex: 0, title: "t", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });
    // Same target URL, different project — must never be mixed into A's history.
    await makeMissionRun(projectB.id, [finding("A")], new Date("2026-01-02"));

    const lifecycle = await getRecommendationLifecycle(recommendationA.id);
    expect(lifecycle?.findingHistory?.runIds).toEqual([runA.id]);
  });
});
