import type { Recommendation } from "@/generated/prisma/client";
import type { ConsolidatedFinding, FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";

/**
 * The exact sentinel head-report.ts's own recommendedAction() falls back to
 * when no specialist provided one — see src/core/findings/head-report.ts.
 * Recognized here (never re-derived) so an Implementation Task never turns
 * an honest "nobody recommended anything" into a fabricated acceptance
 * criterion.
 */
const NO_RECOMMENDATION_SENTINEL = "Nenhuma recomendação específica foi fornecida pelos especialistas.";

export interface ImplementationTaskEvidence {
  agentId: string;
  evidence: string;
}

/**
 * Everything here is read straight off an already-persisted Recommendation
 * row plus its own EvaluationMissionRun (input/report) — the same relation
 * the Mission page and Product Intelligence already use
 * (missionRunId + findingIndex). No new table, no new fields: this is a
 * pure, derived view, computed fresh every time it's requested.
 */
export interface ImplementationTask {
  title: string;
  recommendationId: string;
  missionRunId: string;
  targetLabel: string;
  context: string;
  problem: string;
  evidences: ImplementationTaskEvidence[];
  impact: string | null;
  confidence: string | null;
  agents: string[];
  recommendedAction: string;
  /** null means: not enough grounded information to derive one — never a fabricated criterion. */
  acceptanceCriteria: string[] | null;
}

/**
 * Two narrow, deterministic signals that a recommendedAction expresses two
 * genuine alternatives — never a language parser, never NLP. Anything that
 * doesn't match either pattern is left as one whole, unsplit criterion: a
 * false negative here (a real alternative left unsplit) is safe, a false
 * positive (splitting "o usuário pode criar ou editar projetos" into two
 * fake alternatives) is not — so both patterns require an explicit,
 * structural marker before ever splitting, never just the presence of the
 * word "ou".
 */
export function splitIntoAlternatives(text: string): [string, string] | null {
  // Pattern 1: "Ou <A>, ou <B>" — an explicit leading "Ou" opening the whole
  // sentence, plus a second ", ou" marker introducing the second clause.
  // This is exactly how a specialist phrases a genuine either/or
  // recommendation (see the real "Ou explicar objetivamente o que é o
  // Head ..., ou, quando ... explicar por quê ..." case from Product
  // Intelligence's own Head Report).
  const leadingOu = text.match(/^ou\s+(.+?),\s*ou,?\s+(.+)$/i);
  if (leadingOu) return [leadingOu[1].trim(), leadingOu[2].trim()];

  // Pattern 2: "<Verb> <A> ou <same Verb> <B>" — the sentence's own first
  // word (its verb) reappears immediately after " ou ", e.g. "Explique o
  // Head ou explique por que ele ainda não está disponível." Requires the
  // exact same leading word to repeat — never merely the word "ou"
  // appearing somewhere in the sentence.
  const firstWord = text.match(/^(\S+)\s+/);
  if (firstWord) {
    const verb = firstWord[1];
    const escapedVerb = verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const repeatedVerb = text.match(new RegExp(`^${escapedVerb}\\s+(.+?)\\s+ou\\s+${escapedVerb}\\b\\s*(.+)$`, "i"));
    if (repeatedVerb) return [`${verb} ${repeatedVerb[1]}`.trim(), `${verb} ${repeatedVerb[2]}`.trim()];
  }

  return null;
}

/**
 * Every criterion is either a verbatim substring of recommendedAction (only
 * ever split, never reworded or extended) or the finding's own verbatim
 * problem text — nothing here is inferred or invented. A compound
 * recommendation with a safely-detected alternative structure becomes two
 * atomic, independently-verifiable criteria joined by an explicit "; OU"
 * instead of one criterion repeating the whole "ou X, ou Y" text — the
 * exact gap FASE 7B identified. When no safe alternative structure is
 * found, the single-criterion fallback is unchanged from before.
 */
export function deriveAcceptanceCriteria(recommendedAction: string, finding: ConsolidatedFinding | undefined): string[] | null {
  if (recommendedAction === NO_RECOMMENDATION_SENTINEL) return null;

  const alternatives = splitIntoAlternatives(recommendedAction.trim());
  const criteria: string[] = alternatives
    ? [
        `O comportamento recomendado passa a estar implementado (alternativa aceitável 1 de 2): ${alternatives[0]}; OU`,
        `O comportamento recomendado passa a estar implementado (alternativa aceitável 2 de 2): ${alternatives[1]}`,
      ]
    : [`O comportamento recomendado passa a estar implementado: ${recommendedAction}`];

  if (finding?.finding) {
    criteria.push(`O problema a seguir deixa de ocorrer numa nova Evaluation Mission sobre a mesma área: ${finding.finding}`);
  }
  return criteria;
}

/**
 * Derives an Implementation Task from an APPROVED Recommendation — never
 * persisted, never re-interpreted by an agent. Every field is either copied
 * verbatim from the Recommendation/Head or read from the same run's own
 * FinalEvaluationReport via the existing findingIndex link.
 */
export function buildImplementationTask(
  recommendation: Pick<
    Recommendation,
    "id" | "missionRunId" | "findingIndex" | "title" | "summary" | "recommendedAction" | "impact" | "confidence"
  >,
  missionRun: { input: unknown; report: unknown },
): ImplementationTask {
  const input = missionRun.input as unknown as EvaluationMissionInput;
  const report = missionRun.report as unknown as FinalEvaluationReport | null;
  const finding = report?.findings[recommendation.findingIndex];
  const targetLabel = input.target.name ?? input.target.url;

  return {
    title: recommendation.title,
    recommendationId: recommendation.id,
    missionRunId: recommendation.missionRunId,
    targetLabel,
    context: `Esta tarefa nasce da avaliação de "${targetLabel}", cujo objetivo era: ${input.objective} (tarefa avaliada: ${input.task}).`,
    problem: finding?.finding ?? recommendation.summary,
    evidences: (finding?.sources ?? []).map((s) => ({ agentId: s.agentId, evidence: s.evidence })),
    impact: recommendation.impact,
    confidence: recommendation.confidence,
    agents: finding?.sources.map((s) => s.agentId) ?? [],
    recommendedAction: recommendation.recommendedAction,
    acceptanceCriteria: deriveAcceptanceCriteria(recommendation.recommendedAction, finding),
  };
}

/** The plain-text form meant to be copied verbatim into Claude Code or handed to a developer. */
export function formatImplementationTaskAsText(task: ImplementationTask): string {
  const lines: string[] = ["IMPLEMENTATION TASK", "", "Título", task.title, "", "Contexto", task.context, "", "Problema", task.problem, ""];

  lines.push("Evidências");
  if (task.evidences.length === 0) {
    lines.push("Nenhuma evidência adicional registrada.");
  } else {
    for (const e of task.evidences) lines.push(`- [${e.agentId}] ${e.evidence}`);
  }
  lines.push("");

  lines.push("Impacto", task.impact ?? "Não informado", "");
  lines.push("Confiança", task.confidence ?? "Não informado", "");
  lines.push("Identificado por", task.agents.join(" + ") || "—", "");
  lines.push("Recomendação", task.recommendedAction, "");

  lines.push("Critérios de aceite");
  if (task.acceptanceCriteria === null) {
    lines.push(
      "Não foi possível derivar critérios de aceite específicos a partir dos dados desta avaliação — revise a recomendação acima manualmente.",
    );
  } else {
    task.acceptanceCriteria.forEach((criterion, index) => lines.push(`${index + 1}. ${criterion}`));
  }

  return lines.join("\n");
}
