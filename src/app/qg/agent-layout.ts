/**
 * The one place that decides where an agent sits around the Core. Every
 * visual layer that needs an agent's position — the DOM orb ring
 * (living-lab-room.tsx), the SVG spokes (reasoning-graph.tsx), and the
 * WebGL burst particles' travel direction (lab-core-scene.tsx) — calls this
 * same function, so they can never drift into three different layouts for
 * the same seven agents.
 */
export function agentAngle(index: number, total: number): number {
  return (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
}

/** Position as a percentage pair (0-100), the coordinate space both the DOM ring and the SVG overlay already share (a 100x100 viewBox laid directly over the same stage box). */
export function agentPositionPercent(index: number, total: number, radiusPercent = 40): { x: number; y: number; angle: number } {
  const angle = agentAngle(index, total);
  return { x: 50 + radiusPercent * Math.cos(angle), y: 50 + radiusPercent * Math.sin(angle), angle };
}

/** A unit direction in the Core's own 3D space (XY plane, Z=0) for a given agent index — used only to aim a burst of particles roughly toward "where that agent sits," not as a pixel-exact projection of the DOM ring into the WebGL scene (the Core canvas and the DOM ring are two separate layers occupying the same stage; this keeps their angles consistent without needing real screen-space coordinate mapping). */
export function agentDirection3D(index: number, total: number): { x: number; y: number } {
  const angle = agentAngle(index, total);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
