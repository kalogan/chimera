/**
 * battle-vfx — cheap, short-lived R3F effects for CHIMERA's turn-based combat:
 * a basic-attack slash, a per-element skill burst, a struck-target hit
 * reaction (flash + shake + knockback), and an attacker lunge.
 *
 * Everything here is t:0→1 over a fixed lifetime driven by `useFrame`, then
 * the component unmounts itself (calls `onDone`). No particle systems, no
 * custom shaders, no heavy geometry — shared/cheap materials, a handful of
 * meshes/lines per effect, mobile-safe. `getReducedMotion()` shortens +
 * simplifies (never fully removes) the feedback so accessibility never loses
 * the "something happened" signal.
 *
 * Positioned by the caller (BattleScreen, via GooberStage) at the TARGET's
 * world position for SlashVFX/ElementBurstVFX, and driven by a per-placed
 * group ref for HitReaction/AttackerLunge (App.tsx owns the sequencing —
 * this file only owns the visual math).
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Element } from "game-kit/creature";
import { getReducedMotion } from "./quality.js";

// ── shared geometry/material caches (constructed once, reused across hits) ──
let _quadGeom: THREE.PlaneGeometry | null = null;
function quadGeom(): THREE.PlaneGeometry {
  if (!_quadGeom) _quadGeom = new THREE.PlaneGeometry(1, 1);
  return _quadGeom;
}
let _coneGeom: THREE.ConeGeometry | null = null;
function coneGeom(): THREE.ConeGeometry {
  if (!_coneGeom) _coneGeom = new THREE.ConeGeometry(0.22, 1, 6);
  return _coneGeom;
}
let _sphereGeom: THREE.SphereGeometry | null = null;
function sphereGeom(): THREE.SphereGeometry {
  if (!_sphereGeom) _sphereGeom = new THREE.SphereGeometry(0.5, 8, 8);
  return _sphereGeom;
}
let _ringGeom: THREE.RingGeometry | null = null;
function ringGeom(): THREE.RingGeometry {
  if (!_ringGeom) _ringGeom = new THREE.RingGeometry(0.6, 1, 24);
  return _ringGeom;
}

/** Ease-out cubic — snappy start, soft landing; used to fade/scale VFX. */
function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/** Drives `t: 0→1` over `durationMs`, calling `onDone` once it completes.
 *  Reduced-motion shortens the duration (snappier, less motion) rather than
 *  skipping the effect outright — the hit must still read as landing. */
function useLifetime(durationMs: number, onDone: () => void): { t: () => number } {
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const dur = (getReducedMotion() ? durationMs * 0.6 : durationMs) / 1000;
  const tRef = useRef(0);
  useFrame((state) => {
    if (done.current) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const raw = (state.clock.elapsedTime - start.current) / dur;
    tRef.current = Math.min(1, raw);
    if (raw >= 1) {
      done.current = true;
      onDone();
    }
  });
  return { t: () => tRef.current };
}

// ── SlashVFX — a quick diagonal arc for basic attacks ───────────────────────

/** A diagonal slash arc: a thin curved plane that sweeps across the target
 *  then fades. Basic-attack feedback — cheap (one mesh), colour-neutral
 *  (reads as "steel"), snappy (default ~260ms). */
export function SlashVFX({
  position,
  scale = 1,
  durationMs = 260,
  onDone,
}: {
  position: [number, number, number];
  scale?: number;
  durationMs?: number;
  onDone: () => void;
}) {
  const { t } = useLifetime(durationMs, onDone);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#f4f4f0",
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const geom = useMemo(() => {
    // A thin crescent built from a ring wedge — reads as a slash stroke.
    const g = new THREE.RingGeometry(0.7, 0.92, 20, 1, -0.5, 1.9);
    return g;
  }, []);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const v = t();
    const eased = easeOutCubic(Math.min(1, v * 1.4));
    if (mesh.current) {
      mesh.current.scale.setScalar(scale * (0.6 + eased * 1.1));
      mesh.current.rotation.z = -0.7 + v * 1.3;
      mat.opacity = v < 0.15 ? v / 0.15 : Math.max(0, 1 - (v - 0.15) / 0.85);
    }
  });
  return (
    <mesh ref={mesh} position={position} geometry={geom} material={mat} rotation={[0, 0, -0.7]} />
  );
}

// ── ElementBurstVFX — per-element skill impact ──────────────────────────────

const ELEMENT_TINT: Record<Element, string> = {
  fire: "#e0632f",
  water: "#4a9adf",
  earth: "#a3803f",
  wind: "#66c9a0",
  light: "#f2dd6a",
  dark: "#7a68a8",
};

/** A billboarded flame lick — a couple of stretched cones flickering upward,
 *  shared cone geometry, tinted material per instance. */
function FireBurst({ t, color }: { t: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    [color],
  );
  const eased = easeOutCubic(t);
  const fade = Math.max(0, 1 - t);
  mat.opacity = fade;
  const offsets: [number, number, number][] = [
    [0, 0, 0],
    [0.35, 0.1, 0.1],
    [-0.3, 0.05, -0.15],
  ];
  return (
    <group>
      {offsets.map((o, i) => (
        <mesh
          key={i}
          position={[o[0], 0.3 + eased * 1.1 + o[1], o[2]]}
          scale={[0.55 - i * 0.08, 0.9 + eased * 0.6, 0.55 - i * 0.08]}
          geometry={coneGeom()}
          material={mat}
        />
      ))}
    </group>
  );
}

/** A splash of small droplet spheres arcing outward + falling. */
function WaterBurst({ t, color }: { t: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }),
    [color],
  );
  const fade = Math.max(0, 1 - t);
  mat.opacity = fade * 0.9;
  const n = 7;
  const drops = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2;
        return { ang, r: 0.4 + (i % 3) * 0.15 };
      }),
    [],
  );
  return (
    <group>
      {drops.map((d, i) => {
        const dist = d.r + t * 1.3;
        const y = 0.4 + Math.sin(t * Math.PI) * 0.9 - t * 0.3;
        return (
          <mesh
            key={i}
            position={[Math.cos(d.ang) * dist, y, Math.sin(d.ang) * dist]}
            scale={0.14}
            geometry={sphereGeom()}
            material={mat}
          />
        );
      })}
    </group>
  );
}

/** A jagged bolt (a couple of thin zig-zag boxes) + a bright flash — stands in
 *  for wind/lightning: an electric, fast-read effect. */
function WindBoltBurst({ t, color }: { t: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    [color],
  );
  const flashMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  );
  const fade = Math.max(0, 1 - t / 0.7);
  mat.opacity = Math.max(0, fade);
  flashMat.opacity = Math.max(0, 1 - t * 6);
  return (
    <group rotation={[0, 0, 0]}>
      <mesh position={[0, 0.9, 0]} scale={[0.9, 0.9, 0.9]} geometry={quadGeom()} material={flashMat} />
      <mesh position={[0.15, 1.4, 0]} rotation={[0, 0, 0.35]} scale={[0.16, 0.9, 1]} geometry={quadGeom()} material={mat} />
      <mesh position={[-0.1, 0.65, 0]} rotation={[0, 0, -0.4]} scale={[0.14, 0.8, 1]} geometry={quadGeom()} material={mat} />
      <mesh position={[0.05, 0.05, 0]} rotation={[0, 0, 0.2]} scale={[0.12, 0.6, 1]} geometry={quadGeom()} material={mat} />
    </group>
  );
}

/** Shards erupting upward from the ground — a handful of cone "spikes". */
function EarthBurst({ t, color }: { t: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }),
    [color],
  );
  const fade = Math.max(0, 1 - t);
  mat.opacity = fade;
  const rise = easeOutCubic(Math.min(1, t * 2));
  const shards: [number, number, number][] = [
    [0, 0, 0],
    [0.3, 0, 0.15],
    [-0.32, 0, -0.1],
    [0.1, 0, -0.3],
  ];
  return (
    <group>
      {shards.map((s, i) => (
        <mesh
          key={i}
          position={[s[0], -0.3 + rise * (0.75 + (i % 2) * 0.2), s[2]]}
          rotation={[0, 0, ((i % 2) * 2 - 1) * 0.12]}
          scale={[0.4, 0.85, 0.4]}
          geometry={coneGeom()}
          material={mat}
        />
      ))}
    </group>
  );
}

/** A radiant expanding ring + flash — light. */
function LightBurst({ t, color }: { t: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    [color],
  );
  const flashMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#fffbe8", transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
    [],
  );
  const eased = easeOutCubic(t);
  mat.opacity = Math.max(0, 1 - t);
  flashMat.opacity = Math.max(0, 1 - t * 4);
  return (
    <group>
      <mesh scale={0.9 + eased * 0.3} material={flashMat} geometry={quadGeom()} />
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={0.4 + eased * 2.2} geometry={ringGeom()} material={mat} />
    </group>
  );
}

/** Shadow tendrils curling inward (an implosion read) — dark. */
function DarkBurst({ t, color }: { t: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }),
    [color],
  );
  const fade = Math.max(0, 1 - t);
  mat.opacity = fade * 0.85;
  const n = 5;
  const tendrils = useMemo(() => Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2), []);
  const pull = 1 - easeOutCubic(t); // start wide, pull inward
  return (
    <group>
      {tendrils.map((ang, i) => {
        const dist = 0.25 + pull * 1.0;
        return (
          <mesh
            key={i}
            position={[Math.cos(ang) * dist, 0.35 + (i % 2) * 0.2, Math.sin(ang) * dist]}
            rotation={[0, 0, ang]}
            scale={[0.18, 0.6, 0.18]}
            geometry={coneGeom()}
            material={mat}
          />
        );
      })}
    </group>
  );
}

/** Switches on `Element` to a distinct, cheap burst effect, all sharing the
 *  same t:0→1 lifetime. Reuses `ELEMENT_COLOR`-adjacent tints (kept local so
 *  this file doesn't reach into the READ-ONLY creature-dex module). */
export function ElementBurstVFX({
  element,
  position,
  durationMs = 520,
  onDone,
}: {
  element: Element;
  position: [number, number, number];
  durationMs?: number;
  onDone: () => void;
}) {
  const { t } = useLifetime(durationMs, onDone);
  const color = ELEMENT_TINT[element];
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    ref.current?.updateMatrixWorld();
  });
  const v = t();
  return (
    <group ref={ref} position={position}>
      {element === "fire" && <FireBurst t={v} color={color} />}
      {element === "water" && <WaterBurst t={v} color={color} />}
      {element === "wind" && <WindBoltBurst t={v} color={color} />}
      {element === "earth" && <EarthBurst t={v} color={color} />}
      {element === "light" && <LightBurst t={v} color={color} />}
      {element === "dark" && <DarkBurst t={v} color={color} />}
    </group>
  );
}

// ── HitReaction — struck-target flash + shake + knockback ───────────────────

/** Drives a struck combatant's placed-group: a quick additive white flash
 *  sprite over it, a small position-jitter shake, and a tiny knockback away
 *  from the attacker. Call `useHitReactionOffset` from the parent group and
 *  apply the returned offset/flash to its own transform — this hook owns the
 *  math only (no mesh of its own beyond the flash sprite, which the caller
 *  mounts as a child at the struck creature's position). */
export function useHitReactionOffset(
  active: boolean,
  fromDir: THREE.Vector3,
  onDone: () => void,
): { offset: THREE.Vector3; flash: number } {
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const result = useRef({ offset: new THREE.Vector3(), flash: 0 });
  const durMs = getReducedMotion() ? 180 : 300;
  useFrame((state) => {
    if (!active || done.current) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const raw = (state.clock.elapsedTime - start.current) / (durMs / 1000);
    const t = Math.min(1, raw);
    // Knockback: quick push away, spring back by t=1.
    const push = Math.sin(Math.min(1, t * 1.3) * Math.PI) * (getReducedMotion() ? 0.08 : 0.22);
    // Shake: decaying jitter, skipped under reduced motion (push+flash carry it).
    const shakeMag = getReducedMotion() ? 0 : (1 - t) * 0.08;
    const jitterX = shakeMag * Math.sin(state.clock.elapsedTime * 47);
    const jitterY = shakeMag * Math.cos(state.clock.elapsedTime * 61);
    result.current.offset.set(fromDir.x * push + jitterX, jitterY, fromDir.z * push);
    result.current.flash = Math.max(0, 1 - t * 2.2);
    if (raw >= 1) {
      done.current = true;
      result.current.offset.set(0, 0, 0);
      result.current.flash = 0;
      onDone();
    }
  });
  return result.current;
}

/** The additive white flash sprite mounted over a struck creature — a simple
 *  billboard-ish quad facing the camera via `renderOrder`/no depth test isn't
 *  needed since it's tiny and additive; a plain facing-forward quad reads
 *  fine at battle-stage angles. */
export function HitFlashSprite({ opacity, scale }: { opacity: number; scale: number }) {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  mat.opacity = opacity;
  if (opacity <= 0.001) return null;
  return <mesh geometry={quadGeom()} material={mat} scale={scale} position={[0, 0, 0.05]} />;
}

// ── Attacker lunge ───────────────────────────────────────────────────────────

/** Nudges the attacker toward the target then back — a quick lunge read.
 *  Returns a per-frame offset the caller adds to the attacker's placed
 *  position; unlike HitReaction this is a pure forward-back tween (no
 *  jitter), since the attacker is the one dealing the hit, not receiving it. */
export function useLungeOffset(active: boolean, toDir: THREE.Vector3, onDone: () => void): THREE.Vector3 {
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const offset = useRef(new THREE.Vector3());
  const durMs = getReducedMotion() ? 220 : 360;
  useFrame((state) => {
    if (!active || done.current) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const raw = (state.clock.elapsedTime - start.current) / (durMs / 1000);
    const t = Math.min(1, raw);
    // out-and-back: sin curve peaks mid-lunge.
    const reach = getReducedMotion() ? 0.5 : 1;
    const k = Math.sin(t * Math.PI) * reach;
    offset.current.set(toDir.x * k, 0, toDir.z * k);
    if (raw >= 1) {
      done.current = true;
      offset.current.set(0, 0, 0);
      onDone();
    }
  });
  return offset.current;
}
