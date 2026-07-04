import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { GooberSpec } from "game-kit/creature";
import { Goober } from "./Goober.js";
import { ContactBlob, GooberEnv, STAGE_PALETTE, type EnvPalette } from "./env.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality } from "./quality.js";

export interface Placed {
  id: string;
  spec: GooberSpec;
  position: [number, number, number];
  facing?: number;
  fainted?: boolean;
  seed?: number;
}

// Ground mottling, matching ZoneScene's treatment: a soft irregular-blotch
// canvas texture over the flat toon tint so the stage floor reads as a meadow
// rather than a flat-shaded plane. Tinted per-call via `ground`.
function makeStageGroundTexture(ground: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, size, size);
  let s = 4242;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 5 + rand() * 16;
    const dark = rand() > 0.5;
    ctx.fillStyle = dark ? "rgba(60,100,55,0.14)" : "rgba(210,235,180,0.14)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  return tex;
}

// A framed, orbit-free 2.5D stage (sidesteps GYRE's camera pain): a fixed camera
// looks at a cozy meadow; goobers stand where placed. Reused for the party lineup,
// the battle field (two facing rows), and the breeding reveal (a single newborn).
export function GooberStage({
  placed,
  cameraPos = [0, 5, 30],
  fov = 30,
  bg = "#9ed0ee",
  ground = "#bfe39a",
  palette = STAGE_PALETTE,
}: {
  placed: Placed[];
  cameraPos?: [number, number, number];
  fov?: number;
  bg?: string;
  ground?: string;
  /** Sky/fog/light tint — defaults to the stage palette; pass ZONE_PALETTE or a
   * custom EnvPalette to recolour battle vs. party vs. reveal moments. */
  palette?: EnvPalette;
}) {
  const groundTex = useMemo(() => makeStageGroundTexture(ground), [ground]);
  return (
    <Canvas className="stage" camera={{ position: cameraPos, fov }} shadows={false} dpr={[1, getQuality().dprCap]}>
      <ResponsiveFov baseFov={fov} />
      <color attach="background" args={[bg]} />
      <GooberEnv palette={palette} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshToonMaterial map={groundTex} />
      </mesh>
      {placed.map((p) => (
        <group key={p.id}>
          <ContactBlob position={[p.position[0], 0, p.position[2]]} radius={p.spec.scale * 0.9} />
          <Goober
            spec={p.spec}
            position={p.position}
            facing={p.facing ?? 0}
            fainted={p.fainted}
            seed={p.seed ?? 0}
          />
        </group>
      ))}
    </Canvas>
  );
}
