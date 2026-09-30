import type { FindingClassification } from "@/domain/agent-output";
import type { ConsolidatedFinding, FinalEvaluationReport } from "./mission-evaluation-report";

/**
 * The Head: a synthesis layer over an already-consolidated
 * FinalEvaluationReport — never a second agent, never a browser action,
 * never a model call. Pure and deterministic, exactly like
 * consolidateMissionEvaluation() itself: every sentence it produces is
 * templated directly from fields the specialists themselves already
 * provided (finding/evidence/impact/confidence/recommendation/classification,
 * and how many of them agreed) — it never infers a root cause, never
 * invents a metric or a score, and never promotes an observation into a
 * problem the underlying findings didn't already claim. See
 * mission-evaluation-report.ts for the consolidation this builds on; this
 * file never re-deduplicates or re-groups findings on its own.
 */

const IMPACT_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const CONFIDENCE_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

// Reuses the exact same FINDING_CLASSIFICATIONS values every agent already
// picks from (domain/agent-output.ts) — bucketed into the three plain-
// language groups the Head reports, never a new taxonomy of its own.
const OPPORTUNITY_CLASSIFICATIONS: FindingClassification[] = ["OPPORTUNITY"];
const OBSERVATION_CLASSIFICATIONS: FindingClassification[] = ["FUTURE_RISK"];

export type HeadReportBucket = "PROBLEM" | "OPPORTUNITY" | "OBSERVATION";

function bucketFor(finding: ConsolidatedFinding): HeadReportBucket {
  // A finding's sources can, in principle, disagree on classification — the
  // first source's own value is used as-is, never resolved into some
  // invented "consensus" classification.
  const classification = finding.sources[0]?.classification ?? null;
  if (classification && OPPORTUNITY_CLASSIFICATIONS.includes(classification)) return "OPPORTUNITY";
  if (classification && OBSERVATION_CLASSIFICATIONS.includes(classification)) return "OBSERVATION";
  return "PROBLEM";
}

function agentLabel(agentIds: string[]): string {
  return agentIds.join(" + ");
}

/**
 * Every sentence here is built only from what `finding` itself already
 * carries — never a guess at why the underlying issue exists.
 */
function whyItMatters(finding: ConsolidatedFinding): string {
  const agentIds = finding.sources.map((s) => s.agentId);
  const impacts = Array.from(new Set(finding.sources.map((s) => s.impact).filter((v): v is NonNullable<typeof v> => v !== null)));
  const impactText = impacts.length > 0 ? `Impacto ${impacts.join("/")}.` : "";
  const convergenceText =
    finding.sources.length > 1
      ? `Identificado de forma independente por ${finding.sources.length} especialistas (${agentLabel(agentIds)}).`
      : `Identificado por ${agentLabel(agentIds)}.`;
  return [impactText, convergenceText].filter(Boolean).join(" ");
}

/**
 * The recommended action is never authored here — it's the specialists' own
 * recommendation text, deduplicated verbatim. Only when none of the sources
 * gave one does this say so plainly, rather than inventing one.
 */
function recommendedAction(finding: ConsolidatedFinding): string {
  const unique = Array.from(new Set(finding.sources.map((s) => s.recommendation).filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return "Nenhuma recomendação específica foi fornecida pelos especialistas.";
  return unique.join(" ");
}

export interface HeadReportItem {
  findingIndex: number;
  bucket: HeadReportBucket;
  title: string;
  whyItMatters: string;
  recommendedAction: string;
  impact: string | null;
  confidence: string | null;
  agents: string[];
  converged: boolean;
}

export interface HeadReport {
  summary: string;
  specialistsInvolved: number;
  specialistsWithResult: number;
  totalFindings: number;
  problems: number;
  opportunities: number;
  observations: number;
  hasConvergence: boolean;
  mainRecommendation: string | null;
  items: HeadReportItem[];
}

function rankOf(finding: ConsolidatedFinding): number {
  const bestImpact = Math.max(0, ...finding.sources.map((s) => IMPACT_RANK[s.impact ?? ""] ?? 0));
  const bestConfidence = Math.max(0, ...finding.sources.map((s) => CONFIDENCE_RANK[s.confidence] ?? 0));
  // Convergence first (2+ independent specialists agreeing is the strongest
  // real signal this system has), then impact, then confidence — never an
  // arbitrary combined "score".
  return finding.sources.length * 100 + bestImpact * 10 + bestConfidence;
}

export function synthesizeHeadReport(report: FinalEvaluationReport): HeadReport {
  const specialistsInvolved = report.coverage.length;
  const specialistsWithResult = report.coverage.filter((c) => c.status === "SUCCESS").length;

  const items: HeadReportItem[] = report.findings.map((finding, index) => ({
    findingIndex: index,
    bucket: bucketFor(finding),
    title: finding.finding,
    whyItMatters: whyItMatters(finding),
    recommendedAction: recommendedAction(finding),
    impact: finding.sources[0]?.impact ?? null,
    confidence: finding.sources[0]?.confidence ?? null,
    agents: finding.sources.map((s) => s.agentId),
    converged: finding.duplicated,
  }));

  const problems = items.filter((i) => i.bucket === "PROBLEM").length;
  const opportunities = items.filter((i) => i.bucket === "OPPORTUNITY").length;
  const observations = items.filter((i) => i.bucket === "OBSERVATION").length;

  const ranked = [...report.findings].sort((a, b) => rankOf(b) - rankOf(a));
  const topFinding = ranked[0];
  const topIndex = topFinding ? report.findings.indexOf(topFinding) : -1;
  const mainRecommendation = topIndex >= 0 ? items[topIndex].recommendedAction : null;

  const targetLabel = report.mission.target.name ?? report.mission.target.url;
  const summary =
    items.length === 0
      ? `${specialistsInvolved} especialista(s) avaliaram ${targetLabel} (${specialistsWithResult} com resultado válido) e não confirmaram nenhum problema ou oportunidade com evidência suficiente.`
      : `${specialistsInvolved} especialista(s) avaliaram ${targetLabel} (${specialistsWithResult} com resultado válido) e identificaram ${items.length} ponto(s) de atenção.`;

  return {
    summary,
    specialistsInvolved,
    specialistsWithResult,
    totalFindings: items.length,
    problems,
    opportunities,
    observations,
    hasConvergence: items.some((i) => i.converged),
    mainRecommendation,
    items,
  };
}
