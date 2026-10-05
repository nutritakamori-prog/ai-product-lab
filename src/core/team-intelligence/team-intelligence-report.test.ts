import { describe, expect, it } from "vitest";
import { buildTeamIntelligenceReport, computeConfidence, buildEvidenceCounts, type TeamEvidenceCounts } from "./team-intelligence-report";
import type { TeamIntelligenceSummary } from "./team-intelligence";
import type { TeamArchitectReport, ArchitecturalRecommendation, InsufficientEvidenceEntry } from "@/core/team-architect/team-architect";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function team(overrides: Partial<TeamIntelligenceSummary> = {}): TeamIntelligenceSummary {
  return {
    activity: { totalAgents: 7, enabledAgents: 7, activeAgents: 0, perAgent: [] },
    coverage: [],
    findingPatterns: { targets: [], classificationsObserved: [] },
    agentProblemCoverage: [],
    convergence: [],
    recommendationLifecycle: {
      totalRecommendations: 0,
      byStatus: { PENDING: 0, APPROVED: 0, IGNORED: 0 },
      withImplementation: 0,
      withoutImplementation: 0,
      implementationsByStatus: { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 },
      withValidation: 0,
      withoutValidation: 0,
      validationsByStatus: { PENDING: 0, PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 },
    },
    evidenceGaps: {
      agentsWithoutActivity: [],
      findingsWithoutRecommendation: [],
      approvedRecommendationsWithoutImplementation: [],
      implementationsWithoutValidation: [],
      validationsWithoutRetestReference: [],
      classificationsNeverObserved: [],
    },
    ...overrides,
  };
}

function recommendation(overrides: Partial<ArchitecturalRecommendation> = {}): ArchitecturalRecommendation {
  return {
    id: "POSSIBLE_OVERLAP:qa-agent|ux-agent",
    type: "POSSIBLE_OVERLAP",
    title: "t",
    summary: "s",
    confidence: "MEDIUM",
    evidence: [{ description: "d" }],
    affectedAgents: ["qa-agent", "ux-agent"],
    affectedCategories: [],
    suggestedAction: "a",
    rationale: "r",
    limitations: [],
    ...overrides,
  };
}

function insufficientEntry(overrides: Partial<InsufficientEvidenceEntry> = {}): InsufficientEvidenceEntry {
  return { area: "ADD_AGENT", observed: "o", missing: "m", reason: "r", ...overrides };
}

function architect(overrides: Partial<TeamArchitectReport> = {}): TeamArchitectReport {
  return { recommendations: [], insufficientEvidence: [], ...overrides };
}

const ZERO_MISSIONS = { completed: 0, failed: 0, blocked: 0, running: 0 };

describe("computeConfidence", () => {
  it("is INSUFFICIENT with zero missions analyzed — no evidence at all", () => {
    expect(computeConfidence(0)).toBe("INSUFFICIENT");
  });

  it("is LOW below the RECURRENCE_MIN bar (same threshold team-architect.ts itself requires for a 'recurring' pattern)", () => {
    expect(computeConfidence(1)).toBe("LOW");
    expect(computeConfidence(2)).toBe("LOW");
  });

  it("is MEDIUM between RECURRENCE_MIN and ADD_AGENT_MIN", () => {
    expect(computeConfidence(3)).toBe("MEDIUM");
    expect(computeConfidence(4)).toBe("MEDIUM");
  });

  it("is HIGH at or above ADD_AGENT_MIN (the same bar the Architect itself requires before proposing growing the team)", () => {
    expect(computeConfidence(5)).toBe("HIGH");
    expect(computeConfidence(50)).toBe("HIGH");
  });
});

describe("buildEvidenceCounts", () => {
  it("derives findingsAnalyzed from recommendations + findings without one, never a separate guess", () => {
    const t = team({
      recommendationLifecycle: { ...team().recommendationLifecycle, totalRecommendations: 4 },
      evidenceGaps: { ...team().evidenceGaps, findingsWithoutRecommendation: [{ missionRunId: "r1", findingIndex: 0, finding: "f" }] },
    });
    const evidence = buildEvidenceCounts(t, { completed: 2, failed: 1, blocked: 0, running: 0 });
    expect(evidence).toEqual<TeamEvidenceCounts>({
      missionsAnalyzed: 3,
      completedMissions: 2,
      failedMissions: 1,
      blockedMissions: 0,
      findingsAnalyzed: 5,
      recommendationsAnalyzed: 4,
    });
  });
});

describe("buildTeamIntelligenceReport", () => {
  // Caso 2 (FASE 12A brief) — pouca evidência: nunca inventar uma lacuna.
  it("admits insufficient evidence honestly when no mission has ever been analyzed, never inventing a gap", () => {
    const report = buildTeamIntelligenceReport(team(), architect(), ZERO_MISSIONS, NOW);
    expect(report.confidence).toBe("INSUFFICIENT");
    expect(report.summary).toMatch(/evidência insuficiente/i);
    // Honest about not having evidence (fine to name what's unconfirmed) —
    // the real guarantee is that no recommendation type is ever fabricated.
    expect(report.architect.recommendations).toEqual([]);
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  // Regression — found live, running this exact module against the real LAB
  // database: a project with 37 total mission attempts but only 4 that ever
  // reached the agents (2 COMPLETED, 2 BLOCKED; 33 FAILED at the Task
  // Planner, before any agent ran) was initially computed as HIGH confidence
  // from the raw attempt count — confidently generalizing from a dataset
  // that barely ever reached what it claimed to have evidence about.
  it("never inflates confidence from a pile of top-level FAILED missions that never reached the agents", () => {
    const report = buildTeamIntelligenceReport(team(), architect(), { completed: 2, failed: 33, blocked: 2, running: 0 }, NOW);
    expect(report.evidence.missionsAnalyzed).toBe(37);
    expect(report.confidence).toBe("MEDIUM"); // completed+blocked = 4, not 37
    expect(report.confidence).not.toBe("HIGH");
  });

  it("never claims more certainty than the sample supports, even when a real signal already exists", () => {
    // Only 1 completed mission, but a real POSSIBLE_OVERLAP already fired —
    // confidence must still reflect the small sample, not the presence of a signal.
    const report = buildTeamIntelligenceReport(team(), architect({ recommendations: [recommendation()] }), { completed: 1, failed: 0, blocked: 0, running: 0 }, NOW);
    expect(report.confidence).toBe("LOW");
    expect(report.summary).toMatch(/amostra ainda é pequena/i);
  });

  it("reports real numbers in the summary — never a placeholder or a rounded-off guess", () => {
    const report = buildTeamIntelligenceReport(
      team({ recommendationLifecycle: { ...team().recommendationLifecycle, totalRecommendations: 4 } }),
      architect({ recommendations: [recommendation()], insufficientEvidence: [insufficientEntry()] }),
      { completed: 5, failed: 2, blocked: 1, running: 0 },
      NOW,
    );
    expect(report.confidence).toBe("HIGH");
    expect(report.summary).toContain("7 agente(s)");
    expect(report.summary).toContain("8 missão(ões)");
    expect(report.summary).toContain("5 concluída(s)");
    expect(report.summary).toContain("2 falha(s)");
    expect(report.summary).toContain("1 bloqueada(s)");
    expect(report.summary).toContain("1 sinal(is)");
    expect(report.summary).toContain("POSSIBLE_OVERLAP");
  });

  it("is fully deterministic — same input, same output", () => {
    const t = team({ recommendationLifecycle: { ...team().recommendationLifecycle, totalRecommendations: 2 } });
    const a = architect({ recommendations: [recommendation()] });
    const counts = { completed: 3, failed: 0, blocked: 0, running: 0 };
    expect(buildTeamIntelligenceReport(t, a, counts, NOW)).toEqual(buildTeamIntelligenceReport(t, a, counts, NOW));
  });
});
