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

/** Visual accent per agent state — never the only signal (the real label is always in the button's aria-label and inside the agent's own panel). */
const STATE_DOT: Record<AgentQgState, string> = {
  IDLE: "bg-border",
  WORKING: "bg-accent qg-led-breathe",
  NOT_IN_LATEST_RUN: "bg-border",
  BLOCKED: "bg-amber-500",
  FAILED: "bg-red-500",
  NO_FINDING: "bg-emerald-500",
  UNCONFIRMED: "bg-amber-500",
  HAS_FINDING: "bg-amber-500",
  PENDING_DECISION: "bg-red-500",
};

/** Same per-state signal as STATE_DOT, expressed as the desk monitor's border color instead of a corner LED. */
const STATE_RING: Record<AgentQgState, string> = {
  IDLE: "border-border",
  WORKING: "border-accent",
  NOT_IN_LATEST_RUN: "border-border",
  BLOCKED: "border-amber-500",
  FAILED: "border-red-500",
  NO_FINDING: "border-emerald-500",
  UNCONFIRMED: "border-amber-500",
  HAS_FINDING: "border-amber-500",
  PENDING_DECISION: "border-red-500",
};

/**
 * FASE 9D-2, item 1 — purely visual "monitor is off" cue for a specialist
 * that has no real presence in the current picture (never participated yet,
 * or wasn't part of the latest run). Every other state means the specialist
 * actually ran or is running, so its monitor stays visually on. This never
 * changes what deriveAgentQgState() computes — it's a presentation-only
 * layer over the same AgentQgState, and the dimmed opacity is only ever a
 * reinforcement: the real signal stays the button's own aria-label (read
 * regardless of this) plus STATE_RING/STATE_DOT's existing color coding.
 */
const STATE_INACTIVE: Record<AgentQgState, boolean> = {
  IDLE: true,
  WORKING: false,
  NOT_IN_LATEST_RUN: true,
  BLOCKED: false,
  FAILED: false,
  NO_FINDING: false,
  UNCONFIRMED: false,
  HAS_FINDING: false,
  PENDING_DECISION: false,
};

type PanelState = { type: "agent"; agentId: string } | { type: "head" } | { type: "meeting" } | { type: "reports" } | { type: "clock" } | null;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.2;

/**
 * A workstation on the office floor — the visual unit for every specialist
 * and, via `variant="head"`, the Head's own bigger coordination desk. A
 * monitor (state shown as its border color plus a small corner LED, never
 * the only signal — see STATE_DOT's own comment) sits on a desk edge, label
 * underneath. Same shape for a specialist or the Head, just scaled up.
 */
function Desk({
  label,
  icon,
  variant = "agent",
  summary,
  stateRing = "border-border",
  ledClassName,
  inactive = false,
  className = "",
  badge,
  badgeLabel,
  onClick,
  ariaLabel,
}: {
  label: string;
  icon: React.ReactNode;
  variant?: "agent" | "head";
  summary?: string | null;
  stateRing?: string;
  ledClassName?: string;
  /** Purely visual "screen is off" cue (see STATE_INACTIVE) — never the only signal; the real state is always in ariaLabel. */
  inactive?: boolean;
  className?: string;
  badge?: number;
  /** What the badge number means, e.g. "pendente(s)" — always shown as real text next to the count, never left as a bare number. */
  badgeLabel?: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  const isHead = variant === "head";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`group relative flex rounded-lg p-3 transition-transform hover:-translate-y-0.5 ${
        isHead ? "flex-row items-center gap-4 text-left" : "flex-col items-center gap-1.5 text-center"
      } ${className}`}
    >
      {typeof badge === "number" && badge > 0 ? (
        <span
          aria-hidden
          data-count={badge}
          className="qg-decorative-count absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-medium text-white"
        />
      ) : null}
      <span
        className={`relative flex shrink-0 items-center justify-center rounded-md border-2 bg-background shadow-sm transition-colors group-hover:border-accent ${stateRing} ${
          isHead ? "h-14 w-14" : "h-11 w-14"
        } ${inactive ? "opacity-45" : ""}`}
      >
        {icon}
        {ledClassName ? (
          <span aria-hidden className={`absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full border-2 border-background ${ledClassName}`} />
        ) : null}
      </span>
      {!isHead ? <span aria-hidden className="qg-desk-surface w-10" /> : null}
      <span className={`flex min-w-0 flex-col ${isHead ? "gap-0.5" : "items-center gap-0.5"}`}>
        <span className={isHead ? "text-sm font-semibold" : "text-xs font-medium leading-tight"}>{label}</span>
        {isHead && summary ? <span className="truncate text-xs text-muted">{summary}</span> : null}
        {typeof badge === "number" && badge > 0 && badgeLabel ? (
          <span className="text-[10px] leading-tight text-muted">
            {badge} {badgeLabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** An enclosed room on the floor plan — Head and the specialists' area — framed with a wall-like border and a small nameplate. Individual objects/stations don't get a nameplate, only actual rooms do. */
function Room({ label, accent = false, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`qg-room p-4 sm:p-5 ${accent ? "border-accent/50 bg-accent/[0.05]" : ""}`}>
      <span className={`qg-room-label ${accent ? "border-accent/50 text-accent" : ""}`}>{label}</span>
      {children}
    </div>
  );
}

export function QgOffice({ data }: { data: QgOfficeData }) {
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<PanelState>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  const activeAgent = panel?.type === "agent" ? data.stations.find((s) => s.id === panel.agentId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-6 py-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:underline">
              <ArrowLeft size={14} />
              Voltar ao LAB
            </Link>
            <span className="text-border">·</span>
            <h1 className="text-[13px] font-semibold tracking-tight text-muted">LAB QG</h1>
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
          <button
            type="button"
            onClick={() => setQuickViewOpen((v) => !v)}
            aria-pressed={quickViewOpen}
            className="rounded-md border border-border px-2.5 py-1 text-muted hover:bg-foreground/[0.04] hover:text-foreground"
          >
            Quick View
          </button>
          <div className="ml-1 flex items-center gap-1 rounded-md border border-border p-0.5">
            <button
              type="button"
              aria-label="Diminuir zoom"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              className="rounded p-1 text-muted hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <ZoomOut size={13} />
            </button>
            <button
              type="button"
              aria-label="Resetar zoom"
              onClick={() => setZoom(1)}
              className="rounded p-1 text-muted hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Maximize2 size={13} />
            </button>
            <button
              type="button"
              aria-label="Aumentar zoom"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              className="rounded p-1 text-muted hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </nav>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div
            className="qg-floor mx-auto min-w-[600px] max-w-5xl origin-top rounded-2xl border border-border p-5 shadow-sm transition-transform sm:p-8"
            style={{ transform: `scale(${zoom})` }}
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setQuickViewOpen(true)}
                aria-label="Entrada do LAB — abrir Quick View"
                className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium shadow-sm transition-colors hover:border-accent"
              >
                <LogIn size={14} />
                Entrada
              </button>
              <button
                type="button"
                onClick={() => setPanel({ type: "clock" })}
                aria-label="Relógio — hora e agenda"
                className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:border-accent"
              >
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-current">
                  <Clock size={11} />
                </span>
                Relógio
              </button>
            </div>

            <Room label="Head" accent>
              <Desk
                variant="head"
                label="Head"
                icon={<Sparkles size={20} className="text-accent" />}
                summary={data.head.summary ?? "Aguardando síntese da equipe."}
                stateRing="border-accent/60"
                className="w-full"
                badge={data.head.pendingCount}
                // FASE 9D-1 — Recommendation cmuo3lmqg00061m7dsfes8yje: the
                // summary line right above this badge only ever describes the
                // LATEST run, but pendingCount is a running total that can
                // include Recommendations left PENDING from earlier runs —
                // "no total" disambiguates that without claiming they're
                // necessarily all from earlier runs (a fresh run can also
                // leave its own findings PENDING).
                badgeLabel="pendente(s) no total"
                ariaLabel="Estação do Head — ver consolidação e recomendação principal"
                onClick={() => setPanel({ type: "head" })}
              />
            </Room>

            <div className="mt-5">
              <Room label="Especialistas">
                <div className="grid grid-cols-4 gap-3">
                  {data.stations.map((agent) => (
                    <Desk
                      key={agent.id}
                      label={agent.name}
                      icon={<Users size={17} />}
                      stateRing={STATE_RING[agent.state]}
                      ledClassName={STATE_DOT[agent.state]}
                      inactive={STATE_INACTIVE[agent.state]}
                      ariaLabel={`${agent.name} — ${agent.stateLabel}`}
                      onClick={() => setPanel({ type: "agent", agentId: agent.id })}
                    />
                  ))}
                </div>
              </Room>
            </div>

            <p className="mb-2 mt-6 text-[10px] font-semibold uppercase tracking-wide text-muted">Decisão e ação</p>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setPanel({ type: "meeting" })}
                aria-label="Mesa de reunião — ver visão consolidada da equipe"
                className="qg-room group flex flex-col items-center justify-center gap-3 p-5 text-center transition-colors hover:border-accent"
              >
                <span aria-hidden className="relative flex h-14 w-24 items-center justify-center">
                  <span className="h-7 w-20 rounded-full border-2 border-border bg-background shadow-sm transition-colors group-hover:border-accent" />
                  <span className="absolute -top-1 left-4 h-2 w-2 rounded-full bg-border" />
                  <span className="absolute -top-1 right-4 h-2 w-2 rounded-full bg-border" />
                  <span className="absolute -bottom-1 left-4 h-2 w-2 rounded-full bg-border" />
                  <span className="absolute -bottom-1 right-4 h-2 w-2 rounded-full bg-border" />
                </span>
                <span className="text-xs font-medium">Mesa de reunião</span>
                <span className="text-[10px] leading-tight text-muted">{data.head.totalFindings} ponto(s) de atenção</span>
              </button>

              <Link
                href="/product-intelligence"
                className="qg-room group relative flex flex-col items-center justify-center gap-2 border-dashed p-4 text-center transition-colors hover:border-accent"
                aria-label={`Quadro — Product Intelligence (${data.pendingCount} pendente(s))`}
              >
                {data.pendingCount > 0 ? (
                  <span
                    aria-hidden
                    data-count={data.pendingCount}
                    className="qg-decorative-count absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-medium text-white"
                  />
                ) : null}
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-border" />
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent">
                  <ClipboardList size={18} />
                </span>
                <span className="text-xs font-medium">Quadro · Product Intelligence</span>
                <span className="flex flex-col text-[10px] leading-tight text-muted">
                  {data.pendingCount > 0 ? <span>{data.pendingCount} pendente(s)</span> : null}
                  <span>
                    {data.approvedCount} aprovada(s) · {data.ignoredCount} ignorada(s)
                  </span>
                </span>
              </Link>

              <Link
                href="/product-intelligence"
                className="qg-room group relative flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors hover:border-accent"
                aria-label={`Implementation — ${data.approvedCount} tarefa(s) aprovada(s)`}
              >
                {data.approvedCount > 0 ? (
                  <span
                    aria-hidden
                    data-count={data.approvedCount}
                    className="qg-decorative-count absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-medium text-white"
                  />
                ) : null}
                <span aria-hidden className="flex h-2.5 items-center gap-1 rounded-sm bg-foreground/80 px-1.5">
                  <span className="h-1 w-1 rounded-full bg-red-400" />
                  <span className="h-1 w-1 rounded-full bg-amber-400" />
                  <span className="h-1 w-1 rounded-full bg-emerald-400" />
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent">
                  <Wrench size={18} />
                </span>
                <span className="text-xs font-medium">Implementation</span>
                {data.approvedCount > 0 ? <span className="text-[10px] leading-tight text-muted">{data.approvedCount} aprovada(s)</span> : null}
              </Link>
            </div>

            <p className="mb-2 mt-6 text-[10px] font-semibold uppercase tracking-wide text-muted">Suporte</p>
            <div className="grid grid-cols-3 gap-3">
              <Link
                href="/test-lab"
                className="qg-room group flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors hover:border-accent"
                aria-label="Retest — Test Lab"
              >
                <span aria-hidden className="flex gap-1">
                  <span className="h-3 w-4 rounded-sm border border-border bg-background" />
                  <span className="h-3 w-4 rounded-sm border border-border bg-background" />
                  <span className="h-3 w-4 rounded-sm border border-border bg-background" />
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent">
                  <FlaskConical size={18} />
                </span>
                <span className="text-xs font-medium">Retest · Test Lab</span>
              </Link>

              <Link
                href="/product-intelligence#historico"
                className="qg-room group flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors hover:border-accent"
                aria-label={`Arquivo — histórico de avaliações (${data.missionHistoryCount})`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent">
                  <Archive size={18} />
                </span>
                <span aria-hidden className="h-0.5 w-6 rounded-full bg-border" />
                <span className="text-xs font-medium">Arquivo</span>
              </Link>

              <button
                type="button"
                onClick={() => setPanel({ type: "reports" })}
                className="qg-room group flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors hover:border-accent"
                aria-label="Relatórios — abrir Weekly Report"
              >
                <span aria-hidden className="flex items-end gap-0.5">
                  <span className="h-2 w-1 rounded-sm bg-border" />
                  <span className="h-3 w-1 rounded-sm bg-border" />
                  <span className="h-4 w-1 rounded-sm bg-accent/60" />
                  <span className="h-2.5 w-1 rounded-sm bg-border" />
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background group-hover:border-accent">
                  <FileText size={18} />
                </span>
                <span className="text-xs font-medium">Relatórios</span>
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
