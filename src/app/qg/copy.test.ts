import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const roomSource = readFileSync(fileURLToPath(new URL("./living-lab-room.tsx", import.meta.url)), "utf-8");
const pageSource = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const coreSource = readFileSync(fileURLToPath(new URL("./lab-core.tsx", import.meta.url)), "utf-8");
const coreSceneSource = readFileSync(fileURLToPath(new URL("./lab-core-scene.tsx", import.meta.url)), "utf-8");
const reasoningGraphSource = readFileSync(fileURLToPath(new URL("./reasoning-graph.tsx", import.meta.url)), "utf-8");
const commandCenterSource = readFileSync(fileURLToPath(new URL("./command-center.tsx", import.meta.url)), "utf-8");
const agentsIndexSource = readFileSync(fileURLToPath(new URL("../../../agents/index.ts", import.meta.url)), "utf-8");
const globalsCssSource = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf-8");

/**
 * FASE 1 — "Living Intelligence Interface" (replaces the Rodada 1-3 room/
 * furniture metaphor entirely). These tests pin the new real copy/structure
 * while preserving every original guarantee's *intent* — never a fabricated
 * agent state, always a way back, Recommendations as the loudest signal
 * whenever pending, every count carrying its own label, every real feature
 * still reachable — not any prior round's exact wording or visual metaphor.
 */
describe("LAB QG living interface", () => {
  it("keeps every real feature reachable, even though the room/zoom metaphor is gone", () => {
    for (const feature of [
      "Entrada",
      "Head",
      "Relógio",
      "Missions",
      "Workshop",
      "Mesa de reunião",
      "Arquivo",
      "Relatórios",
      "Findings",
    ]) {
      expect(roomSource).toContain(feature);
    }
  });

  it("offers a way back to the LAB, never trapping the user", () => {
    expect(roomSource).toMatch(/Voltar ao LAB/);
    expect(roomSource).toContain('href="/"');
  });

  it("offers a Quick View that doesn't require opening every panel", () => {
    expect(roomSource).toMatch(/Quick View/);
  });

  it("offers a discreet Navigator linking every main area, without dominating the interface", () => {
    expect(roomSource).toContain("qg-navigator");
    for (const href of ['href="/qg"', 'href="/test-lab"', 'href="/product-intelligence"', 'href="/agents"', 'href="/projects"', 'href="/settings"']) {
      expect(roomSource).toContain(href);
    }
  });

  it("routes Test Lab, Product Intelligence and Arquivo to the real, existing pages instead of a duplicate flow", () => {
    expect(roomSource).toContain('href="/product-intelligence"');
  });

  it("never fabricates an agent's activity — every orb reads its state from the derived AgentQgState", () => {
    expect(pageSource).toContain("deriveAgentQgState");
  });

  it("computes the global status deterministically from real data, not from an invented score", () => {
    expect(pageSource).toContain("deriveGlobalStatus");
  });

  it("renders agents as living orbs with both a visible name and a visible state label, never color as the only signal", () => {
    expect(roomSource).toContain("AgentOrb");
    expect(roomSource).toContain("qg-agent-orb-label");
    expect(roomSource).toContain("qg-agent-orb-state");
    expect(roomSource).toMatch(/aria-label=\{`\$\{agent\.name\}/);
  });

  it("renders the LAB Core and drives it purely from real, already-derived LAB state — never a standalone/random animation", () => {
    expect(roomSource).toContain("<LabCore");
    expect(roomSource).toMatch(/missionRunning\s*=\s*data\.latestMission\?\.status\s*===\s*"RUNNING"/);
    expect(roomSource).toMatch(/coreAlert\s*=\s*data\.globalStatus\s*!==\s*"HEALTHY"/);
  });

  it("lazy-loads the WebGL Core and keeps a non-WebGL fallback, so the organism is never absent", () => {
    expect(coreSource).toMatch(/dynamic\([\s\S]*ssr:\s*false/);
    expect(coreSource).toContain("LabCoreFallback");
    expect(coreSource).toMatch(/getDerivedStateFromError/);
  });

  it("still hosts the real CommandCenterConsole, only reskinned externally and instrumented with an optional, additive activity callback", () => {
    expect(roomSource).toContain("<CommandCenterConsole onActivity={handleCommandActivity} />");
    expect(roomSource).toContain("qg-command-scope");
    // The instrumentation must be opt-in: the prop defaults away, so every
    // existing call site/test that doesn't pass it behaves identically.
    expect(commandCenterSource).toMatch(/onActivity\?:[\s\S]*?\}\s*=\s*\{\}/);
    // And it must still call through to the real routing/Server Actions/confirmation — never a bypass.
    for (const untouched of ["runQgCommandAction", "requestQgActionConfirmationAction", "confirmQgActionAction", "QG_COMMANDS"]) {
      expect(commandCenterSource).toContain(untouched);
    }
  });

  it("gives Recommendations the loudest treatment whenever one is pending, and a calm synthesis otherwise", () => {
    expect(roomSource).toMatch(/hasPending/);
    expect(roomSource).toMatch(/Precisa da sua atenção/);
    expect(roomSource).toMatch(/Analisar/);
  });

  it("renders Findings as a real panel sourced from the latest report, distinct from Recommendations", () => {
    expect(roomSource).toContain("buildDiscoveryFindings");
    expect(roomSource).toMatch(/type:\s*"findings"/);
  });

  it("gives every visible count an explicit, adjacent text label instead of a bare number", () => {
    expect(roomSource).toMatch(/recommendation\{data\.pendingCount === 1 \? "" : "s"\}/);
    expect(roomSource).toMatch(/aprovada\(s\)/);
  });

  it("respects prefers-reduced-motion for every new orb/Core-fallback/graph animation, without losing any information", () => {
    expect(globalsCssSource).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*qg-agent-orb-core[\s\S]*\}/);
    expect(globalsCssSource).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*qg-core-fallback-ring[\s\S]*\}/);
    expect(globalsCssSource).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*qg-graph-flow-dot[\s\S]*\}/);
    expect(roomSource).toContain("useReducedMotion");
  });

  it("always renders a role=status live region announcing the same real events the Core/ReasoningGraph dramatize, never relying on canvas/SVG alone", () => {
    expect(roomSource).toMatch(/role="status"/);
    expect(roomSource).toMatch(/aria-live="polite"/);
    expect(roomSource).toContain("statusMessage");
  });

  it("uses exactly the real agents from the registry — never invents Research, Head, or Claude as a station", () => {
    for (const realAgent of ["new-user", "qa-agent", "ux-agent", "accessibility-agent", "product-agent", "performance-agent", "security-agent"]) {
      expect(agentsIndexSource).toContain(realAgent);
    }
    expect(roomSource).not.toMatch(/"Research"/);
  });

  it("shares one single layout function across the orb ring, the ReasoningGraph, and the Core's burst particles — never three independent coordinate systems", () => {
    expect(roomSource).toContain("agentPositionPercent");
    expect(reasoningGraphSource).toContain("agentPositionPercent");
    expect(coreSceneSource).toContain("agentDirection3D");
  });

  it("renders the ReasoningGraph as plain straight spokes, never a force-directed graph or a full mesh of connections", () => {
    expect(roomSource).toContain("<ReasoningGraph");
    expect(reasoningGraphSource).toContain("<line");
    expect(reasoningGraphSource).not.toMatch(/from ["']d3/);
  });

  it("only lights Claude's node after a real, already-returned action result — never while it would still be in progress, and never permanently", () => {
    expect(reasoningGraphSource).toContain("claudeActive");
    // Claude's node must not be part of the always-rendered agent roster.
    expect(reasoningGraphSource).not.toMatch(/"Claude"/);
    expect(roomSource).toMatch(/action-done[\s\S]*CREATE_IMPLEMENTATION|CREATE_IMPLEMENTATION[\s\S]*action-done/);
    expect(roomSource).toContain("claudeTimer");
  });

  it("never fabricates a live-streamed mission in progress — the post-command choreography only replays a result the Server Action already returned", () => {
    expect(roomSource).toContain("CommandCenterActivity");
    expect(roomSource).not.toMatch(/WebSocket|EventSource|setInterval/);
  });

  it("drives the Core's burst particles from a fixed, pre-allocated pool — never a new Float32Array per event", () => {
    expect(coreSceneSource).toContain("MAX_BURST_SLOTS");
    expect(coreSceneSource).toMatch(/new Float32Array\(total \* 3\)/);
  });

  it("degrades a real WebGL context loss to the same CSS fallback, and can recover on restore", () => {
    expect(coreSceneSource).toContain("webglcontextlost");
    expect(coreSceneSource).toContain("webglcontextrestored");
    expect(coreSource).toContain("onContextLost");
    expect(coreSource).toContain("onContextRestored");
  });
});
