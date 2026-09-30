import { describe, expect, it } from "vitest";
import { synthesizeHeadReport } from "./head-report";
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

function success(agentId: string, output: AgentOutput): AgentEvaluationOutcome {
  return { agentId, status: "SUCCESS", output, error: null };
}

const mission = { missionId: "mission-1", mission: { target: { url: "https://exemplo.com", name: "Exemplo" }, objective: "Objective", task: "Task" } };

describe("synthesizeHeadReport", () => {
  it("1. an evaluation with no findings reports 0 across every bucket and no main recommendation", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [success("qa-agent", noFindingOutput("qa-agent")), success("ux-agent", noFindingOutput("ux-agent"))],
    });

    const head = synthesizeHeadReport(report);

    expect(head.totalFindings).toBe(0);
    expect(head.problems).toBe(0);
    expect(head.opportunities).toBe(0);
    expect(head.observations).toBe(0);
    expect(head.hasConvergence).toBe(false);
    expect(head.mainRecommendation).toBeNull();
    expect(head.items).toEqual([]);
    expect(head.specialistsInvolved).toBe(2);
    expect(head.specialistsWithResult).toBe(2);
    expect(head.summary).toContain("Exemplo");
  });

  it("2. buckets a finding as PROBLEM, OPPORTUNITY, or OBSERVATION strictly from its own classification", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success("qa-agent", findingOutput({ finding: "Bug A", evidence: "Evidence A", classification: "BUG" })),
        success(
          "product-agent",
          findingOutput({ agent: "product-agent", finding: "Idea B", evidence: "Evidence B", classification: "OPPORTUNITY" }),
        ),
        success(
          "performance-agent",
          findingOutput({ agent: "performance-agent", finding: "Risk C", evidence: "Evidence C", classification: "FUTURE_RISK" }),
        ),
      ],
    });

    const head = synthesizeHeadReport(report);

    expect(head.totalFindings).toBe(3);
    expect(head.problems).toBe(1);
    expect(head.opportunities).toBe(1);
    expect(head.observations).toBe(1);
    expect(head.items.map((i) => i.bucket)).toEqual(["PROBLEM", "OPPORTUNITY", "OBSERVATION"]);
  });

  it("3. a finding two agents converge on is flagged as converged, and its whyItMatters names both", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success("qa-agent", findingOutput({ finding: "Same problem", evidence: "Same evidence" })),
        success("ux-agent", findingOutput({ agent: "ux-agent", finding: "Same problem", evidence: "Same evidence" })),
      ],
    });

    const head = synthesizeHeadReport(report);

    expect(head.hasConvergence).toBe(true);
    expect(head.items).toHaveLength(1);
    expect(head.items[0].converged).toBe(true);
    expect(head.items[0].agents).toEqual(["qa-agent", "ux-agent"]);
    expect(head.items[0].whyItMatters).toContain("2 especialistas");
    expect(head.items[0].whyItMatters).toContain("qa-agent + ux-agent");
  });

  it("4. recommendedAction reuses the specialists' own recommendation text verbatim, deduplicated — never invents one", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success("qa-agent", findingOutput({ finding: "Same problem", evidence: "Same evidence", recommendation: "Fix the root cause." })),
        success(
          "ux-agent",
          findingOutput({ agent: "ux-agent", finding: "Same problem", evidence: "Same evidence", recommendation: "Fix the root cause." }),
        ),
      ],
    });

    const head = synthesizeHeadReport(report);

    expect(head.items[0].recommendedAction).toBe("Fix the root cause.");
  });

  it("5. with no recommendation from any source, says so plainly instead of inventing one", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [success("qa-agent", findingOutput({ recommendation: null }))],
    });

    const head = synthesizeHeadReport(report);

    expect(head.items[0].recommendedAction).toBe("Nenhuma recomendação específica foi fornecida pelos especialistas.");
  });

  it("6. the main recommendation prefers the finding with the most convergence, then impact, then confidence", () => {
    const report = consolidateMissionEvaluation({
      ...mission,
      evaluations: [
        success(
          "qa-agent",
          findingOutput({
            finding: "Minor issue",
            evidence: "Minor evidence",
            impact: "LOW",
            confidence: "LOW",
            recommendation: "Minor fix.",
          }),
        ),
        success(
          "ux-agent",
          findingOutput({ agent: "ux-agent", finding: "Converged issue", evidence: "Converged evidence", recommendation: "Converged fix." }),
        ),
        success(
          "new-user",
          findingOutput({ agent: "new-user", finding: "Converged issue", evidence: "Converged evidence", recommendation: "Converged fix." }),
        ),
      ],
    });

    const head = synthesizeHeadReport(report);

    expect(head.mainRecommendation).toBe("Converged fix.");
  });
});
