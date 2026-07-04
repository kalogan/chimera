/**
 * env — a shared, procedural "world dressing" rig so every scene (overworld,
 * battle stage, party lineup, breeding reveal) reads as one cohesive place:
 * a soft vertical-gradient sky, gentle depth fog, a warm key + cool fill
 * two-light setup, and cheap "fake AO" contact-shadow blobs under creatures.
 * Everything here is procedural (canvas-drawn textures, no asset files) so it
 * stays zero-dependency and safe to tint per-scene via a `palette`.
 *
 * Usage:
 *   <GooberEnv palette={ZONE_PALETTE} />          // sky + fog + lights
 *   <ContactBlob position={[x, 0, z]} radius={0.6} />   // per-creature ground blob
 */
import { useMemo } from "react";
import * as THREE from "three";

export interface EnvPalette {
  /** Sky colour near the horizon (bottom of the gradient). */
  skyHorizon: string;
  /** Sky colour at the zenith (top of the gradient). */
  skyZenith: string;
  /** Fog colour — should sit near `skyHorizon` so distant geometry melts into the sky. */
  fogColor: string;
  /** Fog start/end distance (linear fog), in world units. */
  fogNear: number;
  fogFar: number;
  /** Warm key light (the "sun") colour + intensity. */
  keyColor: string;
  keyIntensity: number;
  /** Cool fill / sky light (hemisphere) sky + ground colours + intensity. */
  fillSky: string;
  fillGround: string;
  fillIntensity: number;
}

/** Verdant overworld — warm sunny key, soft green-blue fill, gentle haze. */
export const ZONE_PALETTE: EnvPalette = {
  skyHorizon: "#dff3f6",
  skyZenith: "#5fb3d9",
  fogColor: "#cdeaf0",
  fogNear: 22,
  fogFar: 58,
  keyColor: "#ffe8b8",
  keyIntensity: 1.35,
  fillSky: "#eaf6ff",
  fillGround: "#7fae66",
  fillIntensity: 1.05,
};

/** Battle/stage — slightly cooler + a touch more dramatic, still tender not grim. */
export const STAGE_PALETTE: EnvPalette = {
  skyHorizon: "#eaf1f8",
  skyZenith: "#7fa8d9",
  fogColor: "#dbe8f2",
  fogNear: 26,
  fogFar: 70,
  keyColor: "#ffedc4",
  keyIntensity: 1.45,
  fillSky: "#eaf6ff",
  fillGround: "#8fbf7a",
  fillIntensity: 1.0,
};

/** Emberdeep — the ember caverns. Warm/dark: a dim ember-glow horizon, a hot
 *  low key light, close smoky fog so the cavern reads as enclosed, not open sky. */
export const EMBERDEEP_PALETTE: EnvPalette = {
  skyHorizon: "#4a2418",
  skyZenith: "#1c1016",
  fogColor: "#3a1e16",
  fogNear: 14,
  fogFar: 42,
  keyColor: "#ff8a3d",
  keyIntensity: 1.6,
  fillSky: "#6b3420",
  fillGround: "#2b1a14",
  fillIntensity: 0.85,
};

/** Tidewrack — the tide pools. Cool/teal: a pale sea-glass horizon, a cool
 *  blue-green key, and a longer soft fog so it reads as misty coastline. */
export const TIDEWRACK_PALETTE: EnvPalette = {
  skyHorizon: "#bfe9e6",
  skyZenith: "#2f7c94",
  fogColor: "#a9dcd9",
  fogNear: 20,
  fogFar: 60,
  keyColor: "#bfeee0",
  keyIntensity: 1.15,
  fillSky: "#d8f5f0",
  fillGround: "#3c8a83",
  fillIntensity: 1.1,
};

/** Skyreach — airy sky-cliffs. Bright/open: a pale wind-swept horizon, a
 *  crisp high-altitude key light, and the longest fog draw of any world so
 *  distant cloud-cliffs melt into open air rather than reading as enclosed. */
export const SKYREACH_PALETTE: EnvPalette = {
  skyHorizon: "#eaf6ff",
  skyZenith: "#4a9fd9",
  fogColor: "#dff2fb",
  fogNear: 28,
  fogFar: 72,
  keyColor: "#fff6d9",
  keyIntensity: 1.5,
  fillSky: "#f4fbff",
  fillGround: "#bcd8ea",
  fillIntensity: 1.15,
};

/** Ooze Hollow — a soft, shifting hollow. Damp/muted: a mossy violet-green
 *  horizon, a gentle low key, closer fog so the hollow reads as tucked-away
 *  and cozy rather than grand. */
export const OOZEHOLLOW_PALETTE: EnvPalette = {
  skyHorizon: "#cbd9a8",
  skyZenith: "#6f8a5c",
  fogColor: "#c3d6ab",
  fogNear: 16,
  fogFar: 46,
  keyColor: "#dce8a0",
  keyIntensity: 1.1,
  fillSky: "#e6f0c9",
  fillGround: "#7a9a5f",
  fillIntensity: 0.95,
};

/** Verdant Hush — a green, growing home. Deep/lush: a rich canopy-green
 *  horizon, a soft dappled key (as if filtered through leaves), and a hushed
 *  mid-distance fog. */
export const VERDANTHUSH_PALETTE: EnvPalette = {
  skyHorizon: "#cdeec0",
  skyZenith: "#3f7d4a",
  fogColor: "#bfe3ae",
  fogNear: 20,
  fogFar: 56,
  keyColor: "#eaffb8",
  keyIntensity: 1.2,
  fillSky: "#e2f7d0",
  fillGround: "#4f8a4a",
  fillIntensity: 1.05,
};

/** Stonewake — a patient, mountainous home. Warm/dusty: an amber-stone
 *  horizon, a steady warm key, and a heavier close fog for old-mountain haze. */
export const STONEWAKE_PALETTE: EnvPalette = {
  skyHorizon: "#e8d3a8",
  skyZenith: "#8a6a4a",
  fogColor: "#d9c19a",
  fogNear: 18,
  fogFar: 50,
  keyColor: "#ffd9a0",
  keyIntensity: 1.3,
  fillSky: "#f0e0bf",
  fillGround: "#6b5a44",
  fillIntensity: 0.95,
};

/** The Hollow Vale — a dim, twilight home. Dusk/violet: a deep violet-dusk
 *  horizon, a cool pale key (moonlight, not sun), and the closest fog of any
 *  world so it reads as the most enclosed, hushed, otherworldly place. */
export const HOLLOWVALE_PALETTE: EnvPalette = {
  skyHorizon: "#4a3a5e",
  skyZenith: "#1c1428",
  fogColor: "#3a2e4a",
  fogNear: 12,
  fogFar: 38,
  keyColor: "#cfc0ef",
  keyIntensity: 1.05,
  fillSky: "#5a4a70",
  fillGround: "#2a2038",
  fillIntensity: 0.8,
};

/**
 * Build a vertical-gradient canvas texture (a couple dozen KB, generated once
 * and memoized) used both as the sky-sphere map. Cheap alternative to an HDRI.
 */
function useGradientTexture(top: string, bottom: string) {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [top, bottom]);
}

/**
 * The shared world dressing: a big backside-rendered sky sphere (gradient sky,
 * cheaper + more controllable than a `<color>` background when we want a
 * horizon gradient), linear depth fog, and a warm-key + cool-fill light rig.
 * Mount once per `<Canvas>`, near the top, before geometry.
 */
export function GooberEnv({ palette = ZONE_PALETTE }: { palette?: EnvPalette }) {
  const skyMap = useGradientTexture(palette.skyZenith, palette.skyHorizon);
  return (
    <>
      <fog attach="fog" args={[palette.fogColor, palette.fogNear, palette.fogFar]} />
      <mesh scale={[1, 1, 1]} renderOrder={-1000}>
        <sphereGeometry args={[200, 24, 16]} />
        <meshBasicMaterial
          map={skyMap}
          side={THREE.BackSide}
          fog={false}
          depthWrite={false}
        />
      </mesh>
      <hemisphereLight
        args={[palette.fillSky, palette.fillGround, palette.fillIntensity]}
      />
      <directionalLight
        position={[6, 14, 6]}
        intensity={palette.keyIntensity}
        color={palette.keyColor}
      />
    </>
  );
}

/**
 * A cheap "fake AO" contact-shadow blob: a radial-gradient dark disc laid flat
 * just above the ground under a creature, to ground it without real shadow
 * mapping. `opacity` is the darkest point of the gradient (edges fade to 0).
 */
const BLOB_OPACITY = 0.38;

function useBlobTexture() {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0, `rgba(20,20,25,${BLOB_OPACITY})`);
    grad.addColorStop(0.7, `rgba(20,20,25,${BLOB_OPACITY * 0.5})`);
    grad.addColorStop(1, "rgba(20,20,25,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

export function ContactBlob({
  position,
  radius = 0.75,
}: {
  position: [number, number, number];
  radius?: number;
}) {
  const tex = useBlobTexture();
  return (
    <mesh
      position={[position[0], position[1] + 0.02, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
    >
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
