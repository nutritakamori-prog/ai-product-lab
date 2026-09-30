"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Archive,
  ClipboardList,
  Clock,
  FileText,
  FlaskConical,
  LogIn,
  Maximize2,
  Sparkles,
  Users,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Panel } from "./panel";
import type { AgentQgState, GlobalQgStatus, WeeklyReport } from "./qg-helpers";

export interface AgentStationData {
  id: string;
  name: string;
  objective: string;
  state: AgentQgState;
  stateLabel: string;
  lastMissionTarget: string | null;
  lastMissionDate: string | null;
  findings: { text: string; recommendationId: string | null; recommendationStatus: string | null }[];
}

export interface QgOfficeData {
  globalStatus: GlobalQgStatus;
  globalStatusLabel: string;
  stations: AgentStationData[];
  head: {
    summary: string | null;
    mainRecommendation: string | null;
    problems: number;
    opportunities: number;
    observations: number;
    totalFindings: number;
    pendingCount: number;
  };
  latestMission: { id: string; target: string; status: string; createdAt: string; specialistCount: number } | null;
  pendingCount: number;
  approvedCount: number;
  ignoredCount: number;
  missionHistoryCount: number;
  weeklyReport: WeeklyReport;
}

const STATUS_DOT: Record<GlobalQgStatus, string> = {
  HEALTHY: "bg-emerald-500",
  NEEDS_ATTENTION: "bg-amber-500",
  ACTION_REQUIRED: "bg-red-500",
};

/** Visual accent per agent state — never the only signal (the text label always renders alongside it). */
const STATE_DOT: Record<AgentQgState, string> = {
  IDLE: "bg-border",
  WORKING: "bg-accent animate-pulse",
  NOT_IN_LATEST_RUN: "bg-border",
  BLOCKED: "bg-amber-500",
  FAILED: "bg-red-500",
  NO_FINDING: "bg-emerald-500",
  UNCONFIRMED: "bg-amber-500",
  HAS_FINDING: "bg-amber-500",
  PENDING_DECISION: "bg-red-500",
};

type PanelState = { type: "agent"; agentId: string } | { type: "head" } | { type: "meeting" } | { type: "reports" } | { type: "clock" } | null;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.2;

function Station({
  label,
  icon,
  className = "",
  badge,
  badgeLabel,
  onClick,
  ariaLabel,
}: {
  label: string;
  icon: React.ReactNode;
  className?: string;
  badge?: number;
  /** What the badge number means, e.g. "pendente(s)" — always shown as real text next to the count, never left as a bare number. */
  badgeLabel?: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md ${className}`}
    >
      {typeof badge === "number" && badge > 0 ? (
        <span
          aria-hidden
          data-count={badge}
          className="qg-decorative-count absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-medium text-white"
        />
      ) : null}
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-foreground group-hover:border-accent group-hover:text-accent">
        {icon}
      </span>
      <span className="text-xs font-medium leading-tight">{label}</span>
      {typeof badge === "number" && badge > 0 && badgeLabel ? (
        <span className="text-[10px] leading-tight text-muted">
          {badge} {badgeLabel}
        </span>
      ) : null}
    </button>
  );
}

export function QgOffice({ data }: { data: QgOfficeData }) {
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<PanelState>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  const activeAgent = panel?.type === "agent" ? data.stations.find((s) => s.id === panel.agentId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:underline">
              <ArrowLeft size={14} />
              Voltar ao LAB
            </Link>
            <span className="text-border">·</span>
            <h1 className="text-[15px] font-semibold tracking-tight">LAB QG</h1>
            <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[data.globalStatus]}`} aria-hidden />
              {data.globalStatusLabel}
            </span>
          </div>
          <p className="text-xs text-muted">
            O escritório visual do LAB — clique em uma estação para ver o estado real de cada especialista, decidir
            Recommendations pendentes ou abrir Product Intelligence e Test Lab.
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/product-intelligence" className="rounded-md border border-border px-2.5 py-1 hover:bg-foreground/[0.04]">
            Product Intelligence
          </Link>
          <Link href="/test-lab" className="rounded-md border border-border px-2.5 py-1 hover:bg-foreground/[0.04]">
            Test Lab
          </Link>
          <button
            type="button"
            onClick={() => setPanel({ type: "reports" })}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-foreground/[0.04]"
          >
            Relatórios
          </button>
          <button
            type="button"
            onClick={() => setQuickViewOpen((v) => !v)}
            aria-pressed={quickViewOpen}
            className="rounded-md border border-border px-2.5 py-1 hover:bg-foreground/[0.04]"
          >
            Quick View
          </button>
          <div className="ml-1 flex items-center gap-1 rounded-md border border-border p-0.5">
            <button
              type="button"
              aria-label="Diminuir zoom"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              className="rounded p-1 hover:bg-foreground/[0.06]"
            >
              <ZoomOut size={14} />
            </button>
            <button type="button" aria-label="Resetar zoom" onClick={() => setZoom(1)} className="rounded p-1 hover:bg-foreground/[0.06]">
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              aria-label="Aumentar zoom"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              className="rounded p-1 hover:bg-foreground/[0.06]"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </nav>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div
            className="mx-auto max-w-4xl origin-top rounded-2xl border border-border p-6 shadow-sm transition-transform"
            style={{
              transform: `scale(${zoom})`,
              background:
                "repeating-linear-gradient(45deg, var(--color-surface) 0px, var(--color-surface) 24px, var(--color-background) 24px, var(--color-background) 48px)",
            }}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <Station
                label="Entrada"
                icon={<LogIn size={18} />}
                ariaLabel="Entrada do LAB — abrir Quick View"
                onClick={() => setQuickViewOpen(true)}
              />
              <Station
                label="Head"
                icon={<Sparkles size={18} />}
                className="col-span-2 border-accent/40 bg-accent/5"
                ariaLabel="Estação do Head — ver consolidação e recomendação principal"
                onClick={() => setPanel({ type: "head" })}
                badge={data.head.pendingCount}
                badgeLabel="pendente(s)"
              />
              <Link
                href="/product-intelligence#historico"
                className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                aria-label={`Arquivo — histórico de avaliações (${data.missionHistoryCount})`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent group-hover:text-accent">
                  <Archive size={18} />
                </span>
                <span className="text-xs font-medium">Arquivo</span>
              </Link>

              {data.stations.map((agent) => (
                <Station
                  key={agent.id}
                  label={agent.name}
                  icon={
                    <span className="relative flex items-center justify-center">
                      <Users size={18} />
                      <span
                        className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${STATE_DOT[agent.state]}`}
                        aria-hidden
                      />
                    </span>
                  }
                  ariaLabel={`${agent.name} — ${agent.stateLabel}`}
                  onClick={() => setPanel({ type: "agent", agentId: agent.id })}
                />
              ))}

              <Station
                label="Mesa de reunião"
                icon={<Users size={18} />}
                ariaLabel="Mesa de reunião — ver visão consolidada da equipe"
                onClick={() => setPanel({ type: "meeting" })}
              />

              <div className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-4 sm:grid-cols-4 sm:gap-4">
                <Link
                  href="/product-intelligence"
                  className="group relative col-span-2 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  aria-label={`Quadro — Product Intelligence (${data.pendingCount} pendente(s))`}
                >
                  {data.pendingCount > 0 ? (
                    <span
                      aria-hidden
                      data-count={data.pendingCount}
                      className="qg-decorative-count absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-medium text-white"
                    />
                  ) : null}
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent group-hover:text-accent">
                    <ClipboardList size={18} />
                  </span>
                  <span className="text-xs font-medium">Quadro · Product Intelligence</span>
                  {data.pendingCount > 0 ? (
                    <span className="text-[10px] leading-tight text-muted">{data.pendingCount} pendente(s)</span>
                  ) : null}
                </Link>

                <Link
                  href="/product-intelligence"
                  className="group relative flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  aria-label={`Implementation — ${data.approvedCount} tarefa(s) aprovada(s)`}
                >
                  {data.approvedCount > 0 ? (
                    <span
                      aria-hidden
                      data-count={data.approvedCount}
                      className="qg-decorative-count absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-medium text-white"
                    />
                  ) : null}
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent group-hover:text-accent">
                    <Wrench size={18} />
                  </span>
                  <span className="text-xs font-medium">Implementation</span>
                  {data.approvedCount > 0 ? (
                    <span className="text-[10px] leading-tight text-muted">{data.approvedCount} aprovada(s)</span>
                  ) : null}
                </Link>

                <Link
                  href="/test-lab"
                  className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  aria-label="Retest — Test Lab"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent group-hover:text-accent">
                    <FlaskConical size={18} />
                  </span>
                  <span className="text-xs font-medium">Retest · Test Lab</span>
                </Link>
              </div>

              <button
                type="button"
                onClick={() => setPanel({ type: "reports" })}
                className="group col-span-2 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                aria-label="Relatórios — abrir Weekly Report"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent group-hover:text-accent">
                  <FileText size={18} />
                </span>
                <span className="text-xs font-medium">Relatórios</span>
              </button>

              <button
                type="button"
                onClick={() => setPanel({ type: "clock" })}
                className="group col-span-2 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                aria-label="Relógio — hora e agenda"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent group-hover:text-accent">
                  <Clock size={18} />
                </span>
                <span className="text-xs font-medium">Relógio</span>
              </button>
            </div>
          </div>
        </div>

        {quickViewOpen ? (
          <aside className="w-72 shrink-0 border-l border-border bg-surface p-4 text-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">Quick View</p>
              <button type="button" onClick={() => setQuickViewOpen(false)} aria-label="Fechar Quick View" className="text-muted hover:text-foreground">
                ×
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[data.globalStatus]}`} aria-hidden />
                <span className="text-sm font-medium">{data.globalStatusLabel}</span>
              </div>
              {data.latestMission ? (
                <p className="text-xs text-muted">
                  Última avaliação: <span className="text-foreground">{data.latestMission.target}</span> ·{" "}
                  {data.latestMission.specialistCount} especialista(s)
                </p>
              ) : (
                <p className="text-xs text-muted">Nenhuma avaliação executada ainda.</p>
              )}
              <p className="text-xs text-muted">
                Recommendations: <span className="text-foreground">{data.pendingCount} pendente(s)</span> · {data.approvedCount} aprovada(s) ·{" "}
                {data.ignoredCount} ignorada(s)
              </p>
              <p className="text-xs text-muted">Avaliações no histórico: {data.missionHistoryCount}</p>
              {data.latestMission ? (
                <Link href={`/test-lab/missions/${data.latestMission.id}`} className="text-xs underline">
                  Ver última mission
                </Link>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      {panel?.type === "head" ? (
        <Panel title="Head" onClose={() => setPanel(null)}>
          <p className="text-muted">{data.head.summary ?? "Ainda não há uma síntese do Head."}</p>
          {data.head.totalFindings > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {data.head.problems} problema(s) · {data.head.opportunities} oportunidade(s) · {data.head.observations} observação(ões)
            </p>
          ) : null}
          {data.head.mainRecommendation ? (
            <p className="mt-3">
              <span className="text-xs text-muted">Principal recomendação: </span>
              {data.head.mainRecommendation}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">{data.head.pendingCount} recomendação(ões) pendente(s) de decisão.</p>
          <Link href="/product-intelligence" className="mt-3 inline-block text-xs underline">
            Ver Product Intelligence
          </Link>
        </Panel>
      ) : null}

      {panel?.type === "agent" && activeAgent ? (
        <Panel title={activeAgent.name} onClose={() => setPanel(null)}>
          <p className="text-muted">{activeAgent.objective}</p>
          <p className="mt-3 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${STATE_DOT[activeAgent.state]}`} aria-hidden />
            <span className="font-medium">{activeAgent.stateLabel}</span>
          </p>
          {activeAgent.lastMissionTarget ? (
            <p className="mt-2 text-xs text-muted">
              Última Mission relevante: {activeAgent.lastMissionTarget}
              {activeAgent.lastMissionDate ? ` · ${new Date(activeAgent.lastMissionDate).toLocaleString("en-US")}` : ""}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">Sem atividade recente registrada.</p>
          )}
          {activeAgent.findings.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs font-medium text-muted">Findings encontrados</p>
              {activeAgent.findings.map((f, i) => (
                <div key={i} className="rounded-md border border-border p-3 text-xs">
                  <p>{f.text}</p>
                  {f.recommendationStatus ? <p className="mt-1 text-muted">Recommendation: {f.recommendationStatus}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {panel?.type === "meeting" ? (
        <Panel title="Mesa de reunião — visão da equipe" onClose={() => setPanel(null)}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/5 p-2 text-xs">
              <span className="font-medium">Head</span>
              <span className="text-muted">{data.head.totalFindings} ponto(s) de atenção</span>
            </div>
            {data.stations.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
                <span className="font-medium">{agent.name}</span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[agent.state]}`} aria-hidden />
                  {agent.stateLabel}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {panel?.type === "reports" ? (
        <Panel title={`Weekly Report — últimos ${data.weeklyReport.periodDays} dias`} onClose={() => setPanel(null)}>
          <dl className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted">Avaliações executadas</dt>
              <dd className="font-medium">{data.weeklyReport.evaluationsRun}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Findings levantados</dt>
              <dd className="font-medium">{data.weeklyReport.findingsRaised}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Recommendations aprovadas</dt>
              <dd className="font-medium">{data.weeklyReport.decisionsApproved}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Recommendations ignoradas</dt>
              <dd className="font-medium">{data.weeklyReport.decisionsIgnored}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Pendentes atualmente</dt>
              <dd className="font-medium">{data.weeklyReport.decisionsPending}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">Dados agregados diretamente das Evaluation Missions e Recommendations existentes.</p>
        </Panel>
      ) : null}

      {panel?.type === "clock" ? <ClockPanel latestMission={data.latestMission} onClose={() => setPanel(null)} /> : null}
    </div>
  );
}

function ClockPanel({
  latestMission,
  onClose,
}: {
  latestMission: QgOfficeData["latestMission"];
  onClose: () => void;
}) {
  const [now] = useState(() => new Date());
  return (
    <Panel title="Relógio" onClose={onClose}>
      <p className="text-2xl font-semibold tabular-nums">{now.toLocaleTimeString("en-US")}</p>
      <p className="mt-1 text-xs text-muted">{now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      <p className="mt-4 text-xs text-muted">
        Última atividade registrada no LAB:{" "}
        {latestMission ? new Date(latestMission.createdAt).toLocaleString("en-US") : "nenhuma avaliação executada ainda"}
      </p>
      <p className="mt-2 text-xs text-muted">Nenhuma agenda definida.</p>
    </Panel>
  );
}
