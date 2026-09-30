import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/button";
import { HeadReportSection } from "@/components/head-report-section";
import { listAgents } from "@/services/agents";
import { getLatestMissionRun, listMissionRuns } from "@/services/evaluation-orchestrator";
import { listRecommendations, getRecommendationAgents } from "@/services/recommendations";
import { approveRecommendationAction, ignoreRecommendationAction } from "./actions";
import { headEmptyMessage, countRecommendationsByRun } from "./product-intelligence-helpers";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { HeadReport } from "@/core/findings/head-report";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { Recommendation } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "Executando",
  COMPLETED: "Concluída",
  BLOCKED: "Bloqueada",
  FAILED: "Falhou",
};

function RecommendationCard({
  recommendation,
  agents,
}: {
  recommendation: Recommendation;
  agents: string[];
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{recommendation.title}</p>
        {recommendation.impact ? (
          <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
            {recommendation.impact}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm">{recommendation.summary}</p>
      <p className="mt-2 text-xs text-muted">Encontrado por: {agents.join(" + ") || "—"}</p>
      <p className="mt-2 text-sm">
        <span className="text-xs text-muted">Recomendação: </span>
        {recommendation.recommendedAction}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Link href={`/product-intelligence/recommendations/${recommendation.id}`} className="text-xs text-muted underline">
          Ver detalhes
        </Link>
        {recommendation.status === "PENDING" ? (
          <>
            <form action={approveRecommendationAction.bind(null, recommendation.id)}>
              <Button type="submit" variant="secondary" className="text-xs">
                Aprovar recomendação
              </Button>
            </form>
            <form action={ignoreRecommendationAction.bind(null, recommendation.id)}>
              <Button type="submit" variant="secondary" className="text-xs">
                Ignorar recomendação
              </Button>
            </form>
          </>
        ) : recommendation.status === "APPROVED" ? (
          <>
            <span className="text-xs text-muted">✓ Aprovada</span>
            <Link
              href={`/product-intelligence/recommendations/${recommendation.id}/task`}
              className="text-xs text-muted underline"
            >
              Ver tarefa de implementação
            </Link>
          </>
        ) : (
          <span className="text-xs text-muted">Ignorado</span>
        )}
      </div>
    </div>
  );
}

export default async function ProductIntelligencePage() {
  const [agents, latestRun, recommendations, missionRuns] = await Promise.all([
    listAgents(),
    getLatestMissionRun(),
    listRecommendations(),
    listMissionRuns(),
  ]);

  const latestInput = latestRun?.input as unknown as EvaluationMissionInput | undefined;
  const latestReport = latestRun?.report as unknown as FinalEvaluationReport | null | undefined;
  const latestHead = latestRun?.headReport as unknown as HeadReport | null | undefined;

  const pending = recommendations.filter((r) => r.status === "PENDING");
  const approved = recommendations.filter((r) => r.status === "APPROVED");
  const ignored = recommendations.filter((r) => r.status === "IGNORED");

  const decisionCountsByRun = countRecommendationsByRun(recommendations);

  return (
    <>
      <PageHeader
        title="Product Intelligence"
        description="A equipe avaliou seu produto. Veja o que aconteceu e decida o que vale melhorar."
        action={
          <Link
            href="/test-lab#evaluation-mission"
            className="inline-flex items-center justify-center rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Nova avaliação
          </Link>
        }
      />
      <div className="flex flex-col gap-8 px-8 py-8">
        <section className="rounded-md border border-border p-4">
          {latestRun ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>
                Última avaliação: <span className="font-medium">{latestInput?.target.name ?? latestInput?.target.url}</span>
              </span>
              <span className="text-xs text-muted">{STATUS_LABEL[latestRun.status] ?? latestRun.status}</span>
              <span className="text-xs text-muted">{latestInput?.requestedAgents.length ?? 0} especialista(s)</span>
              <span className="text-xs text-muted">{pending.length} recomendação(ões) pendente(s)</span>
              <Link href={`/test-lab/missions/${latestRun.id}`} className="text-xs text-muted underline">
                Ver missão
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted">Nenhuma avaliação foi executada ainda.</p>
          )}
        </section>

        <HeadReportSection head={latestHead} emptyMessage={headEmptyMessage(latestRun)} />

        <section>
          <p className="text-sm font-medium">Equipe</p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {agents.map((agent) => {
              const coverageEntry = latestReport?.coverage.find((c) => c.agentId === agent.id);
              const lastStatus = coverageEntry
                ? `${coverageEntry.status}${coverageEntry.output ? ` · ${coverageEntry.output.status}` : ""}`
                : "—";
              return (
                <li key={agent.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="mt-0.5 text-sm text-muted">{agent.objective}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                    {lastStatus}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <p className="text-sm font-medium">Precisa de atenção</p>
          <div className="mt-3 flex flex-col gap-3">
            {pending.length === 0 ? (
              <EmptyState title="Nada pendente" description="Nenhuma recomendação está aguardando decisão." />
            ) : (
              pending.map((r) => (
                <RecommendationCard key={r.id} recommendation={r} agents={getRecommendationAgents(r)} />
              ))
            )}
          </div>
        </section>

        {approved.length > 0 ? (
          <section>
            <p className="text-sm font-medium">Aprovados</p>
            <div className="mt-3 flex flex-col gap-3">
              {approved.map((r) => (
                <RecommendationCard key={r.id} recommendation={r} agents={getRecommendationAgents(r)} />
              ))}
            </div>
          </section>
        ) : null}

        {ignored.length > 0 ? (
          <section>
            <p className="text-sm font-medium">Ignorados</p>
            <div className="mt-3 flex flex-col gap-3">
              {ignored.map((r) => (
                <RecommendationCard key={r.id} recommendation={r} agents={getRecommendationAgents(r)} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <p className="text-sm font-medium">Histórico</p>
          <div className="mt-3 flex flex-col gap-3">
            {missionRuns.length === 0 ? (
              <EmptyState title="Nenhuma avaliação ainda" description="As avaliações executadas aparecerão aqui." />
            ) : (
              missionRuns.map((run) => {
                const input = run.input as unknown as EvaluationMissionInput;
                const report = run.report as unknown as FinalEvaluationReport | null;
                const counts = decisionCountsByRun.get(run.id) ?? { pending: 0, approved: 0, ignored: 0 };
                return (
                  <div key={run.id} className="rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{input.target.name ?? input.target.url}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {run.createdAt.toLocaleString("en-US")} · {input.requestedAgents.length} especialista(s) ·{" "}
                          {report?.findings.length ?? 0} finding(s)
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
                        {STATUS_LABEL[run.status] ?? run.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {counts.pending} pendente(s) · {counts.approved} aprovado(s) · {counts.ignored} ignorado(s)
                    </p>
                    <Link href={`/test-lab/missions/${run.id}`} className="mt-3 inline-block text-xs text-muted underline">
                      Ver avaliação
                    </Link>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}
