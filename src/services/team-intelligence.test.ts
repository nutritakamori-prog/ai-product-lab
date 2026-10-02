import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { getTeamIntelligence } from "./team-intelligence";

describe("getTeamIntelligence (integration)", () => {
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

  it("produces a valid summary for a project with no activity at all", async () => {
    const project = await makeProject("team-intelligence empty");
    const summary = await getTeamIntelligence(project.id);

    // Agents are a global registry (10B.1) — totalAgents reflects every
    // registered agent regardless of project; only their ACTIVITY is
    // project-scoped, which is what this test actually checks.
    expect(summary.activity.totalAgents).toBeGreaterThan(0);
    expect(summary.activity.activeAgents).toBe(0);
    expect(summary.findingPatterns.targets).toEqual([]);
    expect(summary.recommendationLifecycle.totalRecommendations).toBe(0);
  });

  // Case 17 — project isolation
  it("never mixes AgentExecution, findings, or Recommendations between two different projects", async () => {
    const [projectA, projectB] = await Promise.all([
      makeProject("team-intelligence isolation A"),
      makeProject("team-intelligence isolation B"),
    ]);

    const agentRow = await db.agent.findFirst({ where: { slug: "qa-agent" } });
    if (!agentRow) throw new Error('Seed agent "qa-agent" not found — run the agent sync first.');

    await db.agentExecution.create({
      data: {
        projectId: projectA.id,
        agentId: agentRow.id,
        task: "team-intelligence isolation task",
        status: "SUCCESS",
        input: {},
        output: {
          agent: "qa-agent",
          status: "NO_FINDING",
          finding: null,
          evidence: null,
          impact: null,
          recommendation: null,
          confidence: "MEDIUM",
          classification: null,
          needsOtherAgent: null,
        },
      },
    });

    const missionRunB = await db.evaluationMissionRun.create({
      data: {
        projectId: projectB.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test", requestedAgents: ["qa-agent"] } as unknown as Prisma.InputJsonValue,
        report: {
          missionId: "placeholder",
          mission: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test" },
          findings: [
            {
              status: "FINDING",
              finding: "B-only finding",
              duplicated: false,
              sources: [{ agentId: "qa-agent", evidence: "e", impact: "LOW", recommendation: "r", confidence: "MEDIUM", classification: "BUG" }],
            },
          ],
          coverage: [{ agentId: "qa-agent", status: "SUCCESS", output: null, error: null }],
        } as unknown as Prisma.InputJsonValue,
      },
    });
    missionRunIds.push(missionRunB.id);

    await db.recommendation.create({
      data: { missionRunId: missionRunB.id, findingIndex: 0, title: "t", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });

    const [summaryA, summaryB] = await Promise.all([getTeamIntelligence(projectA.id), getTeamIntelligence(projectB.id)]);

    const qaInA = summaryA.coverage.find((c) => c.slug === "qa-agent")!;
    const qaInB = summaryB.coverage.find((c) => c.slug === "qa-agent")!;
    // Project A's execution was never part of a Mission — participation stays false there.
    expect(qaInA.participated).toBe(false);
    // Project B's Mission coverage lists qa-agent as SUCCESS — participation is true there, isolated from A.
    expect(qaInB.participated).toBe(true);

    expect(summaryA.findingPatterns.targets).toEqual([]);
    expect(summaryB.findingPatterns.targets).toHaveLength(1);

    expect(summaryA.recommendationLifecycle.totalRecommendations).toBe(0);
    expect(summaryB.recommendationLifecycle.totalRecommendations).toBe(1);
    expect(summaryB.recommendationLifecycle.byStatus.APPROVED).toBe(1);
  });
});
