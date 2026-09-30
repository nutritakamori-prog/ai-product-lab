import type { AgentEvaluationOutcome, MissionEvaluationResult } from "@/services/evaluation-orchestrator";
import type { ConsolidatedFinding } from "@/core/findings/mission-evaluation-report";
import type { RecommendationStatus } from "@/generated/prisma/client";
import { allAgentsUnevaluated, hasInconclusiveOrUnexecutedAgents } from "./evaluation-mission-helpers";

const DECISION_LABEL: Record<RecommendationStatus, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  IGNORED: "Ignorado",
};

/**
 * The FinalEvaluationReport rendering — extracted from the Evaluation
 * Mission form so both the form (previously, for an inline result) and
 * /test-lab/missions/[id] (a persisted run's own page) render a Mission's
 * outcome exactly the same way. Nothing about a Finding's own shape is
 * reinvented here — this is a straight read of the existing
 * FinalEvaluationReport/ConsolidatedFinding/AgentEvaluationOutcome types.
 */

type Report = MissionEvaluationResult["report"];

/**
 * One finding, one discreet card — sources are shown individually (never
 * merged into a single impact/recommendation/confidence) because two
 * agents can legitimately disagree even about the same underlying problem
 * (see mission-evaluation-report.ts's own comments).
 */
function FindingCard({ finding, decisionStatus }: { finding: ConsolidatedFinding; decisionStatus?: RecommendationStatus }) {
  const agents = finding.sources.map((source) => source.agentId);

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{finding.finding}</p>
        <div className="flex shrink-0 items-center gap-2">
          {decisionStatus ? (
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
              {DECISION_LABEL[decisionStatus]}
            </span>
          ) : null}
          {finding.duplicated ? (
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
              Confirmado por {agents.length} agentes
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">Encontrado por: {agents.join(", ")}</p>

      <div className="mt-3 flex flex-col gap-3">
        {finding.sources.map((source) => (
          <div key={source.agentId} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <p className="text-xs text-muted">{source.agentId}</p>
            <p className="mt-1 text-sm">
              <span className="text-xs text-muted">Evidence: </span>
              {source.evidence}
            </p>
            {source.recommendation ? (
              <p className="mt-1 text-sm">
                <span className="text-xs text-muted">Recommendation: </span>
                {source.recommendation}
              </p>
            ) : null}
            <div className="mt-1 flex gap-3 text-xs text-muted">
              {source.impact ? <span>Impact: {source.impact}</span> : null}
              <span>Confidence: {source.confidence}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverageList({ coverage }: { coverage: AgentEvaluationOutcome[] }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-xs text-muted">Cobertura dos agentes</p>
      <p className="mt-1 text-xs text-muted">
        NO_FINDING: nada de errado foi confirmado. UNCONFIRMED: algo pareceu estranho, mas sem evidência
        suficiente. BLOCKED: o agente não chegou a ser executado. FAILED: o agente rodou mas não retornou um
        resultado válido.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {coverage.map((entry) => (
          <li key={entry.agentId} className="text-sm">
            <div className="flex items-center justify-between">
              <span>{entry.agentId}</span>
              <span className="text-xs text-muted">
                {entry.status}
                {entry.output ? ` · ${entry.output.status}` : ""}
              </span>
            </div>
            {/* error already exists on AgentEvaluationOutcome for BLOCKED/FAILED
                — surfaced here so the user can tell WHY, instead of a bare
                status with no explanation (found during self-evaluation). */}
            {entry.error ? <p className="mt-0.5 text-xs text-muted">{entry.error}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Mission and its Recommendations are the same source of truth read
 * twice — this is only a lookup over rows already fetched via
 * listRecommendationsForRun, keyed by the same findingIndex that already
 * links a Recommendation back to report.findings. No new status system, no
 * duplicated table.
 */
export function MissionReport({
  report,
  decisions,
}: {
  report: Report;
  decisions?: { findingIndex: number; status: RecommendationStatus }[];
}) {
  const decisionByFindingIndex = new Map((decisions ?? []).map((d) => [d.findingIndex, d.status]));
  const pending = (decisions ?? []).filter((d) => d.status === "PENDING").length;
  const approved = (decisions ?? []).filter((d) => d.status === "APPROVED").length;
  const ignored = (decisions ?? []).filter((d) => d.status === "IGNORED").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border p-4">
        <p className="text-xs text-muted">Mission</p>
        <p className="mt-1 text-sm font-medium">{report.mission.target.name ?? report.mission.target.url}</p>
        {report.mission.target.name ? <p className="text-xs text-muted">{report.mission.target.url}</p> : null}
        <p className="mt-2 text-sm">{report.mission.objective}</p>
        <p className="mt-1 text-xs text-muted">{report.mission.task}</p>
      </div>

      {decisions && decisions.length > 0 ? (
        <p className="text-sm">
          Findings: {decisions.length} finding(s) · {pending} pendente(s) · {approved} aprovado(s) ·{" "}
          {ignored} ignorado(s)
        </p>
      ) : null}

      {report.findings.length === 0 ? (
        <div className="rounded-md border border-border p-4">
          {allAgentsUnevaluated(report.coverage) ? (
            // No requested agent reached a real SUCCESS — never lead with
            // "no confirmed problems", which reads as a completed, clean
            // evaluation when none actually happened.
            <p className="text-sm">
              A avaliação não pôde ser concluída — nenhum agente solicitado chegou a produzir um resultado.
            </p>
          ) : (
            <>
              <p className="text-sm">Não foram encontrados problemas confirmados nesta avaliação.</p>
              {hasInconclusiveOrUnexecutedAgents(report.coverage) ? (
                <p className="mt-1 text-xs text-muted">
                  Alguns agentes podem ter ficado inconclusivos ou não executados.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {report.findings.map((finding, index) => (
            <FindingCard key={index} finding={finding} decisionStatus={decisionByFindingIndex.get(index)} />
          ))}
        </div>
      )}

      <CoverageList coverage={report.coverage} />
    </div>
  );
}
