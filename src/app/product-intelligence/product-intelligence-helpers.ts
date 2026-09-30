/**
 * Why a given run has no Head Report to show — extracted so the "no head"
 * message can never regress into implying no evaluation has ever run when
 * one clearly has (the exact contradiction Finding 1 identified): a
 * FAILED/RUNNING run never produced a report to synthesize, while a
 * COMPLETED/BLOCKED run with no headReport is a legacy run that predates
 * the Head feature. Neither case is masked — both say plainly there is no
 * Head for that specific run, and why.
 */
export function headEmptyMessage(run: { status: string } | null | undefined): string {
  if (!run) return "Nenhuma avaliação foi executada ainda — não há Head Report para gerar.";
  if (run.status === "RUNNING" || run.status === "FAILED") {
    return "A última avaliação ainda não produziu um relatório — não há Head Report para ela.";
  }
  return "Esta avaliação foi executada antes desta funcionalidade existir — não há Head Report para ela.";
}

export interface RecommendationDecisionCounts {
  pending: number;
  approved: number;
  ignored: number;
}

/**
 * Groups already-fetched Recommendation rows by their own missionRunId —
 * the same FK the Mission page already reads from (see
 * listRecommendationsForRun). No new query, no new status system: this is
 * just a lookup over data the History section already has in hand via
 * listRecommendations().
 */
export function countRecommendationsByRun(
  recommendations: { missionRunId: string; status: string }[],
): Map<string, RecommendationDecisionCounts> {
  const counts = new Map<string, RecommendationDecisionCounts>();
  for (const r of recommendations) {
    const entry = counts.get(r.missionRunId) ?? { pending: 0, approved: 0, ignored: 0 };
    if (r.status === "PENDING") entry.pending += 1;
    else if (r.status === "APPROVED") entry.approved += 1;
    else if (r.status === "IGNORED") entry.ignored += 1;
    counts.set(r.missionRunId, entry);
  }
  return counts;
}
