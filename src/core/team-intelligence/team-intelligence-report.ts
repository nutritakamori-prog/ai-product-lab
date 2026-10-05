import type { TeamIntelligenceSummary } from "./team-intelligence";
import { RECURRENCE_MIN, ADD_AGENT_MIN, type TeamArchitectReport } from "@/core/team-architect/team-architect";

/**
 * FASE 12A — Team Intelligence Report.
 *
 * This is NOT a third analysis engine. Every count and recommendation here
 * is computed elsewhere already: Team Intelligence (FASE 10C,
 * team-intelligence.ts) describes what the data show; Team Architect (FASE
 * 10D, team-architect.ts) interprets that into evidence-based
 * recommendations and explicit admissions of insufficient evidence. This
 * module only composes those two already-complete reports into the one
 * thing neither of them produces on its own: an overall confidence level
 * and a short, honest, real-numbers-only summary — exactly what FASE 12A's
 * own brief asks a human be able to read first ("Como está nossa equipe de
 * agentes hoje?").
 *
 * Pure and synchronous: no database access, no LLM call, no new counting or
 * detection logic. If a number is wrong here, the bug is in team-
 * intelligence.ts or team-architect.ts, never in this file.
 */

export type TeamIntelligenceConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

/**
 * Real, raw mission counts by status — the one thing neither
 * TeamIntelligenceSummary nor TeamArchitectReport carries on its own
 * (TeamIntelligenceSummary only ever loads COMPLETED runs, by design — see
 * its own service layer's doc comment). Supplied by the caller
 * (src/services/team-intelligence-report.ts), which already has to query
 * EvaluationMissionRun anyway.
 */
export interface TeamEvidenceCounts {
  missionsAnalyzed: number;
  completedMissions: number;
  failedMissions: number;
  blockedMissions: number;
  /** Derived, not queried twice: one Recommendation exists per real finding (see recommendations.ts), so this is recommendationsAnalyzed + any finding evidenceGaps already knows has no Recommendation yet. */
  findingsAnalyzed: number;
  recommendationsAnalyzed: number;
}

export interface TeamIntelligenceReport {
  generatedAt: string;
  confidence: TeamIntelligenceConfidence;
  summary: string;
  evidence: TeamEvidenceCounts;
  team: TeamIntelligenceSummary;
  architect: TeamArchitectReport;
}

export function buildEvidenceCounts(
  team: TeamIntelligenceSummary,
  missionCountsByStatus: { completed: number; failed: number; blocked: number; running: number },
): TeamEvidenceCounts {
  const { completed, failed, blocked, running } = missionCountsByStatus;
  const recommendationsAnalyzed = team.recommendationLifecycle.totalRecommendations;
  return {
    missionsAnalyzed: completed + failed + blocked + running,
    completedMissions: completed,
    failedMissions: failed,
    blockedMissions: blocked,
    findingsAnalyzed: recommendationsAnalyzed + team.evidenceGaps.findingsWithoutRecommendation.length,
    recommendationsAnalyzed,
  };
}

/**
 * Confidence is about SAMPLE SIZE only — never about whether the sample
 * happens to contain findings/signals. A team with 5 clean, boring
 * completed missions and zero signals is still HIGH confidence ("we looked
 * hard and found nothing notable"); a team with 1 dramatic mission is still
 * LOW ("too little data to generalize from, however interesting it looks").
 * Reuses team-architect.ts's own RECURRENCE_MIN/ADD_AGENT_MIN boundaries
 * rather than inventing new thresholds (section 12 of the brief: "mantenha-
 * os simples e documentados") — those are already the exact bars the
 * Architect itself requires before treating a pattern as more than
 * anecdotal, so the overall report's confidence should never claim more
 * certainty than the Architect's own recommendations already lean on.
 *
 * Takes `evaluatedMissions` — COMPLETED + BLOCKED only, never raw
 * `missionsAnalyzed` — found live, running this against the real LAB
 * database: a top-level FAILED run (the orchestration itself threw, e.g. the
 * Task Planner's own model call hit a quota error) never reaches the agent
 * loop at all (see evaluation-orchestrator.ts) — it is zero evidence about
 * how the team behaves, not weak evidence. 33 of 37 real missions in this
 * project's own history are exactly this case; counting them would have
 * claimed HIGH confidence from a dataset that barely ever reached the
 * agents it's supposed to be evidence about. A BLOCKED run, by contrast,
 * DID reach every requested agent (each one simply didn't return SUCCESS) —
 * that is real, if disappointing, evidence about the team, so it counts.
 */
export function computeConfidence(evaluatedMissions: number): TeamIntelligenceConfidence {
  if (evaluatedMissions === 0) return "INSUFFICIENT";
  if (evaluatedMissions < RECURRENCE_MIN) return "LOW";
  if (evaluatedMissions < ADD_AGENT_MIN) return "MEDIUM";
  return "HIGH";
}

function buildSummary(team: TeamIntelligenceSummary, evidence: TeamEvidenceCounts, architect: TeamArchitectReport, confidence: TeamIntelligenceConfidence): string {
  const { activity } = team;
  const teamLine = `A equipe possui ${activity.totalAgents} agente(s) (${activity.enabledAgents} habilitado(s), ${activity.activeAgents} com atividade registrada).`;

  if (confidence === "INSUFFICIENT") {
    // Honest even when there WERE attempts: a project can show only FAILED
    // missions (the orchestration itself never reached the agents — see
    // computeConfidence's own doc comment) while still having zero real
    // evidence about team behavior. Never silently implies nothing was
    // attempted when something was, just unsuccessfully before reaching
    // evaluation.
    const attemptsNote =
      evidence.missionsAnalyzed > 0
        ? ` (${evidence.missionsAnalyzed} tentativa(s) registrada(s), mas nenhuma chegou a avaliar os agentes — ${evidence.failedMissions} falharam antes disso)`
        : "";
    return `${teamLine} Nenhuma missão chegou a avaliar os agentes ainda neste projeto${attemptsNote} — evidência insuficiente para concluir sobre cobertura, lacunas ou sobreposições.`;
  }

  const missionLine =
    `Foram analisadas ${evidence.missionsAnalyzed} missão(ões) (${evidence.completedMissions} concluída(s), ${evidence.failedMissions} falha(s)` +
    `${evidence.blockedMissions > 0 ? `, ${evidence.blockedMissions} bloqueada(s)` : ""}), com ${evidence.findingsAnalyzed} finding(s) e ` +
    `${evidence.recommendationsAnalyzed} recommendation(s) analisados.`;

  const signalCount = architect.recommendations.length;
  const insufficientCount = architect.insufficientEvidence.length;
  const signalsLine =
    signalCount === 0
      ? `Nenhum sinal com evidência suficiente para um achado estrutural ainda${insufficientCount > 0 ? ` (${insufficientCount} área(s) observada(s), mas sem evidência suficiente).` : "."}`
      : `${signalCount} sinal(is) com evidência suficiente (${architect.recommendations.map((r) => r.type).join(", ")})${insufficientCount > 0 ? `, além de ${insufficientCount} área(s) ainda sem evidência suficiente para concluir.` : "."}`;

  const confidenceLine =
    confidence === "LOW"
      ? "A amostra ainda é pequena — qualquer sinal abaixo deve ser lido com cautela."
      : confidence === "MEDIUM"
        ? "A amostra já permite alguns sinais úteis, mas ainda é limitada."
        : "A amostra é grande o suficiente para os sinais abaixo refletirem um padrão real, não um evento isolado.";

  return [teamLine, missionLine, signalsLine, confidenceLine].join(" ");
}

/** The one entry point. Pure, synchronous. `now` is a parameter (never `new Date()` called internally) so this stays fully deterministic and testable, like every other pure function in core/. */
export function buildTeamIntelligenceReport(
  team: TeamIntelligenceSummary,
  architect: TeamArchitectReport,
  missionCountsByStatus: { completed: number; failed: number; blocked: number; running: number },
  now: Date,
): TeamIntelligenceReport {
  const evidence = buildEvidenceCounts(team, missionCountsByStatus);
  const confidence = computeConfidence(evidence.completedMissions + evidence.blockedMissions);
  const summary = buildSummary(team, evidence, architect, confidence);
  return { generatedAt: now.toISOString(), confidence, summary, evidence, team, architect };
}
