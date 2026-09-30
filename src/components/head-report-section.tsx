import type { HeadReport } from "@/core/findings/head-report";

/**
 * The Head's own synthesis, rendered exactly the same way wherever a run's
 * headReport can be shown (Product Intelligence's latest run, and now a
 * past Mission's own page) — same stored JSON field, same deterministic
 * Head, no second rendering of the same data invented per page.
 */
export function HeadReportSection({ head, emptyMessage }: { head: HeadReport | null | undefined; emptyMessage: string }) {
  return (
    <section>
      <p className="text-sm font-medium">Head Report</p>
      <p className="mt-0.5 text-xs text-muted">Head — a síntese da equipe sobre esta avaliação.</p>
      <div className="mt-3 rounded-md border border-border p-4">
        {head ? (
          <>
            <p className="text-sm">{head.summary}</p>
            {head.totalFindings > 0 ? (
              <p className="mt-2 text-xs text-muted">
                {head.problems} problema(s) · {head.opportunities} oportunidade(s) · {head.observations} observação(ões)
                {head.hasConvergence ? " · há convergência entre especialistas" : ""}
              </p>
            ) : null}
            {head.mainRecommendation ? (
              <p className="mt-3 text-sm">
                <span className="text-xs text-muted">Principal recomendação: </span>
                {head.mainRecommendation}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
}
