import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/button";
import { getRecommendation, getRecommendationAgents } from "@/services/recommendations";
import { approveRecommendationAction, ignoreRecommendationAction } from "../../actions";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

export const dynamic = "force-dynamic";

export default async function RecommendationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recommendation = await getRecommendation(id);
  if (!recommendation) notFound();

  const report = recommendation.missionRun.report as unknown as FinalEvaluationReport | null;
  const finding = report?.findings[recommendation.findingIndex];
  const agents = getRecommendationAgents(recommendation);

  return (
    <>
      <PageHeader title={recommendation.title} description={`Recomendação · ${recommendation.status}`} />
      <div className="flex flex-col gap-6 px-8 py-8">
        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Problema</p>
          <p className="mt-1 text-sm">{recommendation.summary}</p>
        </section>

        {finding ? (
          <section className="rounded-md border border-border p-4">
            <p className="text-xs text-muted">Evidência</p>
            <div className="mt-2 flex flex-col gap-3">
              {finding.sources.map((source) => (
                <div key={source.agentId} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <p className="text-xs text-muted">{source.agentId}</p>
                  <p className="mt-1 text-sm">{source.evidence}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Agentes envolvidos</p>
          <p className="mt-1 text-sm">{agents.join(" + ") || "—"}</p>
        </section>

        <div className="grid grid-cols-2 gap-4">
          <section className="rounded-md border border-border p-4">
            <p className="text-xs text-muted">Impacto</p>
            <p className="mt-1 text-sm">{recommendation.impact ?? "—"}</p>
          </section>
          <section className="rounded-md border border-border p-4">
            <p className="text-xs text-muted">Confiança</p>
            <p className="mt-1 text-sm">{recommendation.confidence ?? "—"}</p>
          </section>
        </div>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Análise do Head</p>
          <p className="mt-1 text-sm">{recommendation.whyItMatters}</p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Recomendação</p>
          <p className="mt-1 text-sm">{recommendation.recommendedAction}</p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Ação</p>
          {recommendation.status === "PENDING" ? (
            <div className="mt-2 flex items-center gap-2">
              <form action={approveRecommendationAction.bind(null, recommendation.id)}>
                <Button type="submit" variant="primary">
                  Aprovar recomendação
                </Button>
              </form>
              <form action={ignoreRecommendationAction.bind(null, recommendation.id)}>
                <Button type="submit" variant="secondary">
                  Ignorar recomendação
                </Button>
              </form>
            </div>
          ) : (
            <p className="mt-1 text-sm">
              {recommendation.status === "APPROVED"
                ? "Aprovado — a decisão foi registrada. Isso não executa nenhuma mudança: uma Implementation Task foi derivada como orientação para implementação manual."
                : "Ignorado — o registro permanece no histórico."}
            </p>
          )}
        </section>

        {recommendation.status === "APPROVED" ? (
          <section className="rounded-md border border-border p-4">
            <p className="text-xs text-muted">Implementation Task</p>
            <p className="mt-1 text-sm">
              A recomendação acima foi transformada em uma tarefa de implementação estruturada, pronta para revisão e
              cópia manual (ex.: para o Claude Code).
            </p>
            <Link
              href={`/product-intelligence/recommendations/${recommendation.id}/task`}
              className="mt-3 inline-flex items-center justify-center rounded-md border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-foreground/[0.04]"
            >
              Ver tarefa de implementação
            </Link>
          </section>
        ) : null}
      </div>
    </>
  );
}
