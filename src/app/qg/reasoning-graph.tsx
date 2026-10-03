"use client";

import type { AgentStationData } from "./living-lab-room";
import { agentPositionPercent } from "./agent-layout";

/**
 * FASE 2 — the ReasoningGraph. Deliberately small: a straight spoke from the
 * Core to each real agent (never a full mesh, never force-directed — the
 * brief is explicit that this must reinforce "one organism," not become a
 * network diagram), using the exact same agentPositionPercent() the DOM
 * orb ring already places its orbs with, so the lines always point at where
 * the real orbs actually are. Idle: faint, static. During real activity: the
 * relevant spokes brighten and a small dot travels along them once, via a
 * plain CSS keyframe (remounted by `pulseKey` on every new real event) —
 * no SMIL, no per-frame JS, no dependency.
 *
 * Purely decorative (aria-hidden): every fact it visualizes — which agent is
 * active, whether a finding was found, whether Claude Code ran — already has
 * a real text equivalent elsewhere (the orb's own label/aria-label, the
 * role="status" region in living-lab-room.tsx, the Panels). This graph is
 * never the only place a piece of real state is communicated.
 */
export function ReasoningGraph({
  stations,
  activeAgentIds,
  pulseKey,
  claudeActive,
}: {
  stations: AgentStationData[];
  activeAgentIds: Set<string>;
  pulseKey: number;
  claudeActive: boolean;
}) {
  const total = stations.length;
  // Claude's node sits further out than the agent ring, straight down from
  // the Core — a distinct, separate position so it never reads as an 8th
  // agent orbiting alongside the real seven.
  const claudeNodeY = 96;

  return (
    <svg className="qg-reasoning-graph" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {stations.map((agent, i) => {
        const { x, y } = agentPositionPercent(i, total);
        const active = activeAgentIds.has(agent.id);
        return (
          <g key={agent.id} className={active ? "qg-graph-spoke qg-graph-spoke-active" : "qg-graph-spoke"}>
            <line x1={50} y1={50} x2={x} y2={y} />
            {active ? (
              <circle
                key={pulseKey}
                className="qg-graph-flow-dot"
                cx={50}
                cy={50}
                r={1.1}
                style={{ "--dx": `${x - 50}px`, "--dy": `${y - 50}px` } as React.CSSProperties}
              />
            ) : null}
          </g>
        );
      })}

      {claudeActive ? (
        <g className="qg-graph-claude-node">
          <line x1={50} y1={50} x2={50} y2={claudeNodeY} />
          <circle cx={50} cy={claudeNodeY} r={2.2} />
        </g>
      ) : null}
    </svg>
  );
}
