"use client";

import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { BurstEvent } from "./lab-core-scene";

const LabCoreScene = dynamic(() => import("./lab-core-scene").then((m) => m.LabCoreScene), {
  ssr: false,
  loading: () => <LabCoreFallback />,
});

/** CSS-only breathing circle — used whenever WebGL is unavailable, still loading, lost, or the 3D scene throws. Never leaves the Core absent; the organism is always visibly alive, just via a cheaper layer. */
export function LabCoreFallback() {
  return (
    <div className="qg-core-fallback" aria-hidden>
      <div className="qg-core-fallback-ring" />
      <div className="qg-core-fallback-pulse" />
    </div>
  );
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
  } catch {
    return false;
  }
}

/**
 * A real WebGL/shader failure (driver quirk, old GPU) must never take the
 * whole QG page down with it — the Core degrades to the same CSS fallback
 * used for "WebGL unsupported", silently. Class component because React
 * error boundaries have no hook equivalent. A context-LOSS (as opposed to a
 * render exception) is handled separately below, in LabCore itself, since
 * `webglcontextlost` fires as a DOM event, not a React render error.
 */
class CoreErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return <LabCoreFallback />;
    return this.props.children;
  }
}

/**
 * FASE 2 — the LAB Core: a living shader organism when WebGL is available,
 * a CSS breathing circle otherwise. `intensity`/`alert` are derived from
 * real QG data (see living-lab-room.tsx); `activity` is a transient 0-1
 * pulse the parent bumps whenever a real Command Center result just came
 * back, then lets decay — never randomized, never a standalone animation
 * loop unrelated to actual LAB state. `burst`, when set, fires one
 * pre-allocated particle burst traveling to/from a given agent's position.
 */
export function LabCore({ intensity, alert, activity, burst }: { intensity: number; alert: boolean; activity: number; burst: BurstEvent | null }) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  // Incrementing this remounts LabCoreScene with a fresh Canvas/WebGL
  // context after a restore, rather than trying to manually re-upload every
  // buffer/uniform into the restored context by hand.
  const [sceneKey, setSceneKey] = useState(0);

  useEffect(() => {
    // Detecting WebGL touches `window`/`document`, unavailable during SSR;
    // computing it inline during render would mismatch the server-rendered
    // markup on hydration, so this one-time client-only check has to live in
    // an effect rather than be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebglOk(supportsWebGL());
  }, []);

  const handleContextLost = useCallback(() => {
    setWebglOk(false);
  }, []);

  const handleContextRestored = useCallback(() => {
    setSceneKey((key) => key + 1);
    setWebglOk(true);
  }, []);

  if (!webglOk) return <LabCoreFallback />;

  return (
    <CoreErrorBoundary>
      <LabCoreScene
        key={sceneKey}
        intensity={intensity}
        alert={alert}
        activity={activity}
        burst={burst}
        onContextLost={handleContextLost}
        onContextRestored={handleContextRestored}
      />
    </CoreErrorBoundary>
  );
}
