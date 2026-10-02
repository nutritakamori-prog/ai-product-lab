import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { getAgentIntelligence } from "./agent-intelligence";

// Real integration test against the local dev Postgres — proving
// getAgentIntelligence actually reflects real AgentExecution/
// EvaluationMissionRun rows, and never mixes data across projects (FASE
// 10B.1 §5/§8, case 8).
describe("getAgentIntelligence (integration)", () => {
  const projectIds: string[] = [];
  const executionIds: string[] = [];
  const missionRunIds: string[] = [];

  afterAll(async () => {
    if (missionRunIds.length) await db.evaluationMissionRun.deleteMany({ where: { id: { in: missionRunIds } } });
    if (executionIds.length) await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  it("includes every known agent, even ones with zero history, for a fresh project", async () => {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({
      data: { organizationId: organization.id, name: `agent-intelligence empty test ${Date.now()}` },
    });
    projectIds.push(project.id);

    const summaries = await getAgentIntelligence(project.id);
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      expect(summary.executionCount).toBe(0);
      expect(summary.missionParticipationCount).toBe(0);
      expect(summary.findingCount).toBe(0);
    }
  });

  it("never mixes AgentExecution or Mission data between two different projects", async () => {
    const organization = await getDefaultOrganization();
    const [projectA, projectB] = await Promise.all([
      db.project.create({ data: { organizationId: organization.id, name: `agent-intelligence isolation A ${Date.now()}` } }),
      db.project.create({ data: { organizationId: organization.id, name: `agent-intelligence isolation B ${Date.now()}` } }),
    ]);
    projectIds.push(projectA.id, projectB.id);

    const agent = await db.agent.findFirst({ where: { slug: "qa-agent" } });
    if (!agent) throw new Error('Seed agent "qa-agent" not found — run the agent sync first.');

    const executionA = await db.agentExecution.create({
      data: {
        projectId: projectA.id,
        agentId: agent.id,
        task: "agent-intelligence isolation test task A",
        status: "SUCCESS",
        input: {},
        output: { agent: "qa-agent", status: "NO_FINDING", finding: null, evidence: null, impact: null, recommendation: null, confidence: "MEDIUM", classification: null, needsOtherAgent: null },
      },
    });
    executionIds.push(executionA.id);

    const missionRunB = await db.evaluationMissionRun.create({
      data: {
        projectId: projectB.id,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test", requestedAgents: ["qa-agent"] },
        report: {
          missionId: "placeholder",
          mission: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test" },
          findings: [],
          coverage: [{ agentId: "qa-agent", status: "SUCCESS", output: null, error: null }],
        },
      },
    });
    missionRunIds.push(missionRunB.id);

    const [summariesA, summariesB] = await Promise.all([
      getAgentIntelligence(projectA.id),
      getAgentIntelligence(projectB.id),
    ]);

    const qaInA = summariesA.find((s) => s.slug === "qa-agent")!;
    const qaInB = summariesB.find((s) => s.slug === "qa-agent")!;

    expect(qaInA.executionCount).toBe(1);
    expect(qaInA.missionParticipationCount).toBe(0);

    expect(qaInB.executionCount).toBe(0);
    expect(qaInB.missionParticipationCount).toBe(1);
  });
});
