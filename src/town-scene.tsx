/**
 * town-scene — the walkable TOWN square, rendered self-contained (its own
 * angled top-down camera + tile terrain + goober-bodied villagers), mirroring
 * `ZoneScene.tsx`'s look (same TILE/CAM constants, the same billboard +
 * hop-tween "Actor" shape) so the town reads as the same world as the
 * overworld rather than a bolted-on screen.
 *
 * DECOUPLED: takes `villagers` + `playerTile` as props and fires `onMove`/
 * `onApproach` callbacks — it owns NO player-position state itself (the
 * Architect's screen/App layer does) and imports nothing from `game.ts`.
 * Movement is grid-step: the Architect wires WASD/d-pad to call `onMove(dir)`,
 * which is expected to update `playerTile` and re-render; this component just
 * tweens toward whatever `playerTile` it's given (same "render authored
 * state, don't own movement" split `ZoneScene.tsx` uses for the overworld).
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Billboard } from "game-kit/billboard/r3f";
import { creatureFromToken, seedToken, type GooberSpec } from "game-kit/creature";
import { Goober } from "./Goober.js";
import { ContactBlob, GooberEnv, ZONE_PALETTE } from "./env.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality } from "./quality.js";
import {
  TOWN_HEIGHT,
  TOWN_TILES,
  TOWN_WIDTH,
  TOWN_VILLAGERS,
  type TownDirection,
  type TownVillager,
} from "./town.js";
import "./town.css";

const TILE = 2.2;
const CAM_UP = 18;
const CAM_BACK = 14;
const CAM_FOV = 40;
const HOP_H = 0.42;
const GOOBER_SIZE = 0.42;
/** A player standing on this tile, or one cardinal step away, can talk to a
 *  villager occupying that tile (adjacency, not exact overlap — a villager's
 *  tile itself counts as "on" too, for a villager standing right at a
 *  doorway the player walks onto). */
const APPROACH_RADIUS = 1;

const TOWN_BG = "#f4e6c9";
const TOWN_GROUND_BASE = "#e3c894";
const TOWN_GROUND_SPOTS: [string, string] = ["rgba(150,110,60,0.14)", "rgba(255,244,214,0.18)"];
const TOWN_WALL = "#a97a4a";
const TOWN_PLAZA_FLOOR = "#e9d2a0";
const TOWN_PLAZA_RING = "#cdb27a";

function worldOf(x: number, y: number, w: number, h: number): [number, number, number] {
  return [(x - (w - 1) / 2) * TILE, 0, (y - (h - 1) / 2) * TILE];
}

// Deterministic ground mottling (same recipe as ZoneScene.tsx's makeGroundTexture,
// re-derived locally so this file stays self-contained and doesn't import ZoneScene).
function makeTownGroundTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = TOWN_GROUND_BASE;
  ctx.fillRect(0, 0, size, size);
  let s = 4242;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 14;
    const dark = rand() > 0.5;
    ctx.fillStyle = dark ? TOWN_GROUND_SPOTS[0] : TOWN_GROUND_SPOTS[1];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A goober that tweens toward its tile with a little hop arc, billboarded
 *  (identical shape to ZoneScene.tsx's `Actor`, reimplemented locally so this
 *  file has zero cross-import of ZoneScene). */
function Actor({
  spec,
  tx,
  ty,
  w,
  h,
  seed,
  posOut,
  tint,
}: {
  spec: GooberSpec;
  tx: number;
  ty: number;
  w: number;
  h: number;
  seed: number;
  posOut?: React.MutableRefObject<THREE.Vector3>;
  /** A soft ground-ring tint marking a villager (vs. the player's plain ContactBlob). */
  tint?: string;
}) {
  const grp = useRef<THREE.Group>(null);
  const cur = useRef<THREE.Vector3>(new THREE.Vector3(...worldOf(tx, ty, w, h)));
  useFrame(() => {
    const [wx, , wz] = worldOf(tx, ty, w, h);
    cur.current.x += (wx - cur.current.x) * 0.25;
    cur.current.z += (wz - cur.current.z) * 0.25;
    const dist = Math.hypot(wx - cur.current.x, wz - cur.current.z);
    const p = 1 - Math.min(dist / TILE, 1);
    const hop = Math.sin(p * Math.PI) * HOP_H;
    if (grp.current) grp.current.position.set(cur.current.x, hop, cur.current.z);
    if (posOut) posOut.current.set(cur.current.x, 0, cur.current.z);
  });
  return (
    <group ref={grp}>
      {tint ? (
        <group position={[0, 0.03, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[GOOBER_SIZE * 1.9, 24]} />
            <meshBasicMaterial color={tint} transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </group>
      ) : (
        <ContactBlob position={[0, 0, 0]} radius={GOOBER_SIZE * 1.6} />
      )}
      <Billboard>
        <Goober spec={spec} position={[0, 0, 0]} seed={seed} sizeScale={GOOBER_SIZE} />
      </Billboard>
    </group>
  );
}

/** Smoothly track the player with the angled top-down camera (identical to
 *  ZoneScene.tsx's FollowCam, reimplemented locally). */
function FollowCam({ target }: { target: React.MutableRefObject<THREE.Vector3> }) {
  const cam = useThree((s) => s.camera);
  const desired = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  useFrame(() => {
    const t = target.current;
    desired.current.set(t.x, CAM_UP, t.z + CAM_BACK);
    cam.position.lerp(desired.current, 0.12);
    look.current.lerp(new THREE.Vector3(t.x, 1.1, t.z), 0.16);
    cam.lookAt(look.current);
  });
  return null;
}

/** Static tile geometry: plaza walls + the paved fountain ring + the ground. */
function TownTerrain() {
  const w = TOWN_WIDTH;
  const h = TOWN_HEIGHT;
  const groundTex = useMemo(() => {
    const tex = makeTownGroundTexture();
    tex.repeat.set((w * TILE) / 6, (h * TILE) / 6);
    return tex;
  }, [w, h]);

  const cells = useMemo(() => {
    const out: React.ReactElement[] = [];
    for (let i = 0; i < TOWN_TILES.length; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      const [wx, , wz] = worldOf(x, y, w, h);
      const kind = TOWN_TILES[i];
      if (kind === "wall") {
        out.push(
          <mesh key={i} position={[wx, 0.8, wz]}>
            <boxGeometry args={[TILE * 0.98, 1.6, TILE * 0.98]} />
            <meshToonMaterial color={TOWN_WALL} />
          </mesh>,
        );
      } else if (kind === "plaza") {
        out.push(
          <mesh key={i} position={[wx, 0.015, wz]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[TILE * 0.55, 16]} />
            <meshToonMaterial color={TOWN_PLAZA_RING} />
          </mesh>,
        );
      }
    }
    return out;
  }, [w, h]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[w * TILE + 6, h * TILE + 6]} />
        <meshToonMaterial map={groundTex} color={TOWN_PLAZA_FLOOR} />
      </mesh>
      {cells}
      {/* A little fountain at the plaza's heart. */}
      <mesh position={[...worldOf(6, 5, w, h)] as [number, number, number]}>
        <cylinderGeometry args={[0.55, 0.65, 0.5, 16]} />
        <meshToonMaterial color="#cdb27a" />
      </mesh>
      <mesh position={[worldOf(6, 5, w, h)[0], 0.55, worldOf(6, 5, w, h)[2]]}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshBasicMaterial color="#bfe0ee" transparent opacity={0.85} />
      </mesh>
    </>
  );
}

export interface TownSceneProps {
  /** The villager roster to render (defaults to the full town.ts roster). */
  villagers?: TownVillager[];
  /** The player's current grid tile — this component tweens toward it. */
  playerTile: [number, number];
  /** Fired when the Architect's input layer requests a grid step (WASD/d-pad).
   *  This component never mutates `playerTile` itself — it only reports the
   *  request; the caller updates state and passes the new tile back down. */
  onMove: (dir: TownDirection) => void;
  /** Fired whenever the villager the player is adjacent to/on changes —
   *  `null` when no villager is in range. Drive an "E: talk to <name>" prompt
   *  off this from the caller side, or use the built-in hint below. */
  onApproach: (villagerId: string | null) => void;
  /** Show the built-in "E: talk to <name>" hint overlay. Default true. */
  showApproachHint?: boolean;
}

/** Grid (Chebyshev) distance — adjacency (including the same tile) is <= APPROACH_RADIUS. */
function gridDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function TownScene({
  villagers = TOWN_VILLAGERS,
  playerTile,
  onMove: _onMove,
  onApproach,
  showApproachHint = true,
}: TownSceneProps) {
  const playerPos = useRef(new THREE.Vector3());
  const w = TOWN_WIDTH;
  const h = TOWN_HEIGHT;
  const [spawnX, , spawnZ] = worldOf(playerTile[0], playerTile[1], w, h);

  // Approach detection: nearest villager within APPROACH_RADIUS, reported via
  // onApproach whenever it changes (never every frame — this runs off the
  // authored playerTile prop, not a per-frame world-position poll).
  const nearestVillager = useMemo(() => {
    let best: TownVillager | null = null;
    let bestDist = Infinity;
    for (const v of villagers) {
      const d = gridDistance(playerTile[0], playerTile[1], v.tile[0], v.tile[1]);
      if (d <= APPROACH_RADIUS && d < bestDist) {
        best = v;
        bestDist = d;
      }
    }
    return best;
  }, [villagers, playerTile]);

  const lastApproachId = useRef<string | null>(null);
  useEffect(() => {
    const id = nearestVillager?.id ?? null;
    if (lastApproachId.current !== id) {
      lastApproachId.current = id;
      onApproach(id);
    }
  }, [nearestVillager, onApproach]);

  return (
    <>
      <Canvas
        className="stage"
        shadows={false}
        dpr={[1, getQuality().dprCap]}
        camera={{ position: [spawnX, CAM_UP, spawnZ + CAM_BACK], fov: CAM_FOV }}
      >
        <color attach="background" args={[TOWN_BG]} />
        <ResponsiveFov baseFov={CAM_FOV} maxFov={54} />
        <GooberEnv palette={ZONE_PALETTE} />
        <FollowCam target={playerPos} />
        <TownTerrain />
        <Actor
          spec={creatureFromToken(seedToken("player")).gooberSpec}
          tx={playerTile[0]}
          ty={playerTile[1]}
          w={w}
          h={h}
          seed={99}
          posOut={playerPos}
        />
        {villagers.map((v, i) => (
          <Actor
            key={v.id}
            spec={creatureFromToken(seedToken(v.id)).gooberSpec}
            tx={v.tile[0]}
            ty={v.tile[1]}
            w={w}
            h={h}
            seed={v.id.charCodeAt(v.id.length - 1) * 7 + i}
            tint={v.tint ?? "#e8a84c"}
          />
        ))}
      </Canvas>
      {showApproachHint && nearestVillager && (
        <div className="town-approach-hint">E: talk to {nearestVillager.name}</div>
      )}
    </>
  );
}
