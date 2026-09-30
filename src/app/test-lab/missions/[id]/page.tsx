import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { HeadReportSection } from "@/components/head-report-section";
import { getMissionRun } from "@/services/evaluation-orchestrator";
import { listRecommendationsForRun } from "@/services/recommendations";
import { MissionReport } from "@/app/test-lab/mission-report";
import { headEmptyMessage } from "@/app/product-intelligence/product-intelligence-helpers";
import { RerunMissionButton } from "./rerun-button";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { HeadReport } from "@/core/findings/head-report";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  RUNNING: "Executando",
  COMPLETED: "Concluída",
  BLOCKED: "Bloqueada",
  FAILED: "Falhou",
};

const EXECUTOR_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  GEMINI: "Gemini",
  CLAUDE_CODE: "Claude Code (execução externa)",
  MOCK: "Mock",
};

export default async function MissionRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getMissionRun(id);
  if (!run) notFound();

  // Written by createAndRunMissionEvaluation using exactly these shapes —
  // see src/services/evaluation-orchestrator.ts. Cast defensively rather
  // than trusting an untyped Json column blindly.
  const input = run.input as unknown as EvaluationMissionInput;
  const report = run.report as unknown as FinalEvaluationReport | null;
  const head = run.headReport as unknown as HeadReport | null;
  const recommendations = await listRecommendationsForRun(run.id);

  return (
    <>
      <PageHeader
        title={input.target.name ?? input.target.url}
        description={`Evaluation Mission · ${STATUS_LABEL[run.status] ?? run.status}`}
      />
      <div className="flex flex-col gap-8 px-8 py-8">
        <p className="text-xs text-muted">
          Executor: {run.provider ? (EXECUTOR_LABEL[run.provider] ?? run.provider) : "desconhecido (Run anterior a este campo)"}
          {run.model ? ` · Modelo: ${run.model}` : ""}
        </p>

        <HeadReportSection head={head} emptyMessage={headEmptyMessage(run)} />

        {report ? (
          <section>
            <MissionReport report={report} decisions={recommendations} />
          </section>
        ) : run.status === "RUNNING" ? (
          <section className="rounded-md border border-border p-4">
            <p className="text-sm">Esta missão ainda está em execução.</p>
          </section>
        ) : (
          <section className="rounded-md border border-border p-4">
            <p className="text-sm">A execução falhou antes de produzir um relatório.</p>
            {run.error ? <p className="mt-1 text-xs text-muted">{run.error}</p> : null}
          </section>
        )}

        <section>
          <RerunMissionButton missionRunId={run.id} provider={run.provider} />
        </section>
      </div>
    </>
  );
}
