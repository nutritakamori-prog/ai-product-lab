import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { toFindingHistoryRunInput, getFindingHistory, type MissionRunRecord } from "./finding-history";
import type { ConsolidatedFinding, FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

function report(targetUrl: string, findings: ConsolidatedFinding[]): FinalEvaluationReport {
  return {
    missionId: "placeholder",
    mission: { target: { url: targetUrl }, objective: "test", task: "test" },
    findings,
    coverage: [],
  };
}

function finding(text: string, evidence = `evidence for ${text}`): ConsolidatedFinding {
  return {
    status: "FINDING",
    finding: text,
    duplicated: false,
    sources: [{ agentId: "qa-agent", evidence, impact: "MEDIUM", recommendation: "fix it", confidence: "HIGH", classification: "BUG" }],
  };
}

function findingWithSources(text: string, agentIds: string[], evidence = `evidence for ${text}`): ConsolidatedFinding {
  return {
    status: "FINDING",
    finding: text,
    duplicated: agentIds.length > 1,
    sources: agentIds.map((agentId) => ({
      agentId,
      evidence,
      impact: "MEDIUM" as const,
      recommendation: "fix it",
      confidence: "HIGH" as const,
      classification: "BUG" as const,
    })),
  };
}

// ── toFindingHistoryRunInput (pure) ─────────────────────────────────────
describe("toFindingHistoryRunInput", () => {
  function run(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
    return { id: "run-1", status: "COMPLETED", report: report("http://localhost:3000/qg", []), createdAt: new Date("2026-01-01"), ...overrides };
  }

  it("maps a COMPLETED run with a report to buildFindingHistory's input shape", () => {
    const input = toFindingHistoryRunInput(run({ report: report("http://localhost:3000/qg", [finding("A")]) }));
    expect(input).toEqual({
      runId: "run-1",
      target: { url: "http://localhost:3000/qg" },
      createdAt: new Date("2026-01-01"),
      findings: [finding("A")],
    });
  });

  it("excludes a BLOCKED run even though it has a report — no agent ever actually evaluated the target", () => {
    expect(toFindingHistoryRunInput(run({ status: "BLOCKED", report: report("http://localhost:3000/qg", []) }))).toBeNull();
  });

  it("excludes a FAILED run — report is null, no evidence gathered", () => {
    expect(toFindingHistoryRunInput(run({ status: "FAILED", report: null }))).toBeNull();
  });

  it("excludes a RUNNING run — not finished, report is null", () => {
    expect(toFindingHistoryRunInput(run({ status: "RUNNING", report: null }))).toBeNull();
  });
});

// ── getFindingHistory (integration, real Postgres) ──────────────────────
describe("getFindingHistory (integration)", () => {
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

  async function makeRun(
    projectId: string,
    targetUrl: string,
    findings: ConsolidatedFinding[],
    createdAt: Date,
    status: "COMPLETED" | "BLOCKED" = "COMPLETED",
  ) {
    const run = await db.evaluationMissionRun.create({
      data: {
        projectId,
        status,
        input: { target: { url: targetUrl }, objective: "test", task: "test", requestedAgents: [] } as unknown as Prisma.InputJsonValue,
        report: report(targetUrl, findings) as unknown as Prisma.InputJsonValue,
        createdAt,
      },
    });
    missionRunIds.push(run.id);
    return run;
  }

  // Case 1 — target with no history at all
  it("returns an empty array for a project with no mission runs", async () => {
    const project = await makeProject("finding-history no-history");
    expect(await getFindingHistory(project.id)).toEqual([]);
  });

  // Case 2 — first finding -> FIRST_OBSERVED
  it("marks a finding in the only run as FIRST_OBSERVED", async () => {
    const project = await makeProject("finding-history first-observed");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));

    const [history] = await getFindingHistory(project.id);
    expect(history?.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED"]);
  });

  // Case 3 — same finding in a later cycle -> PERSISTENT
  it("marks the same finding across two runs as PERSISTENT on the second", async () => {
    const project = await makeProject("finding-history persistent");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-02"));

    const [history] = await getFindingHistory(project.id);
    const timeline = history?.timelines.find((t) => t.finding === "A");
    expect(timeline?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT"]);
  });

  // Case 4 — a finding appearing in a later cycle that wasn't there before -> NEW
  it("marks a finding appearing only in a later run (after an earlier run existed) as NEW", async () => {
    const project = await makeProject("finding-history new");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A"), finding("B")], new Date("2026-01-02"));

    const [history] = await getFindingHistory(project.id);
    const timelineB = history?.timelines.find((t) => t.finding === "B");
    expect(timelineB?.points.map((p) => p.status)).toEqual(["NEW"]);
  });

  // Case 5 — a finding disappearing -> NOT_REPRODUCED
  it("marks a finding absent from a later run as NOT_REPRODUCED", async () => {
    const project = await makeProject("finding-history not-reproduced");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [], new Date("2026-01-02"));

    const [history] = await getFindingHistory(project.id);
    const timeline = history?.timelines.find((t) => t.finding === "A");
    expect(timeline?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED"]);
  });

  // Case 6 — a finding disappearing then coming back -> REAPPEARED
  it("marks a finding that disappears and comes back as REAPPEARED", async () => {
    const project = await makeProject("finding-history reappeared");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [], new Date("2026-01-02"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-03"));

    const [history] = await getFindingHistory(project.id);
    const timeline = history?.timelines.find((t) => t.finding === "A");
    expect(timeline?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "NOT_REPRODUCED", "REAPPEARED"]);
  });

  // Case 7 — multiple agents/sources on the same ConsolidatedFinding never duplicate the history
  it("counts a finding with multiple sources once, never duplicated in the history", async () => {
    const project = await makeProject("finding-history multi-source");
    await makeRun(project.id, "http://localhost:3000/qg", [findingWithSources("A", ["qa-agent", "ux-agent"])], new Date("2026-01-01"));

    const [history] = await getFindingHistory(project.id);
    expect(history?.timelines).toHaveLength(1);
    expect(history?.timelines[0]?.points).toHaveLength(1);
  });

  // Case 8 — multiple targets stay separated
  it("keeps two different targets in the same project as separate histories", async () => {
    const project = await makeProject("finding-history multi-target");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/product-intelligence", [finding("A")], new Date("2026-01-01"));

    const histories = await getFindingHistory(project.id);
    expect(histories).toHaveLength(2);
    // Each target's own "A" is FIRST_OBSERVED in its own single-run history — never PERSISTENT.
    for (const history of histories) {
      expect(history.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED"]);
    }

    const filtered = await getFindingHistory(project.id, "http://localhost:3000/qg");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.target.url).toBe("http://localhost:3000/qg");
  });

  // Case 9 — multiple projects stay separated
  it("never mixes mission runs between two different projects, even for the same target URL", async () => {
    const [projectA, projectB] = await Promise.all([
      makeProject("finding-history isolation A"),
      makeProject("finding-history isolation B"),
    ]);
    await makeRun(projectA.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(projectA.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-02"));
    await makeRun(projectB.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));

    const [historyA] = await getFindingHistory(projectA.id);
    const [historyB] = await getFindingHistory(projectB.id);

    expect(historyA?.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT"]);
    expect(historyB?.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED"]);
  });

  // Case 10 — chronological order is correct regardless of insertion/return order
  it("orders runs chronologically by createdAt, independent of insertion order", async () => {
    const project = await makeProject("finding-history chronology");
    // Inserted out of chronological order on purpose.
    await makeRun(project.id, "http://localhost:3000/qg", [], new Date("2026-01-03"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-02"));

    const [history] = await getFindingHistory(project.id);
    const timeline = history?.timelines.find((t) => t.finding === "A");
    expect(timeline?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT", "NOT_REPRODUCED"]);
  });

  // Case 11 — a mission with no findings at all
  it("handles a COMPLETED run with zero findings without error, and BLOCKED runs are excluded from the window", async () => {
    const project = await makeProject("finding-history no-findings");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [], new Date("2026-01-02"), "BLOCKED");

    const [history] = await getFindingHistory(project.id);
    // The BLOCKED run never entered the comparison window at all — only one run id.
    expect(history?.runIds).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(history?.runIds).toHaveLength(1);
    expect(history?.timelines[0]?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED"]);
  });

  // Case 12 — history across many missions
  it("accumulates a finding's full timeline across many mission runs", async () => {
    const project = await makeProject("finding-history many-missions");
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-01"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-02"));
    await makeRun(project.id, "http://localhost:3000/qg", [], new Date("2026-01-03"));
    await makeRun(project.id, "http://localhost:3000/qg", [finding("A")], new Date("2026-01-04"));

    const [history] = await getFindingHistory(project.id);
    expect(history?.runIds).toHaveLength(4);
    const timeline = history?.timelines.find((t) => t.finding === "A");
    expect(timeline?.points.map((p) => p.status)).toEqual(["FIRST_OBSERVED", "PERSISTENT", "NOT_REPRODUCED", "REAPPEARED"]);
  });
});
