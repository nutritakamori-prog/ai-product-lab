"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Archive, Clock, FileText, LogIn, Search, Users, Wrench } from "lucide-react";
import { Panel } from "./panel";
import type { AgentQgState, GlobalQgStatus, WeeklyReport } from "./qg-helpers";
import { CommandCenterConsole, type CommandCenterActivity } from "./command-center";
import { LabCore } from "./lab-core";
import type { BurstEvent } from "./lab-core-scene";
import { ReasoningGraph } from "./reasoning-graph";
import { agentPositionPercent, agentDepth } from "./agent-layout";

/**
 * FASE 1/2 — "Living Intelligence Interface". Replaces the room/office
 * visual metaphor (Fase 9, Rodadas 1-3) with a different one: the QG is not
 * a place the user walks through, it's an organism the user talks to. The
 * data contract below is UNCHANGED from the previous visual layer on
 * purpose — page.tsx's data-fetching and derivation (getQgSnapshot,
 * deriveAgentQgState, deriveGlobalStatus, buildWeeklyReport) are the single
 * source of truth for every visual decision here; nothing in this file
 * invents a state, a count, or a mission status that doesn't already exist
 * in that data. CommandCenterConsole (the real Claude <-> LAB Command
 * Router / confirmation-token / executeQgAction flow) is rendered exactly
 * as before — its command matching, routing, Server Actions and
 * confirmation flow are untouched; it only gained one optional, additive
 * `onActivity` callback (see command-center.tsx) reporting transitions it
 * already makes internally, which this file uses purely to choreograph the
 * Core/agents/ReasoningGraph. The choreography below never shows a
 * fictional progress: it only replays, as an animation, a result the
 * backend has already returned.
 */

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
  HEALTHY: "bg-emerald-400",
  NEEDS_ATTENTION: "bg-amber-400",
  ACTION_REQUIRED: "bg-red-400",
};

/** Visual accent per agent state — never the only signal (the real label is always in the orb's aria-label, in the caption beneath it, and inside the agent's own Panel). */
const AGENT_ORB_STYLE: Record<AgentQgState, { color: string; glow: string; speed: string; scale: number }> = {
  IDLE: { color: "#5b6b9c", glow: "rgba(91, 107, 156, 0.35)", speed: "6s", scale: 1 },
  NOT_IN_LATEST_RUN: { color: "#45506e", glow: "rgba(69, 80, 110, 0.22)", speed: "7s", scale: 0.9 },
  WORKING: { color: "#7fe3ff", glow: "rgba(127, 227, 255, 0.7)", speed: "1.8s", scale: 1.1 },
  BLOCKED: { color: "#ff8a3d", glow: "rgba(255, 138, 61, 0.55)", speed: "2.4s", scale: 1 },
  FAILED: { color: "#ff5d5d", glow: "rgba(255, 93, 93, 0.6)", speed: "2s", scale: 1 },
  NO_FINDING: { color: "#6ee7c8", glow: "rgba(110, 231, 200, 0.45)", speed: "5s", scale: 1 },
  UNCONFIRMED: { color: "#b08fff", glow: "rgba(176, 143, 255, 0.45)", speed: "4.5s", scale: 1 },
  HAS_FINDING: { color: "#ffcf5c", glow: "rgba(255, 207, 92, 0.6)", speed: "2.6s", scale: 1.05 },
  PENDING_DECISION: { color: "#ffb020", glow: "rgba(255, 176, 32, 0.8)", speed: "1.5s", scale: 1.12 },
};

/** States worth the orb visually "reaching toward" the Core and counting as part of the ReasoningGraph's active spokes — a station that's IDLE or simply wasn't part of the latest run has nothing live to show. */
function isAgentActive(state: AgentQgState): boolean {
  return state !== "IDLE" && state !== "NOT_IN_LATEST_RUN";
}

type PanelState =
  | { type: "agent"; agentId: string }
  | { type: "head" }
  | { type: "mission" }
  | { type: "findings" }
  | { type: "meeting" }
  | { type: "reports" }
  | { type: "clock" }
  | null;

/**
 * Reconstructs the original consolidated finding list (one entry per real
 * finding, with every agent that reported it) purely by grouping the
 * already-fan-out-per-agent `station.findings` by exact text — the same
 * text page.tsx already copies verbatim from `latestReport.findings[].finding`
 * into every contributing station. No new data, no fuzzy matching.
 */
function buildDiscoveryFindings(stations: AgentStationData[]) {
  const byText = new Map<string, { text: string; agentNames: string[]; recommendationStatus: string | null }>();
  for (const station of stations) {
    for (const finding of station.findings) {
      const existing = byText.get(finding.text);
      if (existing) {
        if (!existing.agentNames.includes(station.name)) existing.agentNames.push(station.name);
      } else {
        byText.set(finding.text, { text: finding.text, agentNames: [station.name], recommendationStatus: finding.recommendationStatus });
      }
    }
  }
  return Array.from(byText.values());
}

/** One agent as a living orb, positioned on the ring around the Core via the shared agent-layout function (the same one ReasoningGraph and the Core's burst particles use). Decorative inner glow/breathing/approach; the real state is always the visible caption + aria-label, never color or motion alone. */
function AgentOrb({ agent, index, total, onClick }: { agent: AgentStationData; index: number; total: number; onClick: () => void }) {
  const style = AGENT_ORB_STYLE[agent.state];
  const { x, y, angle } = agentPositionPercent(index, total);
  const reducedMotion = useReducedMotion();
  // A small, fixed nudge toward the Core while genuinely WORKING — never a
  // relocation of the orb's own orbit slot (that would detach its label from
  // where the ReasoningGraph's spoke/the burst particles point), just its
  // inner glow visibly leaning toward the center it's exchanging data with.
  // Skipped under prefers-reduced-motion: the state is still fully visible
  // in the two text lines right below it either way.
  const approaching = agent.state === "WORKING" && !reducedMotion;
  const approachX = approaching ? -Math.cos(angle) * 10 : 0;
  const approachY = approaching ? -Math.sin(angle) * 10 : 0;
  // FASE 9B — JARVIS-inspired composition: an agent that genuinely has
  // nothing live to show (IDLE/NOT_IN_LATEST_RUN — the same real states
  // isAgentActive() above already distinguishes) recedes visually instead
  // of competing with the Core; the moment its real state changes, the
  // state label/orb regain full presence. Still entirely state-driven —
  // never a timer, never hidden (the name/state text stay in the DOM and
  // in aria-label either way), only dimmer.
  const dormant = !isAgentActive(agent.state);
  // FASE 9C — "agentes parcialmente atrás; agentes parcialmente à frente":
  // a fixed-per-agent depth (agent-layout.ts, same deterministic source the
  // ring position already comes from) scales/dims the whole orb slightly
  // and stacks nearer-reading agents above farther-reading ones — a cheap
  // parallax illusion for a DOM ring, never a real 3D engine.
  const depth = agentDepth(index);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${agent.name} — ${agent.stateLabel}`}
      className={`qg-agent-orb${dormant ? " qg-agent-orb-dormant" : ""}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        zIndex: Math.round(depth * 10),
        "--orb-color": style.color,
        "--orb-glow": style.glow,
        "--orb-speed": style.speed,
        "--orb-depth": depth,
      } as React.CSSProperties}
    >
      <motion.span
        className="qg-agent-orb-core"
        aria-hidden
        animate={{ x: approachX, y: approachY, scale: style.scale }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 16 }}
      />
      <span className="qg-agent-orb-label">{agent.name}</span>
      <span className="qg-agent-orb-state">{agent.stateLabel}</span>
    </button>
  );
}

/** A compact, non-radial stand-in for the agent ring on narrow screens — a
 * 7-orb circle has no room to breathe once the viewport (and, pre-existing/
 * out of scope, the AppShell's fixed sidebar) squeeze the column down to a
 * couple hundred pixels; a wrapped row of small chips stays legible where a
 * tight ring would overlap its own labels. Hidden above the same breakpoint
 * that hides it is shown below (see .qg-agent-ring/.qg-agent-list-mobile in
 * globals.css) — same data, same click target, just a different shape. */
function AgentChip({ agent, onClick }: { agent: AgentStationData; onClick: () => void }) {
  const style = AGENT_ORB_STYLE[agent.state];
  return (
    <button type="button" onClick={onClick} aria-label={`${agent.name} — ${agent.stateLabel}`} className="qg-agent-chip">
      <span className="qg-agent-chip-dot" style={{ backgroundColor: style.color, boxShadow: `0 0 6px 1px ${style.glow}` }} aria-hidden />
      <span>{agent.name}</span>
    </button>
  );
}

/** A small, low-priority link — the secondary features (Missions, Workshop, Arquivo, Mesa de reunião, Relatórios, Relógio) that must stay reachable without competing with the Core. No orb treatment, no furniture: scope is the Core + agents + command + synthesis; these stay a minimal icon-link row. */
function MinimalLink({
  icon,
  label,
  onClick,
  href,
  ariaLabel,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  ariaLabel: string;
}) {
  const className = "qg-minimal-link";
  const inner = (
    <>
      {icon}
      <span>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={className}>
      {inner}
    </button>
  );
}

/** The mission synthesis — the one piece of contextual text the brief asks for, reusing exactly the numbers page.tsx already computed. Recommendations pending is folded in here (the loudest line) instead of being a separate object. Head has no orb of its own (decision: stays conceptually part of the Core) — this panel, sitting directly beneath the Core, is where its voice lives. */
function MissionSynthesis({ data, onOpenHead }: { data: QgOfficeData; onOpenHead: () => void }) {
  const hasPending = data.pendingCount > 0;
  return (
    <div className="qg-synthesis">
      {hasPending ? (
        <>
          <p className="qg-synthesis-alert">⚠ Precisa da sua atenção</p>
          <p className="qg-synthesis-line">
            {data.pendingCount} recommendation{data.pendingCount === 1 ? "" : "s"} aguardando decisão
          </p>
          <Link href="/product-intelligence" className="qg-synthesis-cta">
            Analisar
          </Link>
        </>
      ) : (
        <>
          <p className="qg-synthesis-line">{data.head.summary ?? "Aguardando o próximo comando."}</p>
          {data.latestMission ? (
            <p className="qg-synthesis-meta">
              Última missão: {data.latestMission.target} · {data.head.totalFindings} finding(s) · {data.approvedCount} aprovada(s)
            </p>
          ) : null}
        </>
      )}
      <button type="button" onClick={onOpenHead} className="qg-synthesis-more">
        Ver detalhes
      </button>
    </div>
  );
}

interface ActivityState {
  coreActivity: number;
  activeAgentIds: Set<string>;
  pulseKey: number;
  burst: BurstEvent | null;
  claude: { active: boolean; failed: boolean };
  github: { active: boolean; configured: boolean; repoCount: number | null } | null;
  /** True from the moment a real confirmation token round-trip resolved (the Panel is showing "Confirmar ação") until the human explicitly confirms or cancels — see command-center.tsx's "awaiting-decision"/"decision-resolved"/"action-done" events. Never set by a timer; only ever by that real state transition. */
  awaitingDecision: boolean;
  /** Transient tint for a Brain-triggered mission that really ended FAILED/BLOCKED this turn — decays together with coreActivity, same as the rest of this choreography. Independent of coreAlert (data.globalStatus), which only reflects the page's own last server-rendered snapshot. */
  transientAlert: boolean;
  statusMessage: string;
}

const IDLE_ACTIVITY: ActivityState = {
  coreActivity: 0,
  activeAgentIds: new Set(),
  pulseKey: 0,
  burst: null,
  claude: { active: false, failed: false },
  github: null,
  awaitingDecision: false,
  transientAlert: false,
  statusMessage: "",
};

export function LivingLabRoom({ data }: { data: QgOfficeData }) {
  const [panel, setPanel] = useState<PanelState>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityState>(IDLE_ACTIVITY);
  // FASE 9C — the same real prefers-reduced-motion read every CSS/Framer
  // Motion layer in this file already honors, now also threaded into the
  // WebGL Core (LabCore -> LabCoreScene's own uReducedMotion uniform) — the
  // one real gap earlier phases had explicitly registered and left open.
  // `?? false` only matters for the one SSR-render tick before this hook
  // resolves client-side; it never causes a hydration mismatch since
  // useReducedMotion() itself already renders `undefined` server-side.
  const reducedMotion = useReducedMotion() ?? false;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const claudeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const githubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstIdRef = useRef(0);

  const activeAgent = panel?.type === "agent" ? data.stations.find((s) => s.id === panel.agentId) : undefined;
  const discoveryFindings = buildDiscoveryFindings(data.stations);

  // The Core's two steady inputs — both derived from already-existing data,
  // never randomized: a RUNNING mission wakes it up (intensity), anything
  // other than HEALTHY tints it (alert). `activity.coreActivity` is a third,
  // transient input layered on top by the choreography below, decaying back
  // to 0 on its own once a result has been shown.
  const missionRunning = data.latestMission?.status === "RUNNING";
  const coreIntensity = missionRunning ? 1 : 0.22;
  const coreAlert = data.globalStatus !== "HEALTHY" || activity.transientAlert;

  /**
   * The post-command choreography. Every step here only dramatizes a result
   * the Server Action has ALREADY returned — there is no live streaming of
   * an in-progress mission (the backend has none), so "pending" just means
   * "waiting for the one real round-trip," and "result" replays what came
   * back.
   *
   * Two sources feed `activeAgentIds` here, never invented:
   * - An Operational Brain reply always carries its own real `brainSignal`
   *   (see brain-state.ts) — the real agent ids it actually selected for a
   *   mission it just triggered, and the real status that mission actually
   *   ended with. This is the ONLY reliable source for a Brain-triggered
   *   mission: the page's own server-rendered `data.stations` was computed
   *   at the last page load/navigation and has no way of reflecting a
   *   mission the Brain just ran client-side, in this same session.
   * - An exact Command Router result (matchCommand) never sets a
   *   `brainSignal` — those read-only commands don't change which agents
   *   are "active" in the LAB's own real sense, so this keeps the original,
   *   unchanged heuristic (derived from `data.stations[].state`, i.e. "the
   *   agents the last real Evaluation Mission actually involved").
   */
  const handleCommandActivity = useCallback(
    (event: CommandCenterActivity) => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (burstReturnTimer.current) clearTimeout(burstReturnTimer.current);

      if (event.phase === "pending") {
        setActivity((prev) => ({ ...prev, coreActivity: 1, statusMessage: "Comando enviado ao LAB Core." }));
        return;
      }

      if (event.phase === "awaiting-decision") {
        // A real confirmation token round-trip just resolved — the system
        // has reached a point only a human can move past. Held at a
        // deliberately calmer, sustained plateau (never 0 — something real
        // is still pending; never 1 — that reads as "working," not "waiting
        // on you") until the human actually confirms or cancels. No settle
        // timer is scheduled: this state only ends on a real decision.
        setActivity((prev) => ({ ...prev, coreActivity: 0.35, awaitingDecision: true, statusMessage: "Aguardando sua decisão." }));
        return;
      }

      if (event.phase === "decision-resolved") {
        setActivity((prev) => ({ ...prev, awaitingDecision: false, statusMessage: "Decisão cancelada." }));
        settleTimer.current = setTimeout(() => {
          setActivity((prev) => ({ ...prev, coreActivity: 0 }));
        }, 800);
        return;
      }

      if (event.phase === "result") {
        const brainAgentIds = event.brainSignal?.agentIds ?? null;
        const activeIds = brainAgentIds ? new Set(brainAgentIds) : new Set(data.stations.filter((s) => isAgentActive(s.state)).map((s) => s.id));
        const firstActiveIndex = data.stations.findIndex((s) => activeIds.has(s.id));

        const pendingNote = data.pendingCount > 0 ? ` ${data.pendingCount} recommendation(s) aguardando decisão.` : "";
        const missionNote = event.brainSignal?.missionStatus ? ` Missão real: ${event.brainSignal.missionStatus}.` : "";
        const message =
          activeIds.size > 0
            ? `Resultado recebido. ${activeIds.size} agente(s) com atividade registrada.${missionNote}${pendingNote}`
            : `Resultado recebido.${missionNote}${pendingNote}`;

        burstIdRef.current += 1;
        const outBurst: BurstEvent | null =
          firstActiveIndex >= 0 ? { id: burstIdRef.current, mode: "out", agentIndex: firstActiveIndex, agentCount: data.stations.length } : null;

        setActivity((prev) => ({
          ...prev,
          coreActivity: 1,
          activeAgentIds: activeIds,
          pulseKey: prev.pulseKey + 1,
          burst: outBurst,
          transientAlert: event.brainSignal?.missionStatus === "FAILED" || event.brainSignal?.missionStatus === "BLOCKED",
          statusMessage: message,
        }));

        // Step "convergência": the information returns to the Core shortly after.
        if (firstActiveIndex >= 0) {
          burstReturnTimer.current = setTimeout(() => {
            burstIdRef.current += 1;
            setActivity((prev) => ({ ...prev, burst: { id: burstIdRef.current, mode: "in", agentIndex: firstActiveIndex, agentCount: data.stations.length } }));
          }, 900);
        }

        // Step "síntese": settle back to a calm idle a few seconds later.
        settleTimer.current = setTimeout(() => {
          setActivity((prev) => ({ ...prev, coreActivity: 0, activeAgentIds: new Set(), burst: null, transientAlert: false }));
        }, 3200);

        // GitHub's own latent node — only ever mounted because the Brain
        // really queried GitHub this turn (see brain-state.ts's own doc
        // comment on `github`), honest either way: "not configured" gets
        // its own dimmer, neutral treatment, never the failed/red styling.
        if (event.brainSignal?.github) {
          const { configured, repoCount } = event.brainSignal.github;
          setActivity((prev) => ({ ...prev, github: { active: true, configured, repoCount } }));
          if (githubTimer.current) clearTimeout(githubTimer.current);
          githubTimer.current = setTimeout(() => {
            setActivity((prev) => ({ ...prev, github: null }));
          }, 3000);
        }
        return;
      }

      if (event.phase === "mission-progress") {
        // FASE 11 — Mission Lifecycle: a real, polled snapshot of a mission
        // that is still RUNNING (or just reached a terminal status between
        // polls). Every agent touched so far (completed, failed, or
        // currently running) gets the exact same "active" visual treatment
        // the "result" phase already gives agents at the very end — this
        // just feeds it real, incremental facts instead of only the final
        // one. Never schedules a settle timer itself: a genuinely finished
        // mission is reported by the real "result" event from the turn that
        // triggered it, not by this polling channel going quiet.
        const { lifecycle } = event;
        const touchedIds = new Set([...lifecycle.completedAgentIds, ...lifecycle.failedAgentIds, ...(lifecycle.runningAgentId ? [lifecycle.runningAgentId] : [])]);
        const done = lifecycle.completedAgentIds.length + lifecycle.failedAgentIds.length;
        const total = lifecycle.requestedAgentIds.length;
        const message =
          lifecycle.status !== "RUNNING"
            ? "Missão finalizando."
            : done === 0
              ? `Analisando — ${total} agente(s) selecionado(s).`
              : `Analisando — ${done} de ${total} agente(s) concluído(s).`;
        setActivity((prev) => ({ ...prev, coreActivity: 0.7, activeAgentIds: touchedIds, statusMessage: message }));
        return;
      }

      // event.phase === "action-done" — the only moment Claude's latent node
      // is allowed to appear, and only because a real Server Action already
      // returned (never before, never to represent something in progress).
      // Also the real end of "awaiting-decision" when the human confirmed
      // (as opposed to cancelled, handled above).
      const label = event.action === "CREATE_IMPLEMENTATION" ? "Implementation" : "Validation";
      setActivity((prev) => ({
        ...prev,
        claude: { active: true, failed: event.failed },
        awaitingDecision: false,
        statusMessage: event.failed ? `Claude Code: ${label} não pôde ser executada.` : `Claude Code: ${label} executada com sucesso.`,
      }));
      if (claudeTimer.current) clearTimeout(claudeTimer.current);
      claudeTimer.current = setTimeout(() => {
        setActivity((prev) => ({ ...prev, claude: { active: false, failed: false } }));
      }, 3000);
    },
    [data.stations, data.pendingCount],
  );

  return (
    <div className="qg-living-space">
      {/* Every real event this page animates also lands here as plain text — the Canvas/SVG layers are never the only place a state change is communicated. */}
      <div role="status" aria-live="polite" className="sr-only">
        {activity.statusMessage}
      </div>

      {/*
       * FASE 9D — the header stopped being a bar: it's two small corner
       * marks floating directly over the organism, nothing in between.
       * "Voltar ao LAB" and the status stay real and reachable; the full
       * Navigator (6 links) and the secondary feature links move into the
       * Quick View drawer below — same real hrefs/functionality, just no
       * longer forming a permanent horizontal strip across the top.
       */}
      <div className="qg-corner qg-corner-left">
        <Link href="/" className="qg-mark" aria-label="Voltar ao LAB">
          <ArrowLeft size={12} aria-hidden />
          <span>Voltar ao LAB</span>
        </Link>
      </div>

      <div className="qg-corner qg-corner-right">
        <span className="qg-status-chip">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[data.globalStatus]}`} aria-hidden />
          <span className="sr-only">LAB </span>
          <span className="qg-status-chip-label">{data.globalStatusLabel}</span>
        </span>
        <button type="button" onClick={() => setQuickViewOpen((v) => !v)} aria-pressed={quickViewOpen} aria-label="Quick View" className="qg-quickview-toggle">
          <span aria-hidden>⋯</span>
        </button>
      </div>

      {/*
       * FASE 9D — the organism itself: Core, Reasoning Graph and the agent
       * ring, absolutely centered (slightly above geometric middle) in the
       * same space as everything else — no stage container, no card, no
       * background of its own. Position/size live entirely in globals.css
       * now (.qg-core-stage), not in a flex layout computed from sibling
       * heights — the exact kind of "page containing a Core" composition
       * this phase is replacing.
       */}
      <div className="qg-core-stage" aria-label="LAB Core">
        <LabCore intensity={coreIntensity} alert={coreAlert} activity={activity.coreActivity} burst={activity.burst} reducedMotion={reducedMotion} />
        <ReasoningGraph stations={data.stations} activeAgentIds={activity.activeAgentIds} pulseKey={activity.pulseKey} claudeActive={activity.claude.active} />
        <div className="qg-agent-ring">
          {data.stations.map((agent, i) => (
            <AgentOrb key={agent.id} agent={agent} index={i} total={data.stations.length} onClick={() => setPanel({ type: "agent", agentId: agent.id })} />
          ))}
        </div>
        {activity.claude.active ? (
          <div className={`qg-claude-label ${activity.claude.failed ? "qg-claude-label-failed" : ""}`}>Claude Code</div>
        ) : null}
        {activity.github ? (
          <div className={`qg-github-label ${!activity.github.configured || activity.github.repoCount === null ? "qg-github-label-unconfigured" : ""}`}>
            {!activity.github.configured
              ? "GitHub — não configurado"
              : activity.github.repoCount === null
                ? "GitHub — erro ao consultar"
                : `GitHub — ${activity.github.repoCount} repositório(s)`}
          </div>
        ) : null}
      </div>

      <div className="qg-agent-list-mobile">
        {data.stations.map((agent) => (
          <AgentChip key={agent.id} agent={agent} onClick={() => setPanel({ type: "agent", agentId: agent.id })} />
        ))}
      </div>

      {/* FASE 9D — synthesis + command bar now live together as one small
          bottom cluster, absolutely anchored — never pushing or being pushed
          by anything else, since nothing else is in normal flow anymore. */}
      <div className="qg-bottom-cluster">
        <MissionSynthesis data={data} onOpenHead={() => setPanel({ type: "head" })} />
        <div className="qg-command-dock">
          <div className="qg-command-scope">
            <CommandCenterConsole onActivity={handleCommandActivity} />
          </div>
        </div>
      </div>

      {quickViewOpen ? (
        <aside className="qg-quickview text-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-white/60">Quick View</p>
            <button type="button" onClick={() => setQuickViewOpen(false)} aria-label="Fechar Quick View" className="text-white/60 hover:text-white">
              ×
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[data.globalStatus]}`} aria-hidden />
              <span className="text-sm font-medium text-white">{data.globalStatusLabel}</span>
            </div>
            {data.latestMission ? (
              <p className="text-xs text-white/60">
                Última avaliação: <span className="text-white">{data.latestMission.target}</span> · {data.latestMission.specialistCount} especialista(s)
              </p>
            ) : (
              <p className="text-xs text-white/60">Nenhuma avaliação executada ainda.</p>
            )}
            <p className="text-xs text-white/60">
              Recommendations: <span className="text-white">{data.pendingCount} pendente(s)</span> · {data.approvedCount} aprovada(s) · {data.ignoredCount} ignorada(s)
            </p>
            <p className="text-xs text-white/60">Avaliações no histórico: {data.missionHistoryCount}</p>
            {data.latestMission ? (
              <Link href={`/test-lab/missions/${data.latestMission.id}`} className="text-xs text-white underline">
                Ver última mission
              </Link>
            ) : null}
          </div>

          <nav className="qg-navigator mt-4" aria-label="Navegação do LAB">
            <Link href="/qg">QG</Link>
            <span aria-hidden>·</span>
            <Link href="/test-lab">Test Lab</Link>
            <span aria-hidden>·</span>
            <Link href="/product-intelligence">Product Intelligence</Link>
            <span aria-hidden>·</span>
            <Link href="/agents">Agents</Link>
            <span aria-hidden>·</span>
            <Link href="/projects">Projects</Link>
            <span aria-hidden>·</span>
            <Link href="/settings">Settings</Link>
          </nav>

          <div className="qg-minimal-links mt-3">
            <MinimalLink icon={<LogIn size={14} />} label="Entrada" onClick={() => setQuickViewOpen(true)} ariaLabel="Entrada do LAB — abrir Quick View" />
            <MinimalLink icon={<Clock size={14} />} label="Relógio" onClick={() => setPanel({ type: "clock" })} ariaLabel="Relógio — hora e agenda" />
            <MinimalLink
              icon={<Search size={14} />}
              label="Missions"
              onClick={() => setPanel({ type: "mission" })}
              ariaLabel={
                data.latestMission
                  ? `Missions — última avaliação: ${data.latestMission.target}, status ${data.latestMission.status}`
                  : "Missions — nenhuma avaliação executada ainda"
              }
            />
            <MinimalLink
              icon={<Wrench size={14} />}
              label="Workshop"
              href="/product-intelligence"
              ariaLabel={`Workshop — Implementation — ${data.approvedCount} tarefa(s) aprovada(s)`}
            />
            <MinimalLink icon={<Users size={14} />} label="Mesa de reunião" onClick={() => setPanel({ type: "meeting" })} ariaLabel="Mesa de reunião — ver visão consolidada da equipe" />
            <MinimalLink
              icon={<Archive size={14} />}
              label="Arquivo"
              href="/product-intelligence#historico"
              ariaLabel={`Archive — histórico de avaliações (${data.missionHistoryCount})`}
            />
            <MinimalLink icon={<FileText size={14} />} label="Relatórios" onClick={() => setPanel({ type: "reports" })} ariaLabel="Relatórios — abrir Weekly Report" />
            <MinimalLink
              icon={<Search size={14} />}
              label="Findings"
              onClick={() => setPanel({ type: "findings" })}
              ariaLabel={`Findings — ${discoveryFindings.length} descoberta(s) na última avaliação`}
            />
          </div>
        </aside>
      ) : null}

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

      {panel?.type === "mission" ? (
        <Panel title="Missions" onClose={() => setPanel(null)}>
          {data.latestMission ? (
            <>
              <p className="text-muted">
                Alvo: <span className="text-foreground">{data.latestMission.target}</span>
              </p>
              <p className="mt-2 text-xs text-muted">
                Status: <span className="font-medium text-foreground">{data.latestMission.status}</span> · {data.latestMission.specialistCount} especialista(s) solicitado(s)
              </p>
              <p className="mt-2 text-xs text-muted">Executada em {new Date(data.latestMission.createdAt).toLocaleString("en-US")}</p>
              <div className="mt-4 flex flex-col gap-1">
                <Link href={`/test-lab/missions/${data.latestMission.id}`} className="text-xs underline">
                  Ver detalhes desta mission
                </Link>
                <Link href="/product-intelligence#historico" className="text-xs underline">
                  Ver histórico completo de avaliações
                </Link>
              </div>
            </>
          ) : (
            <p className="text-muted">Nenhuma Evaluation Mission foi executada ainda.</p>
          )}
        </Panel>
      ) : null}

      {panel?.type === "findings" ? (
        <Panel title="Findings" onClose={() => setPanel(null)}>
          {discoveryFindings.length > 0 ? (
            <div className="flex flex-col gap-2">
              {discoveryFindings.map((f, i) => (
                <div key={i} className="rounded-md border border-border p-3 text-xs">
                  <p>{f.text}</p>
                  <p className="mt-1 text-muted">
                    Encontrado por: {f.agentNames.join(", ")}
                    {f.recommendationStatus ? ` · Recommendation: ${f.recommendationStatus}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">Nenhum finding registrado na última avaliação.</p>
          )}
        </Panel>
      ) : null}

      {panel?.type === "agent" && activeAgent ? (
        <Panel title={activeAgent.name} onClose={() => setPanel(null)}>
          <p className="text-muted">{activeAgent.objective}</p>
          <p className="mt-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: AGENT_ORB_STYLE[activeAgent.state].color }} aria-hidden />
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
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: AGENT_ORB_STYLE[agent.state].color }} aria-hidden />
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

function ClockPanel({ latestMission, onClose }: { latestMission: QgOfficeData["latestMission"]; onClose: () => void }) {
  const [now] = useState(() => new Date());
  return (
    <Panel title="Relógio" onClose={onClose}>
      <p className="text-2xl font-semibold tabular-nums">{now.toLocaleTimeString("en-US")}</p>
      <p className="mt-1 text-xs text-muted">{now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      <p className="mt-4 text-xs text-muted">
        Última atividade registrada no LAB: {latestMission ? new Date(latestMission.createdAt).toLocaleString("en-US") : "nenhuma avaliação executada ainda"}
      </p>
      <p className="mt-2 text-xs text-muted">Nenhuma agenda definida.</p>
    </Panel>
  );
}
