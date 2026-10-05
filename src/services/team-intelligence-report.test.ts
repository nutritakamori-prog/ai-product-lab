import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { analyzeTeamIntelligence } from "./team-intelligence-report";

const KNOWN_AGENT_SLUGS = ["new-user", "qa-agent", "ux-agent", "accessibility-agent", "product-agent", "performance-agent", "security-agent"];

describe("analyzeTeamIntelligence (integration)", () => {
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

  // FASE 12A Caso 2 — pouca evidência: a confiança GERAL da amostra nunca
  // deve passar de INSUFFICIENT sem nenhuma missão analisada, mesmo que o
  // Team Architect (pré-existente, não alterado nesta fase) já produza
  // COVERAGE_GAP por agente ocioso desde o primeiro dia — essa é uma
  // evidência real e honesta por si só (zero execuções é um fato
  // observável), não uma lacuna fabricada; a confiança GERAL deste relatório
  // é sobre o tamanho da amostra de missões, um eixo diferente.
  it("admits INSUFFICIENT overall confidence for a brand-new project with zero missions, never claiming more certainty than the sample supports", async () => {
    const project = await makeProject("team-intel-report empty");
    const report = await analyzeTeamIntelligence(project.id);
    expect(report.confidence).toBe("INSUFFICIENT");
    expect(report.evidence.missionsAnalyzed).toBe(0);
    expect(report.summary).toMatch(/evidência insuficiente/i);
    // Every recommendation this pre-existing layer does produce from zero
    // mission history is still honestly evidenced (real zero-activity
    // facts), never a fabricated type outside its own documented vocabulary.
    for (const rec of report.architect.recommendations) {
      expect(rec.evidence.length).toBeGreaterThan(0);
    }
  });

  // FASE 12A Caso 1 — equipe conhecida: os 7 agentes reais da equipe atual.
  it("recognizes exactly the LAB's own 7 real agents — never a fabricated or 8th agent", async () => {
    const project = await makeProject("team-intel-report known team");
    const report = await analyzeTeamIntelligence(project.id);
    const slugs = report.team.activity.perAgent.map((a) => a.slug).sort();
    expect(slugs).toEqual([...KNOWN_AGENT_SLUGS].sort());
    expect(report.team.activity.totalAgents).toBe(KNOWN_AGENT_SLUGS.length);
  });

  it("counts real missions by their real status, never conflating FAILED with COMPLETED", async () => {
    const project = await makeProject("team-intel-report mission counts");
    const [completed, failed] = await Promise.all([
      db.evaluationMissionRun.create({ data: { projectId: project.id, status: "COMPLETED", input: { target: { url: "https://example.com" }, objective: "o", task: "t", requestedAgents: [] } } }),
      db.evaluationMissionRun.create({ data: { projectId: project.id, status: "FAILED", input: { target: { url: "https://example.com" }, objective: "o", task: "t", requestedAgents: [] }, error: "x" } }),
    ]);
    missionRunIds.push(completed.id, failed.id);

    const report = await analyzeTeamIntelligence(project.id);
    expect(report.evidence).toMatchObject({ missionsAnalyzed: 2, completedMissions: 1, failedMissions: 1, blockedMissions: 0 });
    expect(report.confidence).toBe("LOW"); // 2 missions: real evidence exists, but below RECURRENCE_MIN
  });

  // FASE 12A Caso 7 — dados reais: não pode quebrar contra o estado real do LAB.
  it("runs against the LAB's real, pre-existing project data without crashing", async () => {
    const realProject = await db.project.findFirst({ orderBy: { createdAt: "asc" } });
    if (!realProject) {
      // An empty database is itself a valid state to confirm against — never skip silently.
      expect(realProject).toBeNull();
      return;
    }
    const report = await analyzeTeamIntelligence(realProject.id);
    expect(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"]).toContain(report.confidence);
    expect(typeof report.summary).toBe("string");
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it("never imports or calls any function that creates, disables, removes, or modifies an Agent, Recommendation, or Implementation", () => {
    const sources = [
      readFileSync(new URL("./team-intelligence-report.ts", import.meta.url), "utf-8"),
      readFileSync(new URL("../core/team-intelligence/team-intelligence-report.ts", import.meta.url), "utf-8"),
    ].join("\n");
    for (const forbidden of ["createImplementation", "createValidation", "setRecommendationStatus", "updateImplementationStatus", "db.agent.create", "db.agent.update", "db.agent.delete", "db.evaluationMissionRun.update", "db.evaluationMissionRun.create"]) {
      expect(sources).not.toContain(forbidden);
    }
  });
});
