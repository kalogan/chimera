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
