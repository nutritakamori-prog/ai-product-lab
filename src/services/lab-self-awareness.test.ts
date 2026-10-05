import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { analyzeLabSelfAwareness } from "./lab-self-awareness";

describe("analyzeLabSelfAwareness (integration)", () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.$disconnect();
  });

  async function makeProject(name: string) {
    const organization = await getDefaultOrganization();
    const project = await db.project.create({ data: { organizationId: organization.id, name: `${name} ${Date.now()}-${Math.random()}` } });
    projectIds.push(project.id);
    return project;
  }

  it("is honest about a brand-new project: no running mission, no latest mission, no recent failure, team confidence INSUFFICIENT", async () => {
    const project = await makeProject("self-awareness empty");
    const report = await analyzeLabSelfAwareness(project.id);
    expect(report.runningMission).toBeNull();
    expect(report.latestMissionRun).toBeNull();
    expect(report.recentFailureSample).toBeNull();
    expect(report.team.confidence).toBe("INSUFFICIENT");
    expect(report.missions).toEqual({ total: 0, completed: 0, blocked: 0, failed: 0, running: 0 });
  });

  it("counts real missions by their real status, matching the reused TeamIntelligenceReport's own evidence exactly", async () => {
    const project = await makeProject("self-awareness mission counts");
    const [completed, failed] = await Promise.all([
      db.evaluationMissionRun.create({ data: { projectId: project.id, status: "COMPLETED", input: { target: { url: "https://example.com" }, objective: "o", task: "t", requestedAgents: [] } } }),
      db.evaluationMissionRun.create({
        data: { projectId: project.id, status: "FAILED", input: { target: { url: "https://example.com" }, objective: "o", task: "t", requestedAgents: [] }, error: "Gemini API request failed with status 429: {}" },
      }),
    ]);

    const report = await analyzeLabSelfAwareness(project.id);
    expect(report.missions).toEqual({ total: 2, completed: 1, blocked: 0, failed: 1, running: 0 });
    // The real latest run for THIS project — never the global most-recent across all projects.
    expect([completed.id, failed.id]).toContain(report.latestMissionRun?.missionRunId);
    expect(report.recentFailureSample).toContain("Gemini API request failed with status 429");
  });

  it("reports a project's own RUNNING mission with its real per-agent lifecycle, and never another project's", async () => {
    const projectA = await makeProject("self-awareness running A");
    const projectB = await makeProject("self-awareness running B");

    const runningInA = await db.evaluationMissionRun.create({
      data: {
        projectId: projectA.id,
        status: "RUNNING",
        input: { target: { url: "https://example.com" }, objective: "o", task: "t", requestedAgents: ["qa-agent", "ux-agent"] },
        progress: { completedAgentIds: ["qa-agent"], failedAgentIds: [], runningAgentId: "ux-agent" },
      },
    });

    try {
      const reportA = await analyzeLabSelfAwareness(projectA.id);
      expect(reportA.missions.running).toBe(1);
      expect(reportA.runningMission).toMatchObject({ missionRunId: runningInA.id, completedAgentIds: ["qa-agent"], runningAgentId: "ux-agent" });

      const reportB = await analyzeLabSelfAwareness(projectB.id);
      expect(reportB.missions.running).toBe(0);
      expect(reportB.runningMission).toBeNull();
    } finally {
      await db.evaluationMissionRun.update({ where: { id: runningInA.id }, data: { status: "COMPLETED" } });
    }
  });

  it("runs against the LAB's real, pre-existing project data without crashing", async () => {
    const realProject = await db.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!realProject) {
      expect(realProject).toBeNull();
      return;
    }
    const report = await analyzeLabSelfAwareness(realProject.id);
    expect(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"]).toContain(report.team.confidence);
    expect(typeof report.generatedAt).toBe("string");
  });

  it("never imports or calls any function that creates, disables, removes, or modifies an Agent, Recommendation, Implementation, or EvaluationMissionRun", () => {
    const sources = [
      readFileSync(new URL("./lab-self-awareness.ts", import.meta.url), "utf-8"),
      readFileSync(new URL("../core/lab-self-awareness/lab-self-awareness.ts", import.meta.url), "utf-8"),
    ].join("\n");
    for (const forbidden of ["createImplementation", "createValidation", "setRecommendationStatus", "updateImplementationStatus", "db.agent.create", "db.agent.update", "db.agent.delete", "db.evaluationMissionRun.update", "db.evaluationMissionRun.create"]) {
      expect(sources).not.toContain(forbidden);
    }
  });
});
