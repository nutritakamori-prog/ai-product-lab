"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { Panel } from "./panel";
import { confirmQgActionAction, runQgCommandAction, type QgCommandActionResult } from "./qg-command-actions";
import { QG_COMMANDS, type QgActionId } from "@/core/qg-command-router/qg-command-router";
import type {
  AgentActivityResult,
  ApproveRecommendationCandidatesResult,
  CreateImplementationCandidatesResult,
  CreateValidationCandidatesResult,
  IgnoreRecommendationCandidatesResult,
  LastCycleResult,
  PendingRecommendationsResult,
  RecurringFindingsResult,
  TeamArchitectResult,
} from "@/services/qg-command-router";

/**
 * FASE 11/12 — QG Runtime. QG -> Command Router -> existing LAB services ->
 * result -> QG, and now also QG -> CONFIRMAR -> executeQgAction -> QG.
 * Extracted out of qg-office.tsx (which only owns the Campus's own visual
 * Rooms/Desks) into its own self-contained console: all command input,
 * query results, action-candidate lists, and the confirm/cancel/execute
 * flow live here. Rendered once, inside the existing Command Center Room —
 * no new Room, no redesign.
 */

const ACTION_DESCRIPTION: Record<QgActionId, string> = {
  APPROVE_RECOMMENDATION: "Esta Recommendation será marcada como APPROVED.",
  IGNORE_RECOMMENDATION: "Esta Recommendation será marcada como IGNORED.",
  CREATE_IMPLEMENTATION: "Uma nova Implementation será criada e vinculada a esta Recommendation, com status PENDING.",
  CREATE_VALIDATION: "Uma nova Validation será criada para esta Implementation, com status PENDING — sem reteste associado ainda.",
};

type SelectCandidate = (action: QgActionId, targetId: string, title: string, impact: string | null, confidence: string | null) => void;

type ConfirmationState =
  | null
  | { status: "awaiting"; action: QgActionId; targetId: string; title: string; impact: string | null; confidence: string | null }
  | { status: "executing"; action: QgActionId; targetId: string; title: string }
  | { status: "done"; title: string; message: string; failed: boolean }
  | { status: "cancelled"; title: string };

export function CommandCenterConsole() {
  const [open, setOpen] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [commandResult, setCommandResult] = useState<QgCommandActionResult | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [isPending, startTransition] = useTransition();

  /** The Quick Action buttons call this with their own canonical phrase, so they run through the exact same matchCommand() + executeQgCommand() path as free text — never a shortcut that bypasses the Router. */
  function runCommand(text: string) {
    setLastCommand(text);
    setCommandResult(null);
    setConfirmation(null);
    setOpen(true);
    startTransition(async () => {
      const result = await runQgCommandAction(text);
      setCommandResult(result);
    });
  }

  function handleCommandSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!commandInput.trim()) return;
    runCommand(commandInput);
  }

  /** Never auto-selected — always the result of the user clicking one specific, already-rendered candidate (FASE 12 §8: "nunca escolher arbitrariamente"). */
  const selectCandidate: SelectCandidate = (action, targetId, title, impact, confidence) => {
    setConfirmation({ status: "awaiting", action, targetId, title, impact, confidence });
  };

  function cancelConfirmation() {
    if (confirmation?.status === "awaiting") {
      setConfirmation({ status: "cancelled", title: confirmation.title });
    }
  }

  function confirmAction() {
    if (!confirmation || confirmation.status !== "awaiting") return;
    const { action, targetId, title } = confirmation;
    setConfirmation({ status: "executing", action, targetId, title });
    startTransition(async () => {
      const result = await confirmQgActionAction(action, targetId);
      setConfirmation({ status: "done", title, message: result.message, failed: result.status === "ERROR" });
    });
  }

  function closePanel() {
    setOpen(false);
    setConfirmation(null);
  }

  return (
    <>
      <form onSubmit={handleCommandSubmit} className="mt-4 w-full">
        <label htmlFor="qg-command-input" className="sr-only">
          O que você quer investigar?
        </label>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm transition-colors focus-within:border-accent">
          <span className="text-muted" aria-hidden>
            &gt;
          </span>
          <input
            id="qg-command-input"
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="O que você quer investigar? Ex.: analise o último ciclo"
            className="w-full min-w-[9rem] flex-1 bg-transparent outline-none placeholder:text-muted"
          />
          <button type="submit" aria-label="Executar comando" className="text-muted transition-colors hover:text-accent">
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QG_COMMANDS.map((command) => (
          <button
            key={command.id}
            type="button"
            onClick={() => runCommand(command.phrases[0])}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-foreground"
          >
            {command.label}
          </button>
        ))}
      </div>

      {open ? (
        <Panel title="Command Center" onClose={closePanel}>
          {lastCommand ? <p className="text-xs text-muted">&gt; {lastCommand}</p> : null}
          <div className="mt-3 border-t border-border pt-3">
            {confirmation ? (
              <ConfirmationView state={confirmation} isPending={isPending} onConfirm={confirmAction} onCancel={cancelConfirmation} />
            ) : (
              <CommandResultView isPending={isPending} actionResult={commandResult} onSelectCandidate={selectCandidate} />
            )}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/** FASE 12 §3 — the dedicated "CONFIRMAR AÇÃO" box, plus the executing/done/cancelled states that follow it. Never executes on its own — only ever reached via a candidate's own button, only ever advances on an explicit click. */
function ConfirmationView({
  state,
  isPending,
  onConfirm,
  onCancel,
}: {
  state: NonNullable<ConfirmationState>;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (state.status === "awaiting") {
    return (
      <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-xs">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Confirmar ação</p>
        <p className="mt-2">{ACTION_DESCRIPTION[state.action]}</p>
        <div className="mt-3 rounded-md border border-border bg-background p-2">
          <p className="font-medium">&quot;{state.title}&quot;</p>
          {state.impact || state.confidence ? (
            <p className="mt-1 text-muted">
              {state.impact ? `Impacto: ${state.impact}` : null}
              {state.impact && state.confidence ? " · " : null}
              {state.confidence ? `Confiança: ${state.confidence}` : null}
            </p>
          ) : null}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Confirmando..." : "Confirmar"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "executing") {
    return <p className="text-xs font-semibold uppercase tracking-wide text-muted">PROCESSANDO...</p>;
  }

  if (state.status === "cancelled") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">CANCELADO</p>
        <p className="mt-2 text-xs text-muted">Nenhuma alteração foi feita em &quot;{state.title}&quot;.</p>
      </div>
    );
  }

  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${state.failed ? "text-red-600" : "text-emerald-600"}`}>
        {state.failed ? "NÃO FOI POSSÍVEL EXECUTAR" : "CONCLUÍDO"}
      </p>
      <p className="mt-2 text-xs text-muted">{state.message}</p>
    </div>
  );
}

/** FASE 11 §12 — PROCESSANDO while the Server Action runs, CONCLUÍDO with the real result once it resolves, or a short, non-technical NÃO FOI POSSÍVEL EXECUTAR message — never a stack trace. */
function CommandResultView({
  isPending,
  actionResult,
  onSelectCandidate,
}: {
  isPending: boolean;
  actionResult: QgCommandActionResult | null;
  onSelectCandidate: SelectCandidate;
}) {
  if (isPending || !actionResult) {
    return <p className="text-xs font-semibold uppercase tracking-wide text-muted">PROCESSANDO...</p>;
  }

  if (actionResult.status === "UNKNOWN_COMMAND") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-red-600">NÃO FOI POSSÍVEL EXECUTAR</p>
        <p className="mt-2 text-xs text-muted">Comando não reconhecido. Use um dos comandos das Quick Actions abaixo.</p>
      </div>
    );
  }

  if (actionResult.status === "ERROR") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-red-600">NÃO FOI POSSÍVEL EXECUTAR</p>
        <p className="mt-2 text-xs text-muted">{actionResult.message}</p>
      </div>
    );
  }

  const { result } = actionResult;
  if (result.type === "NO_ACTIVE_PROJECT") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">CONCLUÍDO</p>
        <p className="mt-2 text-xs text-muted">Nenhum projeto com Evaluation Missions encontrado ainda.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">CONCLUÍDO</p>
      <div className="mt-3">
        {result.type === "LAST_CYCLE" ? <LastCycleResultView result={result} /> : null}
        {result.type === "RECURRING_FINDINGS" ? <RecurringFindingsResultView result={result} /> : null}
        {result.type === "PENDING_RECOMMENDATIONS" ? <PendingRecommendationsResultView result={result} /> : null}
        {result.type === "AGENT_ACTIVITY" ? <AgentActivityResultView result={result} /> : null}
        {result.type === "TEAM_ARCHITECT" ? <TeamArchitectResultView result={result} /> : null}
        {result.type === "ACTION_CANDIDATES" && (result.action === "APPROVE_RECOMMENDATION" || result.action === "IGNORE_RECOMMENDATION") ? (
          <ApproveIgnoreCandidatesView result={result} onSelect={onSelectCandidate} />
        ) : null}
        {result.type === "ACTION_CANDIDATES" && result.action === "CREATE_IMPLEMENTATION" ? (
          <CreateImplementationCandidatesView result={result} onSelect={onSelectCandidate} />
        ) : null}
        {result.type === "ACTION_CANDIDATES" && result.action === "CREATE_VALIDATION" ? (
          <CreateValidationCandidatesView result={result} onSelect={onSelectCandidate} />
        ) : null}
      </div>
    </div>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function LastCycleResultView({ result }: { result: LastCycleResult }) {
  if (!result.hasData) return <p className="text-muted">Nenhuma Evaluation Mission executada ainda.</p>;
  return (
    <dl className="flex flex-col text-xs">
      <ResultRow label="Target" value={result.target ?? "—"} />
      <ResultRow label="Status" value={result.status ?? "—"} />
      <ResultRow label="Data" value={result.createdAt ? new Date(result.createdAt).toLocaleString("en-US") : "—"} />
      <ResultRow label="Agentes" value={String(result.agentCount)} />
      <ResultRow label="Findings" value={String(result.findingsCount)} />
      <ResultRow label="Recommendations" value={String(result.recommendationsCount)} />
    </dl>
  );
}

function RecurringFindingsResultView({ result }: { result: RecurringFindingsResult }) {
  if (result.items.length === 0) {
    return <p className="text-muted">Nenhum finding recorrente (PERSISTENT ou REAPPEARED) encontrado.</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.items.map((item, i) => (
        <div key={i} className="rounded-md border border-border p-3">
          <p className="text-muted">{item.targetName ?? item.targetUrl}</p>
          <p className="mt-1">{item.finding}</p>
          <p className="mt-1 text-muted">
            {item.latestStatus} · {item.occurrences} ocorrência(s)
            {item.classification ? ` · ${item.classification}` : ""}
            {item.agentSlugs.length > 0 ? ` · ${item.agentSlugs.join(", ")}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function PendingRecommendationsResultView({ result }: { result: PendingRecommendationsResult }) {
  if (result.items.length === 0) return <p className="text-muted">Nenhuma Recommendation pendente.</p>;
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.items.map((item) => (
        <div key={item.id} className="rounded-md border border-border p-3">
          <p className="font-medium">{item.title}</p>
          <p className="mt-1 text-muted">{item.summary}</p>
          <p className="mt-1 text-muted">
            Impacto: {item.impact ?? "—"} · Confiança: {item.confidence ?? "—"} · Origem: {item.origin}
          </p>
        </div>
      ))}
    </div>
  );
}

function AgentActivityResultView({ result }: { result: AgentActivityResult }) {
  if (result.items.length === 0) return <p className="text-muted">Nenhum agente registrado.</p>;
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.items.map((item) => (
        <div key={item.slug} className="rounded-md border border-border p-3">
          <p className="font-medium">{item.name}</p>
          <p className="mt-1 text-muted">
            {item.executionCount} execução(ões) · {item.missionParticipationCount} mission(s) · {item.findingCount} finding(s) · convergência:{" "}
            {item.convergenceCount}
          </p>
          {item.classifications.length > 0 ? <p className="mt-1 text-muted">Classificações: {item.classifications.join(", ")}</p> : null}
        </div>
      ))}
    </div>
  );
}

function TeamArchitectResultView({ result }: { result: TeamArchitectResult }) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      {result.recommendations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-muted">Recomendações arquiteturais</p>
          {result.recommendations.map((recommendation, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <p className="font-medium">{recommendation.title}</p>
              <p className="mt-1 text-muted">{recommendation.summary}</p>
              <p className="mt-1 text-muted">
                Confiança: {recommendation.confidence} · Agentes: {recommendation.affectedAgents.join(", ") || "—"}
              </p>
              <p className="mt-1">{recommendation.suggestedAction}</p>
              {recommendation.limitations.length > 0 ? (
                <p className="mt-1 text-[10px] text-muted">Limitações: {recommendation.limitations.join(" ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted">Nenhuma recomendação arquitetural com evidência suficiente ainda.</p>
      )}
      {result.insufficientEvidence.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-muted">Evidência insuficiente</p>
          {result.insufficientEvidence.map((entry, i) => (
            <div key={i} className="rounded-md border border-dashed border-border p-3">
              <p className="font-medium">{entry.area}</p>
              <p className="mt-1 text-muted">{entry.observed}</p>
              <p className="mt-1 text-muted">Faltando: {entry.missing}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** FASE 12 — Ação 1/2. Shared by APPROVE and IGNORE: both read the same PENDING set, and only differ in the label/description applied once a specific candidate is selected. */
function ApproveIgnoreCandidatesView({
  result,
  onSelect,
}: {
  result: ApproveRecommendationCandidatesResult | IgnoreRecommendationCandidatesResult;
  onSelect: SelectCandidate;
}) {
  if (result.candidates.length === 0) {
    return <p className="text-muted">Nenhuma Recommendation PENDING encontrada.</p>;
  }
  const actionLabel = result.action === "APPROVE_RECOMMENDATION" ? "Aprovar" : "Ignorar";
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.candidates.map((candidate) => (
        <div key={candidate.id} className="rounded-md border border-border p-3">
          <p className="font-medium">{candidate.title}</p>
          <p className="mt-1 text-muted">{candidate.summary}</p>
          <p className="mt-1 text-muted">
            Impacto: {candidate.impact ?? "—"} · Confiança: {candidate.confidence ?? "—"}
          </p>
          <button
            type="button"
            onClick={() => onSelect(result.action, candidate.id, candidate.title, candidate.impact, candidate.confidence)}
            className="mt-2 rounded-md border border-accent px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
          >
            {actionLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

/** FASE 12 — Ação 3. Candidates come from getTeamIntelligence()'s own evidenceGaps.approvedRecommendationsWithoutImplementation (10C) — never a new "find eligible rows" query. */
function CreateImplementationCandidatesView({ result, onSelect }: { result: CreateImplementationCandidatesResult; onSelect: SelectCandidate }) {
  if (result.candidates.length === 0) {
    return <p className="text-muted">Nenhuma Recommendation APPROVED sem Implementation encontrada.</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.candidates.map((candidate) => (
        <div key={candidate.recommendationId} className="rounded-md border border-border p-3">
          <p className="font-medium">{candidate.title}</p>
          <p className="mt-1 text-muted">{candidate.summary}</p>
          <p className="mt-1 text-muted">
            Impacto: {candidate.impact ?? "—"} · Confiança: {candidate.confidence ?? "—"}
          </p>
          <button
            type="button"
            onClick={() => onSelect("CREATE_IMPLEMENTATION", candidate.recommendationId, candidate.title, candidate.impact, candidate.confidence)}
            className="mt-2 rounded-md border border-accent px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
          >
            Criar Implementation
          </button>
        </div>
      ))}
    </div>
  );
}

/** FASE 12 — Ação 4. Candidates come from getTeamIntelligence()'s own evidenceGaps.implementationsWithoutValidation (10C) — never a new "find eligible rows" query. */
function CreateValidationCandidatesView({ result, onSelect }: { result: CreateValidationCandidatesResult; onSelect: SelectCandidate }) {
  if (result.candidates.length === 0) {
    return <p className="text-muted">Nenhuma Implementation sem Validation encontrada.</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.candidates.map((candidate) => (
        <div key={candidate.implementationId} className="rounded-md border border-border p-3">
          <p className="font-medium">{candidate.recommendationTitle}</p>
          {candidate.implementationSummary ? <p className="mt-1 text-muted">{candidate.implementationSummary}</p> : null}
          <button
            type="button"
            onClick={() => onSelect("CREATE_VALIDATION", candidate.implementationId, candidate.recommendationTitle, null, null)}
            className="mt-2 rounded-md border border-accent px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
          >
            Criar Validation
          </button>
        </div>
      ))}
    </div>
  );
}
