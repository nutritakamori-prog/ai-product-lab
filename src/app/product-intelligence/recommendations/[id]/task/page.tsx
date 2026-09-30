import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getRecommendation } from "@/services/recommendations";
import { buildImplementationTask, formatImplementationTaskAsText } from "@/services/implementation-task";
import { CopyTaskButton } from "./copy-task-button";

export const dynamic = "force-dynamic";

/**
 * Only reachable for an APPROVED Recommendation — a PENDING one has no
 * decision behind it yet, and an IGNORED one must never produce a task (see
 * FASE 7A's own state rule). Enforced here, not just by hiding the link, so
 * visiting the URL directly can't bypass it either.
 */
export default async function ImplementationTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recommendation = await getRecommendation(id);
  if (!recommendation || recommendation.status !== "APPROVED") notFound();

  const task = buildImplementationTask(recommendation, recommendation.missionRun);
  const taskText = formatImplementationTaskAsText(task);

  return (
    <>
      <PageHeader
        title="Implementation Task"
        description="Orientação estruturada para implementação manual — o LAB não executa esta mudança."
      />
      <div className="flex flex-col gap-6 px-8 py-8">
        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Identificação</p>
          <p className="mt-1 text-sm font-medium">{task.title}</p>
          <p className="mt-1 text-xs text-muted">
            <Link href={`/product-intelligence/recommendations/${task.recommendationId}`} className="underline">
              Ver recomendação de origem
            </Link>
            {" · "}
            <Link href={`/test-lab/missions/${task.missionRunId}`} className="underline">
              Ver Mission de origem
            </Link>
          </p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Contexto</p>
          <p className="mt-1 text-sm">{task.context}</p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Problema</p>
          <p className="mt-1 text-sm">{task.problem}</p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Evidências</p>
          {task.evidences.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Nenhuma evidência adicional registrada.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {task.evidences.map((e, index) => (
                <div key={`${e.agentId}-${index}`} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <p className="text-xs text-muted">{e.agentId}</p>
                  <p className="mt-1 text-sm">{e.evidence}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 gap-4">
          <section className="rounded-md border border-border p-4">
            <p className="text-xs text-muted">Impacto</p>
            <p className="mt-1 text-sm">{task.impact ?? "Não informado"}</p>
          </section>
          <section className="rounded-md border border-border p-4">
            <p className="text-xs text-muted">Confiança</p>
            <p className="mt-1 text-sm">{task.confidence ?? "Não informado"}</p>
          </section>
        </div>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Identificado por</p>
          <p className="mt-1 text-sm">{task.agents.join(" + ") || "—"}</p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Recomendação</p>
          <p className="mt-1 text-sm">{task.recommendedAction}</p>
        </section>

        <section className="rounded-md border border-border p-4">
          <p className="text-xs text-muted">Critérios de aceite</p>
          {task.acceptanceCriteria === null ? (
            <p className="mt-1 text-sm text-muted">
              Não foi possível derivar critérios de aceite específicos a partir dos dados desta avaliação — revise a
              recomendação acima manualmente.
            </p>
          ) : (
            <ol className="mt-1 flex flex-col gap-1 text-sm">
              {task.acceptanceCriteria.map((criterion, index) => (
                <li key={index}>
                  {index + 1}. {criterion}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex items-center gap-2">
          <CopyTaskButton text={taskText} />
        </section>
      </div>
    </>
  );
}
