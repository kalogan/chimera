import { useMemo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { GooberSpec } from "game-kit/creature";
import { Goober } from "./Goober.js";
import { ContactBlob, GooberEnv, STAGE_PALETTE, type EnvPalette } from "./env.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality } from "./quality.js";
import { useHitReactionOffset, useLungeOffset, HitFlashSprite } from "./battle-vfx.js";

export interface Placed {
  id: string;
  spec: GooberSpec;
  position: [number, number, number];
  facing?: number;
  fainted?: boolean;
  seed?: number;
  /** Battle VFX only (optional, defaults off — other GooberStage callers never
   *  set this): when set, this placed group animates a struck-hit reaction
   *  (flash + shake + knockback) away from `awayFrom` while `active` is true. */
  reaction?: { active: boolean; awayFrom: [number, number, number]; onDone: () => void };
  /** Battle VFX only (optional): when set, this placed group lunges toward
   *  `toward` and back while `active` is true (the attacker's swing). */
  lunge?: { active: boolean; toward: [number, number, number]; onDone: () => void };
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

/** One placed goober's group, with the optional battle-only reaction/lunge
 *  hooks wired up. Split out from the main map so the per-frame hooks
 *  (useHitReactionOffset/useLungeOffset) only ever run for stages that pass
 *  them — a plain `Placed` with no `reaction`/`lunge` costs nothing extra
 *  beyond the two no-op-until-active hooks. */
function PlacedGoober({ p }: { p: Placed }) {
  const zero = useMemo(() => new THREE.Vector3(), []);
  const awayDir = useMemo(() => {
    if (!p.reaction) return zero;
    const [ax, , az] = p.reaction.awayFrom;
    const d = new THREE.Vector3(p.position[0] - ax, 0, p.position[2] - az);
    return d.lengthSq() > 0.0001 ? d.normalize() : new THREE.Vector3(0, 0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.reaction?.awayFrom[0], p.reaction?.awayFrom[1], p.reaction?.awayFrom[2], p.position[0], p.position[2]]);
  const towardDir = useMemo(() => {
    if (!p.lunge) return zero;
    const [tx, , tz] = p.lunge.toward;
    const d = new THREE.Vector3(tx - p.position[0], 0, tz - p.position[2]);
    return d.lengthSq() > 0.0001 ? d.normalize() : new THREE.Vector3(0, 0, -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.lunge?.toward[0], p.lunge?.toward[1], p.lunge?.toward[2], p.position[0], p.position[2]]);

  const reactionResult = useHitReactionOffset(
    p.reaction?.active ?? false,
    awayDir,
    p.reaction?.onDone ?? noop,
  );
  const lungeOffset = useLungeOffset(p.lunge?.active ?? false, towardDir, p.lunge?.onDone ?? noop);

  const offset = reactionResult.offset;
  const finalPos: [number, number, number] = [
    p.position[0] + offset.x + lungeOffset.x,
    p.position[1] + offset.y,
    p.position[2] + offset.z + lungeOffset.z,
  ];

  return (
    <group>
      <ContactBlob position={[p.position[0], 0, p.position[2]]} radius={p.spec.scale * 0.9} />
      <Goober
        spec={p.spec}
        position={finalPos}
        facing={p.facing ?? 0}
        fainted={p.fainted}
        seed={p.seed ?? 0}
      />
      {reactionResult.flash > 0 && (
        <group position={[finalPos[0], finalPos[1] + p.spec.scale * 0.6, finalPos[2] + 0.3]}>
          <HitFlashSprite opacity={reactionResult.flash * 0.85} scale={p.spec.scale * 2.6} />
        </group>
      )}
    </group>
  );
}

function noop(): void {}

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
  vfx,
}: {
  placed: Placed[];
  cameraPos?: [number, number, number];
  fov?: number;
  bg?: string;
  ground?: string;
  /** Sky/fog/light tint — defaults to the stage palette; pass ZONE_PALETTE or a
   * custom EnvPalette to recolour battle vs. party vs. reveal moments. */
  palette?: EnvPalette;
  /** Battle VFX only (optional, defaults off): extra scene children rendered
   *  INSIDE the Canvas after the placed goobers — e.g. a SlashVFX or
   *  ElementBurstVFX positioned at a target's world coordinates. Every other
   *  GooberStage caller (party/cradle/newborn/shop) simply omits this. */
  vfx?: ReactNode;
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
        <PlacedGoober key={p.id} p={p} />
      ))}
      {vfx}
    </Canvas>
  );
}
