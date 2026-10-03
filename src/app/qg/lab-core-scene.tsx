"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { agentDirection3D } from "./agent-layout";

/**
 * FASE 1 — LAB Core shader. Original, written for this project (not copied
 * from any reference repo): a lightweight value-noise function (no external
 * noise library — "shaders simples" per the brief) displaces a low-poly
 * icosahedron's vertices for an organic, breathing surface, and a Fresnel
 * rim gives it the glowing-core look. `uIntensity`/`uAlert` are driven by
 * real LAB state (mission running / global status); `uActivity` is a
 * transient pulse layered on top whenever a real Command Center result just
 * came back (see LivingLabRoom) — never randomized or decorative-only.
 */
const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uActivity;
  uniform float uReducedMotion;
  varying vec3 vNormal;
  varying float vDisplacement;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vNormal = normalize(normalMatrix * normal);
    // FASE 9B — two octaves instead of one: the original single low-frequency
    // sample produced a handful of large, flat-looking panels (each
    // noticeably larger than the sphere's own facets) instead of an organic
    // texture. Layering a second, higher-frequency sample at a smaller
    // amplitude breaks that up into finer, more alive-looking detail —
    // still the same plain value-noise function, no new dependency.
    // FASE 9C — under prefers-reduced-motion, the noise still samples a
    // fixed point in time (no drifting animation) instead of freezing the
    // displacement outright: the surface stays genuinely organic/uneven
    // (never a perfectly smooth sphere, which would look like a regression,
    // not an accessibility accommodation), it just never animates.
    float timeTerm = uTime * (1.0 - uReducedMotion);
    float nBig = valueNoise(position * 1.6 + timeTerm * 0.12);
    float nFine = valueNoise(position * 4.2 - timeTerm * 0.18);
    float n = nBig * 0.7 + nFine * 0.3;
    float displacement = (n - 0.5) * (0.1 + uIntensity * 0.16 + uActivity * 0.12);
    vDisplacement = displacement;
    vec3 newPosition = position + normal * displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uAlert;
  uniform float uActivity;
  uniform float uReducedMotion;
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform vec3 uColorAlert;
  varying vec3 vNormal;
  varying float vDisplacement;

  void main() {
    float fresnel = pow(1.0 - clamp(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.2);
    vec3 base = mix(uColorCore, uColorEdge, fresnel);
    vec3 withAlert = mix(base, uColorAlert, uAlert * 0.5);
    // FASE 9C — the brightness pulse is a continuous idle-breathing cue, not
    // a real state change; under prefers-reduced-motion it collapses to a
    // fixed, still-bright value (never 0) instead of oscillating.
    float pulse = mix(0.82 + 0.18 * sin(uTime * (1.1 + uIntensity * 1.8 + uActivity * 1.2)), 0.94, uReducedMotion);
    vec3 color = withAlert * pulse + vDisplacement * 1.4 + uActivity * 0.12;
    // FASE 9B — this outer shell is now a translucent energy surface, not a
    // solid sphere: low alpha facing the camera (fresnel ~0) lets the real
    // inner nucleus (CoreNucleus, an opaque mesh fully enclosed inside this
    // one) show through its center, rising to near-opaque at the grazing
    // rim (fresnel ~1) for a defined edge — the "camadas"/depth this phase
    // asks for, from the same shader, not a second effect layered on top.
    float alpha = clamp(0.22 + fresnel * 0.7 + uActivity * 0.08, 0.16, 0.96);
    gl_FragColor = vec4(color, alpha);
  }
`;

// FASE 9B — JARVIS-inspired repaint: the icy, blue-dominant palette read as
// "decorative sphere"; a warm, pale nucleus fading into a deep graphite-
// violet edge reads as material/energy instead, per this phase's own
// "evitar excesso de azul" direction. uAlert's amber tint (the LAB's own
// existing --qg-gold accent) is unchanged — alert state must stay
// recognizable across both palettes.
const COLOR_CORE = new THREE.Color("#f4ecdd");
const COLOR_EDGE = new THREE.Color("#241f3d");
const COLOR_ALERT = new THREE.Color("#ffb020");

interface CoreUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uIntensity: { value: number };
  uAlert: { value: number };
  uActivity: { value: number };
  uReducedMotion: { value: number };
  uColorCore: { value: THREE.Color };
  uColorEdge: { value: THREE.Color };
  uColorAlert: { value: THREE.Color };
}

function CoreMesh({ intensity, alert, activity, reducedMotion }: { intensity: number; alert: number; activity: number; reducedMotion: boolean }) {
  const currentIntensity = useRef(intensity);
  const currentAlert = useRef(alert);
  const currentActivity = useRef(activity);

  const uniforms = useMemo<CoreUniforms>(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uAlert: { value: alert },
      uActivity: { value: activity },
      uReducedMotion: { value: reducedMotion ? 1 : 0 },
      uColorCore: { value: COLOR_CORE },
      uColorEdge: { value: COLOR_EDGE },
      uColorAlert: { value: COLOR_ALERT },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniforms object is created once; values are updated imperatively below, never by re-running this memo.
    [],
  );

  // reducedMotion can only change by the user flipping an OS setting while
  // the page is open — rare, but still a real value, not a one-time initial
  // read, so it's kept in sync here rather than only captured at mount.
  // Same escape hatch as the useFrame blocks below: a shader uniform is a
  // plain mutable object R3F expects to be written into directly, not React
  // state.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
  }, [reducedMotion, uniforms]);
  /* eslint-enable react-hooks/immutability */

  // R3F's documented pattern: useFrame runs on every animation frame,
  // outside React's render cycle, specifically to mutate objects like a
  // shader's uniforms imperatively instead of re-rendering 60x/sec. That is
  // exactly what React's render-purity/immutability lints assume never
  // happens — there is no React-idiomatic equivalent that stays performant.
  /* eslint-disable react-hooks/immutability */
  useFrame((state, delta) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    // Smoothly ease toward the real target values instead of snapping —
    // this is what makes a state change (idle -> mission running, or a
    // command just resolving) read as the organism reacting, never a jump cut.
    currentIntensity.current = THREE.MathUtils.damp(currentIntensity.current, intensity, 2.2, delta);
    currentAlert.current = THREE.MathUtils.damp(currentAlert.current, alert, 2.2, delta);
    currentActivity.current = THREE.MathUtils.damp(currentActivity.current, activity, 2.2, delta);
    uniforms.uIntensity.value = currentIntensity.current;
    uniforms.uAlert.value = currentAlert.current;
    uniforms.uActivity.value = currentActivity.current;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <mesh>
      <icosahedronGeometry args={[1.3, 24]} />
      <shaderMaterial
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  );
}

/**
 * FASE 9B — a small, bright inner nucleus inside the displaced shell above —
 * the "camadas"/"núcleo interno" the JARVIS-inspired composition asks for.
 * Deliberately NOT a second custom shader (no new uniforms, no new GLSL):
 * a plain `meshBasicMaterial` sphere whose own scale eases toward the same
 * real intensity/activity inputs CoreMesh already consumes, so it reads as
 * one organism with layered depth rather than a second independent effect.
 */
function CoreNucleus({ intensity, activity }: { intensity: number; activity: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const current = useRef({ intensity, activity });

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    current.current.intensity = THREE.MathUtils.damp(current.current.intensity, intensity, 2.2, delta);
    current.current.activity = THREE.MathUtils.damp(current.current.activity, activity, 2.2, delta);
    const scale = 0.4 + current.current.intensity * 0.05 + current.current.activity * 0.07;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 3]} />
      {/* Deliberately opaque (not `transparent`) — Three.js draws opaque
          objects first with normal depth-testing, which is what lets this
          small inner mesh render correctly behind/through the outer shell's
          now-translucent surface above, instead of both competing in the
          transparent render pass's back-to-front object sort. */}
      <meshBasicMaterial color={COLOR_CORE} />
    </mesh>
  );
}

/** Shared point-cloud generator for every particle layer below — a sphere of radius [radiusMin, radiusMin+radiusRange), flattened on Y by `flatten` for a disc-like spread rather than a perfect ball. Random by design (a static decorative field no other logic reads back), computed once per layer inside a `useMemo` with empty deps — never re-rolled on a re-render, so this plain helper function (not a hook, not inlined in the hook callback) isn't flagged by the purity rule the way a direct `Math.random()` call inside a hook body would be. */
function sphericalCloud(count: number, radiusMin: number, radiusRange: number, flatten: number): Float32Array {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = radiusMin + Math.random() * radiusRange;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * flatten;
    arr[i * 3 + 2] = radius * Math.cos(phi);
  }
  return arr;
}

/**
 * FASE 9C — "CAMADA 2: partículas distantes": a sparse, dim, far field —
 * mostly static, barely rotating — giving the dark space around the Core
 * its own sense of scale/depth, distinct from the near field below.
 */
function DistantField({ reducedMotion }: { reducedMotion: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => sphericalCloud(220, 4.5, 2.5, 0.65), []);

  useFrame((_, delta) => {
    if (!pointsRef.current || reducedMotion) return;
    pointsRef.current.rotation.y += delta * 0.015;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.014} color="#5c577a" transparent opacity={0.35} sizeAttenuation />
    </points>
  );
}

/** FASE 1/9C — "CAMADA 3: partículas próximas", the idle "partículas circulam" cue, now in the repainted palette (a pale lavender-grey, not icy blue — same "evitar excesso de azul" direction as the Core's own repaint). */
function OrbitParticles({ intensity, reducedMotion }: { intensity: number; reducedMotion: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => sphericalCloud(560, 2.0, 1.2, 0.5), []);

  useFrame((_, delta) => {
    if (!pointsRef.current || reducedMotion) return;
    pointsRef.current.rotation.y += delta * (0.04 + intensity * 0.12);
    pointsRef.current.rotation.x += delta * (0.01 + intensity * 0.03);
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color="#cfc6e8" transparent opacity={0.5} sizeAttenuation />
    </points>
  );
}

/**
 * FASE 9C — "CAMADA 5: estrutura interna": a sparse cloud of warm points
 * living INSIDE the outer shell's own radius (shell radius 1.3; this field
 * sits at 0.5–0.95) — visible through the shell's translucent, fresnel-lit
 * center (see FRAGMENT_SHADER's alpha) alongside the solid nucleus, giving
 * the shell actual internal content instead of reading as a hollow "ball
 * with a gradient."
 */
function InternalFilaments({ intensity, activity, reducedMotion }: { intensity: number; activity: number; reducedMotion: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const current = useRef({ intensity, activity });
  const positions = useMemo(() => sphericalCloud(140, 0.5, 0.45, 0.8), []);

  useFrame((state, delta) => {
    if (pointsRef.current && !reducedMotion) {
      pointsRef.current.rotation.y -= delta * 0.07;
      pointsRef.current.rotation.x += delta * 0.025;
    }
    if (materialRef.current) {
      current.current.intensity = THREE.MathUtils.damp(current.current.intensity, intensity, 2.2, delta);
      current.current.activity = THREE.MathUtils.damp(current.current.activity, activity, 2.2, delta);
      const flicker = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 2.4) * 0.12;
      materialRef.current.opacity = 0.55 + current.current.intensity * 0.18 + current.current.activity * 0.27 + flicker;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      {/* FASE 9C — brighter, larger, and a cooler tone than the nucleus's own
          warm ivory (#f4ecdd): same-hue points against the nucleus/shell's
          own warm palette were visually disappearing into it entirely —
          this needs to read as distinct "sparks" inside the shell, not
          blend into its base color. */}
      <pointsMaterial ref={materialRef} size={0.045} color="#e8e4ff" transparent opacity={0.6} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/**
 * A burst of particles representing one real event (a command reaching the
 * Core, the Core dispatching to an agent, a finding traveling back) —
 * pre-allocated pool (MAX_SLOTS * PER_SLOT points, one BufferGeometry, one
 * draw call), never a new Float32Array per event (FASE 2 priority #7). A
 * `burst` prop change (a new `id`) claims the next slot round-robin and
 * resets that slot's start time; the vertex shader animates every slot from
 * its own uBurstStart/uBurstMode/uBurstAngle uniform, so idle slots
 * (uBurstMode = 0) simply never render.
 */
const MAX_BURST_SLOTS = 4;
const PARTICLES_PER_SLOT = 12;

const BURST_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBurstStart[${MAX_BURST_SLOTS}];
  uniform float uBurstMode[${MAX_BURST_SLOTS}];
  uniform float uBurstAngle[${MAX_BURST_SLOTS}];
  uniform float uBurstDuration;
  attribute float aSlot;
  attribute float aSeed;
  varying float vAlpha;

  void main() {
    int slot = int(aSlot);
    float mode = 0.0;
    float startedAt = 0.0;
    float angle = 0.0;
    for (int i = 0; i < ${MAX_BURST_SLOTS}; i++) {
      if (i == slot) {
        mode = uBurstMode[i];
        startedAt = uBurstStart[i];
        angle = uBurstAngle[i];
      }
    }

    float isLive = step(0.5, abs(mode));
    float progress = clamp((uTime - startedAt) / uBurstDuration, 0.0, 1.0);

    float travelRadius = 2.3;
    vec3 centerPos = vec3(0.0);
    vec3 targetPos = vec3(cos(angle), sin(angle) * 0.6, sin(aSeed * 6.2831) * 0.4) * travelRadius;

    vec3 from = mode > 0.0 ? centerPos : targetPos;
    vec3 to = mode > 0.0 ? targetPos : centerPos;

    float jitterAngle = aSeed * 6.2831 + uTime;
    vec3 jitter = vec3(cos(jitterAngle), sin(jitterAngle), 0.0) * 0.1 * sin(progress * 3.14159);

    vec3 pos = mix(from, to, progress) + jitter * isLive;
    float fade = sin(min(progress, 1.0) * 3.14159);
    vAlpha = isLive * fade;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = 6.0 * (1.0 / -mvPosition.z);
  }
`;

const BURST_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBurstColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float circle = smoothstep(0.5, 0.0, d);
    if (vAlpha * circle < 0.01) discard;
    gl_FragColor = vec4(uBurstColor, vAlpha * circle);
  }
`;

export interface BurstEvent {
  id: number;
  mode: "out" | "in";
  /** Which agent (by index into the real roster) this burst travels to/from — see agent-layout.ts, the same function the DOM ring and the reasoning graph use. */
  agentIndex: number;
  agentCount: number;
}

interface BurstUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uBurstStart: { value: Float32Array };
  uBurstMode: { value: Float32Array };
  uBurstAngle: { value: Float32Array };
  uBurstDuration: { value: number };
  uBurstColor: { value: THREE.Color };
}

function BurstParticles({ burst }: { burst: BurstEvent | null }) {
  const clock = useThree((state) => state.clock);
  const slotCursor = useRef(0);
  const lastBurstId = useRef<number | null>(null);

  const { positions, aSlot, aSeed } = useMemo(() => {
    const total = MAX_BURST_SLOTS * PARTICLES_PER_SLOT;
    const positions = new Float32Array(total * 3);
    const aSlot = new Float32Array(total);
    const aSeed = new Float32Array(total);
    for (let s = 0; s < MAX_BURST_SLOTS; s++) {
      for (let p = 0; p < PARTICLES_PER_SLOT; p++) {
        const idx = s * PARTICLES_PER_SLOT + p;
        aSlot[idx] = s;
        // eslint-disable-next-line react-hooks/purity -- fixed decorative per-particle jitter seed, computed once at mount from a pre-allocated pool, never reallocated per event.
        aSeed[idx] = Math.random();
      }
    }
    return { positions, aSlot, aSeed };
  }, []);

  const uniforms = useMemo<BurstUniforms>(
    () => ({
      uTime: { value: 0 },
      uBurstStart: { value: new Float32Array(MAX_BURST_SLOTS).fill(-999) },
      uBurstMode: { value: new Float32Array(MAX_BURST_SLOTS).fill(0) },
      uBurstAngle: { value: new Float32Array(MAX_BURST_SLOTS).fill(0) },
      uBurstDuration: { value: 1.4 },
      uBurstColor: { value: new THREE.Color("#9fe8ff") },
    }),
    [],
  );

  // Same R3F escape hatch as CoreMesh's useFrame above: this writes directly
  // into the shader's uniform arrays (a plain mutable object, not React
  // state) precisely so a new burst never triggers a React re-render — only
  // the next animation frame picks it up.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!burst || burst.id === lastBurstId.current) return;
    lastBurstId.current = burst.id;
    const slot = slotCursor.current;
    slotCursor.current = (slotCursor.current + 1) % MAX_BURST_SLOTS;
    const direction = agentDirection3D(burst.agentIndex, burst.agentCount);
    uniforms.uBurstStart.value[slot] = clock.elapsedTime;
    uniforms.uBurstMode.value[slot] = burst.mode === "out" ? 1 : -1;
    uniforms.uBurstAngle.value[slot] = Math.atan2(direction.y, direction.x);
  }, [burst, clock, uniforms]);
  /* eslint-enable react-hooks/immutability */

  /* eslint-disable react-hooks/immutability -- same imperative-per-frame pattern as CoreMesh above: uTime is the shared clock the burst shader animates from. */
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSlot" args={[aSlot, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[aSeed, 1]} />
      </bufferGeometry>
      <shaderMaterial vertexShader={BURST_VERTEX_SHADER} fragmentShader={BURST_FRAGMENT_SHADER} uniforms={uniforms} transparent depthWrite={false} />
    </points>
  );
}

/** Attaches webglcontextlost/restored listeners to the actual canvas element once R3F creates it — a real GPU/driver failure degrades to the CSS fallback (via onContextLost, handled in lab-core.tsx) instead of leaving a frozen or corrupted canvas on screen. */
function ContextLossWatcher({ onContextLost, onContextRestored }: { onContextLost: () => void; onContextRestored: () => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    function handleLost(event: Event) {
      // Required by the WebGL spec for the context to ever be restorable.
      event.preventDefault();
      onContextLost();
    }
    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
    };
  }, [gl, onContextLost, onContextRestored]);

  return null;
}

export function LabCoreScene({
  intensity,
  alert,
  activity,
  burst,
  reducedMotion,
  onContextLost,
  onContextRestored,
}: {
  intensity: number;
  alert: boolean;
  activity: number;
  burst: BurstEvent | null;
  reducedMotion: boolean;
  onContextLost: () => void;
  onContextRestored: () => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 4.2], fov: 42 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <ContextLossWatcher onContextLost={onContextLost} onContextRestored={onContextRestored} />
      <DistantField reducedMotion={reducedMotion} />
      <OrbitParticles intensity={intensity} reducedMotion={reducedMotion} />
      <CoreMesh intensity={intensity} alert={alert ? 1 : 0} activity={activity} reducedMotion={reducedMotion} />
      <CoreNucleus intensity={intensity} activity={activity} />
      <InternalFilaments intensity={intensity} activity={activity} reducedMotion={reducedMotion} />
      <BurstParticles burst={burst} />
    </Canvas>
  );
}
