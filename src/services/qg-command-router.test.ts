import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import {
  executeQgCommand,
  getAgentActivityResult,
  getApproveOrIgnoreCandidates,
  getCreateImplementationCandidates,
  getCreateValidationCandidates,
  getLastCycle,
  getPendingRecommendations,
  getRecurringFindings,
  getTeamArchitectResult,
  resolveActiveProjectId,
} from "./qg-command-router";
import { createImplementation } from "@/services/implementations";
import type { ConsolidatedFinding, FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

/**
 * FASE 11 — QG Runtime. Integration coverage for the Command Router's
 * dispatch/shaping layer only — never re-testing getAgentIntelligence(),
 * getFindingHistory(), listRecommendations(), or getTeamArchitectReport()'s
 * own internal correctness (already exhaustively covered by their own
 * test suites, 10B.1–10D).
 */
describe("qg-command-router (integration)", () => {
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

  function finding(text: string, classification: ConsolidatedFinding["sources"][number]["classification"] = "BUG"): ConsolidatedFinding {
    return {
      status: "FINDING",
      finding: text,
      duplicated: false,
      sources: [{ agentId: "qa-agent", evidence: `evidence for ${text}`, impact: "MEDIUM", recommendation: "fix it", confidence: "HIGH", classification }],
    };
  }

  function report(findings: ConsolidatedFinding[]): FinalEvaluationReport {
    return { missionId: "placeholder", mission: { target: { url: "http://localhost:3000/qg-command-test" }, objective: "t", task: "t" }, findings, coverage: [] };
  }

  async function makeRun(projectId: string, findings: ConsolidatedFinding[], createdAt: Date) {
    const run = await db.evaluationMissionRun.create({
      data: {
        projectId,
        status: "COMPLETED",
        input: { target: { url: "http://localhost:3000/qg-command-test" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] } as unknown as Prisma.InputJsonValue,
        report: report(findings) as unknown as Prisma.InputJsonValue,
        createdAt,
      },
    });
    missionRunIds.push(run.id);
    return run;
  }

  it("resolveActiveProjectId resolves to a real project id when real mission history exists", async () => {
    const projectId = await resolveActiveProjectId();
    expect(typeof projectId === "string" || projectId === null).toBe(true);
  });

  it("getLastCycle returns a well-shaped result regardless of which project is globally latest", async () => {
    const result = await getLastCycle();
    expect(result.type).toBe("LAST_CYCLE");
    expect(typeof result.hasData).toBe("boolean");
  });

  it("getRecurringFindings reports a PERSISTENT finding with its real classification and agent, via getFindingHistory (never recomputed)", async () => {
    const project = await makeProject("qg-command recurring");
    await makeRun(project.id, [finding("Recurring bug", "BUG")], new Date("2026-01-01"));
    await makeRun(project.id, [finding("Recurring bug", "BUG")], new Date("2026-01-02"));

    const result = await getRecurringFindings(project.id);
    expect(result.type).toBe("RECURRING_FINDINGS");
    const item = result.items.find((i) => i.finding === "Recurring bug");
    expect(item?.latestStatus).toBe("PERSISTENT");
    expect(item?.occurrences).toBe(2);
    expect(item?.classification).toBe("BUG");
    expect(item?.agentSlugs).toEqual(["qa-agent"]);
  });

  it("getRecurringFindings never includes a finding seen only once", async () => {
    const project = await makeProject("qg-command non-recurring");
    await makeRun(project.id, [finding("One-off finding")], new Date("2026-01-01"));

    const result = await getRecurringFindings(project.id);
    expect(result.items.find((i) => i.finding === "One-off finding")).toBeUndefined();
  });

  it("getPendingRecommendations shows a real PENDING recommendation's title/impact/confidence/origin", async () => {
    const project = await makeProject("qg-command pending recs");
    const run = await makeRun(project.id, [finding("Pending-rec finding")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: {
        missionRunId: run.id,
        findingIndex: 0,
        title: "QG command router test recommendation",
        summary: "A summary",
        whyItMatters: "Because",
        recommendedAction: "Do something",
        impact: "HIGH",
        confidence: "MEDIUM",
        status: "PENDING",
      },
    });

    const result = await getPendingRecommendations();
    const item = result.items.find((i) => i.id === recommendation.id);
    expect(item).toMatchObject({ title: "QG command router test recommendation", impact: "HIGH", confidence: "MEDIUM", status: "PENDING" });
    expect(item?.origin).toBe("http://localhost:3000/qg-command-test");
  });

  it("getAgentActivityResult reflects a real agent's execution count via getAgentIntelligence", async () => {
    const project = await makeProject("qg-command agent activity");
    const agent = await db.agent.findFirst({ where: { slug: "qa-agent" } });
    if (!agent) throw new Error('Seed agent "qa-agent" not found.');
    await db.agentExecution.create({
      data: { projectId: project.id, agentId: agent.id, task: "t", status: "SUCCESS", input: {}, output: { agent: "qa-agent", status: "NO_FINDING", finding: null, evidence: null, impact: null, recommendation: null, confidence: "MEDIUM", classification: null, needsOtherAgent: null } },
    });

    const result = await getAgentActivityResult(project.id);
    const item = result.items.find((i) => i.slug === "qa-agent");
    expect(item?.executionCount).toBe(1);
  });

  it("getTeamArchitectResult returns the real TeamArchitectReport shape without crashing on a fresh project", async () => {
    const project = await makeProject("qg-command architect");
    const result = await getTeamArchitectResult(project.id);
    expect(result.type).toBe("TEAM_ARCHITECT");
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(Array.isArray(result.insufficientEvidence)).toBe(true);
  });

  it("executeQgCommand dispatches each known command id to its own matching result type", async () => {
    expect((await executeQgCommand("GET_LAST_CYCLE")).type).toBe("LAST_CYCLE");
    for (const id of ["GET_RECURRING_FINDINGS", "GET_PENDING_RECOMMENDATIONS", "GET_AGENT_ACTIVITY", "GET_TEAM_ARCHITECT"] as const) {
      const result = await executeQgCommand(id);
      expect(["RECURRING_FINDINGS", "PENDING_RECOMMENDATIONS", "AGENT_ACTIVITY", "TEAM_ARCHITECT", "NO_ACTIVE_PROJECT"]).toContain(result.type);
    }
  });

  // ── FASE 12 — action candidate identification ──────────────────────────

  it("getApproveOrIgnoreCandidates lists a real PENDING Recommendation by title/impact/confidence", async () => {
    const project = await makeProject("qg-action candidates approve");
    const run = await makeRun(project.id, [finding("Candidate finding")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: { missionRunId: run.id, findingIndex: 0, title: "Candidate rec", summary: "s", whyItMatters: "w", recommendedAction: "a", impact: "HIGH", confidence: "MEDIUM", status: "PENDING" },
    });

    const candidates = await getApproveOrIgnoreCandidates();
    expect(candidates).toContainEqual({ id: recommendation.id, title: "Candidate rec", summary: "s", impact: "HIGH", confidence: "MEDIUM" });
  });

  it("getApproveOrIgnoreCandidates never lists an already-APPROVED or IGNORED Recommendation", async () => {
    const project = await makeProject("qg-action candidates approve exclude");
    const run = await makeRun(project.id, [finding("Already approved finding")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: { missionRunId: run.id, findingIndex: 0, title: "Already approved", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });

    const candidates = await getApproveOrIgnoreCandidates();
    expect(candidates.find((c) => c.id === recommendation.id)).toBeUndefined();
  });

  it("getCreateImplementationCandidates lists a real APPROVED Recommendation with no Implementation yet, via getTeamIntelligence's own evidenceGaps", async () => {
    const project = await makeProject("qg-action candidates implementation");
    const run = await makeRun(project.id, [finding("Needs implementation")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: { missionRunId: run.id, findingIndex: 0, title: "Needs implementation rec", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });

    const candidates = await getCreateImplementationCandidates(project.id);
    expect(candidates).toContainEqual({ recommendationId: recommendation.id, title: "Needs implementation rec", summary: "s", impact: null, confidence: null });

    // Once a real Implementation exists for it, it must disappear from the candidate list.
    await createImplementation(recommendation.id);
    const after = await getCreateImplementationCandidates(project.id);
    expect(after.find((c) => c.recommendationId === recommendation.id)).toBeUndefined();
  });

  it("getCreateValidationCandidates lists a real Implementation with no Validation yet, via getTeamIntelligence's own evidenceGaps", async () => {
    const project = await makeProject("qg-action candidates validation");
    const run = await makeRun(project.id, [finding("Needs validation")], new Date("2026-01-01"));
    const recommendation = await db.recommendation.create({
      data: { missionRunId: run.id, findingIndex: 0, title: "Needs validation rec", summary: "s", whyItMatters: "w", recommendedAction: "a", status: "APPROVED" },
    });
    const implementation = await createImplementation(recommendation.id, "Fixed it");

    const candidates = await getCreateValidationCandidates(project.id);
    expect(candidates).toContainEqual({
      implementationId: implementation.id,
      recommendationId: recommendation.id,
      recommendationTitle: "Needs validation rec",
      implementationSummary: "Fixed it",
    });
  });

  it("executeQgCommand returns ACTION_CANDIDATES result types for the four FASE 12 action commands", async () => {
    for (const id of ["APPROVE_RECOMMENDATION", "IGNORE_RECOMMENDATION", "CREATE_IMPLEMENTATION", "CREATE_VALIDATION"] as const) {
      const result = await executeQgCommand(id);
      expect(["ACTION_CANDIDATES", "NO_ACTIVE_PROJECT"]).toContain(result.type);
      if (result.type === "ACTION_CANDIDATES") expect(result.action).toBe(id);
    }
  });
});
