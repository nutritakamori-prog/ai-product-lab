import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { getTeamArchitectReport } from "./team-architect";

describe("getTeamArchitectReport (integration)", () => {
  const projectIds: string[] = [];
  const executionIds: string[] = [];
  const missionRunIds: string[] = [];

  afterAll(async () => {
    if (executionIds.length) await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
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

  it("produces a valid report for a project with no activity at all — no recommendation fabricated from no data", async () => {
    const project = await makeProject("team-architect empty");
    const report = await getTeamArchitectReport(project.id);
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(Array.isArray(report.insufficientEvidence)).toBe(true);
  });

  // Case 19 — project isolation, at the service/data-loading boundary
  it("never mixes AgentExecution activity between two different projects when computing COVERAGE_GAP/DISABLE_AGENT", async () => {
    const [projectA, projectB] = await Promise.all([
      makeProject("team-architect isolation A"),
      makeProject("team-architect isolation B"),
    ]);

    const qaAgent = await db.agent.findFirst({ where: { slug: "qa-agent" } });
    const uxAgent = await db.agent.findFirst({ where: { slug: "ux-agent" } });
    if (!qaAgent || !uxAgent) throw new Error("Seed agents not found — run the agent sync first.");

    // Project A: qa-agent is active, ux-agent is idle — ux-agent should look like a DISABLE_AGENT candidate in A.
    const executionA = await db.agentExecution.create({
      data: {
        projectId: projectA.id,
        agentId: qaAgent.id,
        task: "team-architect isolation task A",
        status: "SUCCESS",
        input: {} as unknown as Prisma.InputJsonValue,
        output: { agent: "qa-agent", status: "NO_FINDING", finding: null, evidence: null, impact: null, recommendation: null, confidence: "MEDIUM", classification: null, needsOtherAgent: null },
      },
    });
    executionIds.push(executionA.id);

    // Project B: nobody has run anything — ux-agent's idleness there must stay INSUFFICIENT_EVIDENCE, never DISABLE_AGENT,
    // and must never be inflated by project A's activity.
    const reportA = await getTeamArchitectReport(projectA.id);
    const reportB = await getTeamArchitectReport(projectB.id);

    const disableInA = reportA.recommendations.find((r) => r.type === "DISABLE_AGENT" && r.affectedAgents.includes("ux-agent"));
    const disableInB = reportB.recommendations.find((r) => r.type === "DISABLE_AGENT" && r.affectedAgents.includes("ux-agent"));

    expect(disableInA).toBeDefined();
    expect(disableInB).toBeUndefined();
    expect(reportB.insufficientEvidence.some((e) => e.area === "DISABLE_AGENT")).toBe(true);
  });

  it("never imports or calls any function that creates, disables, removes, or modifies an Agent, Recommendation, or Implementation", () => {
    const source = readFileSync(new URL("./team-architect.ts", import.meta.url), "utf-8");
    for (const forbidden of ["createImplementation", "createValidation", "setRecommendationStatus", "updateImplementationStatus", "db.agent.create", "db.agent.update", "db.agent.delete"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
