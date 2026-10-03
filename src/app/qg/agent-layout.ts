/**
 * The one place that decides where an agent sits around the Core. Every
 * visual layer that needs an agent's position — the DOM orb ring
 * (living-lab-room.tsx), the SVG spokes (reasoning-graph.tsx), and the
 * WebGL burst particles' travel direction (lab-core-scene.tsx) — calls this
 * same function, so they can never drift into three different layouts for
 * the same seven agents.
 */

/**
 * FASE 9C — a deterministic (never `Math.random()`) pseudo-random value in
 * [0, 1) for a given seed. The brief explicitly asks for agents that "não
 * [usem] posições matematicamente perfeitas" — a perfect even ring reads as
 * a diagram; a small, fixed-per-agent offset reads as an organic system,
 * while staying exactly reproducible (same agent, same seed, same offset
 * every render — never jittering on its own between renders).
 *
 * Deliberately integer/bitwise only (xorshift), never `Math.sin()`-based
 * hashing (the common GLSL "hash via sin" trick): ECMAScript's spec leaves
 * `Math.sin`/`Math.cos` as "implementation-approximated," so the exact same
 * input can legitimately round to a different last bit between Node.js
 * (this page's server render) and the browser (its client render) — caught
 * live as a real hydration mismatch during this phase's own validation.
 * Bitwise operators, by contrast, are specified to coerce to an exact
 * Int32/Uint32 per the spec, so this hash is bit-identical everywhere.
 */
function pseudoRandom(seed: number): number {
  let x = Math.floor(seed * 1000) | 0;
  x = (x ^ (x << 13)) | 0;
  x = (x ^ (x >>> 17)) | 0;
  x = (x ^ (x << 5)) | 0;
  return (x >>> 0) / 4294967296;
}

export function agentAngle(index: number, total: number): number {
  const base = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  const jitter = (pseudoRandom(index * 7.31 + 1.7) - 0.5) * 0.3;
  return base + jitter;
}

/** Position as a percentage pair (0-100), the coordinate space both the DOM ring and the SVG overlay already share (a 100x100 viewBox laid directly over the same stage box). Radius itself gets the same small, fixed-per-agent variation as the angle — "distâncias diferentes" from the brief, never a uniform ring. */
export function agentPositionPercent(index: number, total: number, radiusPercent = 40): { x: number; y: number; angle: number } {
  const angle = agentAngle(index, total);
  const radiusFactor = 1 + (pseudoRandom(index * 3.17 + 9.1) - 0.5) * 0.3;
  const r = radiusPercent * radiusFactor;
  return { x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle), angle };
}

/** A unit direction in the Core's own 3D space (XY plane, Z=0) for a given agent index — used only to aim a burst of particles roughly toward "where that agent sits," not as a pixel-exact projection of the DOM ring into the WebGL scene (the Core canvas and the DOM ring are two separate layers occupying the same stage; this keeps their angles consistent without needing real screen-space coordinate mapping). */
export function agentDirection3D(index: number, total: number): { x: number; y: number } {
  const angle = agentAngle(index, total);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * FASE 9C — a deterministic 0.78–1.22 depth factor per agent: "agentes
 * parcialmente atrás; agentes parcialmente à frente" from the brief,
 * without a real 3D engine for the DOM ring. AgentOrb uses it to scale and
 * dim an orb slightly, which combined with its own real state-driven glow
 * reads as parallax/depth rather than a flat, uniform ring of identical
 * discs.
 */
export function agentDepth(index: number): number {
  return 0.78 + pseudoRandom(index * 5.53 + 2.2) * 0.44;
}
