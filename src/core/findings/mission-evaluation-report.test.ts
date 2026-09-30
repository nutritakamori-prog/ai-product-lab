import { describe, expect, it } from "vitest";
import { consolidateMissionEvaluation } from "./mission-evaluation-report";
import type { AgentEvaluationOutcome } from "@/services/evaluation-orchestrator";
import type { AgentOutput } from "@/domain/agent-output";

function findingOutput(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    agent: "qa-agent",
    status: "FINDING",
    finding: "The Continuar button did not appear after clicking Entrar.",
    evidence: 'No element matching "botão Continuar" was found on the page.',
    impact: "MEDIUM",
    recommendation: "Investigate the missing transition.",
    confidence: "MEDIUM",
    classification: "UI",
    needsOtherAgent: null,
    ...overrides,
  };
}

function noFindingOutput(agent: string): AgentOutput {
  return {
    agent,
    status: "NO_FINDING",
    finding: null,
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "MEDIUM",
    classification: null,
    needsOtherAgent: null,
  };
}

function unconfirmedOutput(agent: string): AgentOutput {
  return {
    agent,
    status: "UNCONFIRMED",
    finding: "Not enough evidence to confirm a problem.",
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "LOW",
    classification: null,
    needsOtherAgent: null,
  };
}

function success(agentId: string, output: AgentOutput): AgentEvaluationOutcome {
  return { agentId, status: "SUCCESS", output, error: null };
}

const mission = { missionId: "mission-1", mission: { target: { url: "https://exemplo.com" }, objective: "Objective", task: "Task" } };

describe("consolidateMissionEvaluation", () => {
  it("1. two genuinely different findings stay separate", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success("qa-agent", findingOutput({ finding: "Problem A", evidence: "Evidence A" })),
        success("ux-agent", findingOutput({ agent: "ux-agent", finding: "Problem B", evidence: "Evidence B" })),
      ],
    });

    expect(report.findings).toHaveLength(2);
    expect(report.findings.every((f) => f.duplicated === false)).toBe(true);
  });

  it("2. equivalent findings (same finding + evidence text, case/whitespace-insensitive) are consolidated into one", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success("qa-agent", findingOutput({ finding: "  The Continuar button did NOT appear  ", evidence: "no element matching \"botão continuar\" was found on the page." })),
        success("ux-agent", findingOutput({ agent: "ux-agent", finding: "The Continuar button did not appear", evidence: 'No element matching "botão Continuar" was found on the page.' })),
      ],
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].duplicated).toBe(true);
    expect(report.findings[0].sources).toHaveLength(2);
  });

  it("3. agents involved are preserved for a consolidated finding", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [success("qa-agent", findingOutput()), success("ux-agent", findingOutput({ agent: "ux-agent" }))],
    });

    expect(report.findings[0].sources.map((s) => s.agentId)).toEqual(["qa-agent", "ux-agent"]);
  });

  it("4. evidence (and impact/recommendation/confidence/classification) are preserved unaltered per source, never merged", () => {
    const qaOutput = findingOutput({ impact: "HIGH", confidence: "HIGH", recommendation: "Fix it fast." });
    const uxOutput = findingOutput({ agent: "ux-agent", impact: "LOW", confidence: "LOW", recommendation: "Consider polishing it." });

    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [success("qa-agent", qaOutput), success("ux-agent", uxOutput)],
    });

    const [group] = report.findings;
    expect(group.sources).toHaveLength(2);
    const qaSource = group.sources.find((s) => s.agentId === "qa-agent");
    const uxSource = group.sources.find((s) => s.agentId === "ux-agent");
    // Each source keeps its OWN impact/confidence/recommendation — never a
    // single merged/invented value, even though both are the "same" finding.
    expect(qaSource).toEqual({
      agentId: "qa-agent",
      evidence: qaOutput.evidence,
      impact: "HIGH",
      recommendation: "Fix it fast.",
      confidence: "HIGH",
      classification: "UI",
    });
    expect(uxSource).toEqual({
      agentId: "ux-agent",
      evidence: uxOutput.evidence,
      impact: "LOW",
      recommendation: "Consider polishing it.",
      confidence: "LOW",
      classification: "UI",
    });
  });

  it("5. NO_FINDING is preserved in coverage, never appears in findings, never invented as a problem", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [success("qa-agent", noFindingOutput("qa-agent"))],
    });

    expect(report.findings).toEqual([]);
    expect(report.coverage).toHaveLength(1);
    expect(report.coverage[0].output?.status).toBe("NO_FINDING");
  });

  it("6. UNCONFIRMED is preserved in coverage, never promoted into a finding", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [success("qa-agent", unconfirmedOutput("qa-agent"))],
    });

    expect(report.findings).toEqual([]);
    expect(report.coverage).toHaveLength(1);
    expect(report.coverage[0].output?.status).toBe("UNCONFIRMED");
    expect(report.coverage[0].output?.finding).toBe("Not enough evidence to confirm a problem.");
  });

  it("7. a result with no evaluations at all works and produces an empty report", () => {
    const report = consolidateMissionEvaluation({ ...mission, evaluations: [] });

    expect(report.findings).toEqual([]);
    expect(report.coverage).toEqual([]);
    expect(report.missionId).toBe("mission-1");
  });

  it("8. nothing is invented: two agents disagreeing (different finding text) about a related topic are NOT merged just because they disagree, and mission/basic info are passed through unaltered", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success("qa-agent", findingOutput({ finding: "The button never appeared.", evidence: "Evidence 1" })),
        success("ux-agent", findingOutput({ agent: "ux-agent", finding: "The transition felt abrupt.", evidence: "Evidence 2" })),
      ],
    });

    expect(report.findings).toHaveLength(2); // never merged just because both are about the same button/topic
    expect(report.missionId).toBe(mission.missionId);
    expect(report.mission).toEqual(mission.mission); // basic mission info passed through, not re-derived or altered
    // A BLOCKED/FAILED outcome is also never turned into a finding.
    const withBlocked = consolidateMissionEvaluation({
      ...mission,
      evaluations: [{ agentId: "agente-inexistente", status: "BLOCKED", output: null, error: "does not exist" }],
    });
    expect(withBlocked.findings).toEqual([]);
    expect(withBlocked.coverage[0].status).toBe("BLOCKED");
  });
});
