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
    float n = valueNoise(position * 1.6 + uTime * 0.12);
    float displacement = (n - 0.5) * (0.12 + uIntensity * 0.22 + uActivity * 0.15);
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
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform vec3 uColorAlert;
  varying vec3 vNormal;
  varying float vDisplacement;

  void main() {
    float fresnel = pow(1.0 - clamp(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.2);
    vec3 base = mix(uColorCore, uColorEdge, fresnel);
    vec3 withAlert = mix(base, uColorAlert, uAlert * 0.5);
    float pulse = 0.82 + 0.18 * sin(uTime * (1.1 + uIntensity * 1.8 + uActivity * 1.2));
    vec3 color = withAlert * pulse + vDisplacement * 1.4 + uActivity * 0.12;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const COLOR_CORE = new THREE.Color("#bff6ff");
const COLOR_EDGE = new THREE.Color("#1a3dd8");
const COLOR_ALERT = new THREE.Color("#ffb020");

interface CoreUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uIntensity: { value: number };
  uAlert: { value: number };
  uActivity: { value: number };
  uColorCore: { value: THREE.Color };
  uColorEdge: { value: THREE.Color };
  uColorAlert: { value: THREE.Color };
}

function CoreMesh({ intensity, alert, activity }: { intensity: number; alert: number; activity: number }) {
  const currentIntensity = useRef(intensity);
  const currentAlert = useRef(alert);
  const currentActivity = useRef(activity);

  const uniforms = useMemo<CoreUniforms>(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uAlert: { value: alert },
      uActivity: { value: activity },
      uColorCore: { value: COLOR_CORE },
      uColorEdge: { value: COLOR_EDGE },
      uColorAlert: { value: COLOR_ALERT },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniforms object is created once; values are updated imperatively in useFrame below, never by re-running this memo.
    [],
  );

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
      />
    </mesh>
  );
}

/** A single-draw-call ring of orbiting points — the "partículas circulam" idle cue, cheap even on weak GPUs (one BufferGeometry, no per-particle physics). */
function OrbitParticles({ intensity }: { intensity: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 420;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // The layout is random by design (a static decorative starfield that
      // no other logic ever reads back), computed once via the empty deps
      // below — not the "impure during render" case this rule guards against.
      // eslint-disable-next-line react-hooks/purity
      const radius = 2.1 + Math.random() * 0.9;
      // eslint-disable-next-line react-hooks/purity
      const theta = Math.random() * Math.PI * 2;
      // eslint-disable-next-line react-hooks/purity
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.5;
      arr[i * 3 + 2] = radius * Math.cos(phi);
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * (0.04 + intensity * 0.12);
    pointsRef.current.rotation.x += delta * (0.01 + intensity * 0.03);
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color="#8fd8ff" transparent opacity={0.55} sizeAttenuation />
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
  onContextLost,
  onContextRestored,
}: {
  intensity: number;
  alert: boolean;
  activity: number;
  burst: BurstEvent | null;
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
      <CoreMesh intensity={intensity} alert={alert ? 1 : 0} activity={activity} />
      <OrbitParticles intensity={intensity} />
      <BurstParticles burst={burst} />
    </Canvas>
  );
}
