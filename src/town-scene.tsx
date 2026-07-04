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
import { type GooberSpec } from "game-kit/creature";
import { Goober } from "./Goober.js";
import { specForSeed } from "./goober-cache.js";
import { ContactBlob, GooberEnv, ZONE_PALETTE } from "./env.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality } from "./quality.js";
import {
  TOWN_HEIGHT,
  TOWN_TILES,
  TOWN_WIDTH,
  TOWN_VILLAGERS,
  TOWN_WORLD_PADS,
  TOWN_HOME_TILE,
  TOWN_TREE_TILE,
  type TownDirection,
  type TownWorldPad,
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

/** Static tile geometry: plaza walls + the paved ring + the ground (the
 *  Aldercradle tree itself is rendered separately by `<AldercradleTree>`,
 *  keeping the world-tree's own bloom-stage logic out of the terrain mesh). */
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
    </>
  );
}

// ── the Aldercradle (the world-tree, plaza center — replaces the old fountain) ──
//
// A withered, bare sapling at 0/8 Heartseeds grows fuller/greener/more
// luminous toward a whole, glowing, blossoming tree at 8/8 — all via cheap,
// STATIC procedural geometry (a trunk cylinder + a small fixed cluster of
// canopy spheres) whose per-stage color/scale/opacity + a soft point light
// are derived once via useMemo keyed on `healedCount` (0..8) — NOT rebuilt
// per frame, and no shaders: this only touches material props + transforms,
// exactly the kind of "cheap" the mobile-first brief asks for.
const TREE_WITHERED = "#8a7a5a"; // bare/dry — 0 seeds
const TREE_BUDDING = "#9db56a"; // first green — a few seeds
const TREE_LUSH = "#5fae5a"; // full canopy green — most seeds
const TREE_BLOOM = "#e7c86a"; // golden bloom accent — 8/8 whole

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bch = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bch).toString(16).slice(1)}`;
}

interface TreeStage {
  canopyColor: string;
  trunkColor: string;
  canopyScale: number;
  canopyOpacity: number;
  glowOpacity: number;
  glowColor: string;
  lightIntensity: number;
}

/** The tree's whole visual state for a given healed count (0..8) — pure, so
 *  it's cheap to recompute only when `healedCount` actually changes. */
function stageFor(healed: number): TreeStage {
  const t = Math.max(0, Math.min(8, healed)) / 8;
  // Bare -> budding over the first half, budding -> lush -> bloom over the second.
  const canopyColor =
    t < 0.5 ? lerpColor(TREE_WITHERED, TREE_BUDDING, t / 0.5) : lerpColor(TREE_LUSH, TREE_BLOOM, (t - 0.5) / 0.5);
  const trunkColor = lerpColor("#6b5638", "#8a6a3f", t);
  return {
    canopyColor,
    trunkColor,
    canopyScale: 0.55 + t * 0.65, // bare little sapling -> a full, wide canopy
    canopyOpacity: 0.55 + t * 0.45,
    glowOpacity: t * 0.5,
    glowColor: TREE_BLOOM,
    lightIntensity: t * 1.4,
  };
}

/** A fixed cluster of canopy-ball offsets (never regenerated) — only their
 *  material color/opacity/scale change with bloom stage. */
const CANOPY_BALLS: Array<[number, number, number, number]> = [
  [0, 0, 0, 1.0],
  [0.5, 0.18, 0.3, 0.72],
  [-0.5, 0.12, -0.25, 0.7],
  [0.15, 0.42, -0.4, 0.6],
  [-0.3, 0.38, 0.35, 0.62],
  [0, -0.15, 0.5, 0.58],
];

function AldercradleTree({ w, h, healedCount }: { w: number; h: number; healedCount: number }) {
  const [wx, , wz] = worldOf(TOWN_TREE_TILE[0], TOWN_TREE_TILE[1], w, h);
  const stage = useMemo(() => stageFor(healedCount), [healedCount]);
  const canopyY = 1.15;
  return (
    <group position={[wx, 0, wz]}>
      {/* A little root-mound where the fountain's base used to sit. */}
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.62, 0.72, 0.16, 16]} />
        <meshToonMaterial color="#a9946a" />
      </mesh>
      {/* Trunk. */}
      <mesh position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 1.1, 10]} />
        <meshToonMaterial color={stage.trunkColor} />
      </mesh>
      {/* Canopy — a fixed cluster of soft balls that grow/green/brighten with
          the Heartseed count (never rebuilt, only re-tinted/re-scaled). */}
      {CANOPY_BALLS.map(([ox, oy, oz, baseR], i) => (
        <mesh key={i} position={[ox * stage.canopyScale, canopyY + oy * stage.canopyScale, oz * stage.canopyScale]}>
          <sphereGeometry args={[baseR * stage.canopyScale * 0.62, 10, 10]} />
          <meshToonMaterial color={stage.canopyColor} transparent opacity={stage.canopyOpacity} />
        </mesh>
      ))}
      {/* A soft golden glow disc at the base once the tree starts blooming. */}
      {stage.glowOpacity > 0 && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.3, 24]} />
          <meshBasicMaterial color={stage.glowColor} transparent opacity={stage.glowOpacity} depthWrite={false} />
        </mesh>
      )}
      {stage.lightIntensity > 0 && (
        <pointLight position={[0, 1.6, 0]} color={stage.glowColor} intensity={stage.lightIntensity} distance={6} decay={2} />
      )}
    </group>
  );
}

/** A zone teleporter pad — the same golden-torus-ring + disc look
 *  ZoneScene.tsx's portal tiles use, so a plaza pad reads as "the same kind of
 *  thing" as the overworld portals, plus a small floating destination label
 *  (a DOM billboard-free approach: an HTML nameplate positioned via the
 *  Canvas's own screen-space projection would need extra wiring this task
 *  doesn't need — the label just rides the same world tile visually via a
 *  billboarded plane of text is overkill for one word, so this renders NO
 *  in-canvas text; the destination reads from the HUD/hint overlay instead). */
function PortalPad({ tile, w, h }: { tile: [number, number]; w: number; h: number }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.5;
  });
  const [wx, , wz] = worldOf(tile[0], tile[1], w, h);
  return (
    <group position={[wx, 0.06, wz]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.7, 0.14, 12, 28]} />
        <meshBasicMaterial color="#e7c86a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <circleGeometry args={[0.7, 24]} />
        <meshBasicMaterial color="#f4e3c4" transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

/** A DORMANT (not-yet-unlocked) world pad — worldtree.ts's Aldercradle chain
 *  hasn't opened this world yet (the world before it in WORLD_ORDER isn't
 *  healed). Deliberately the visual OPPOSITE of a live `PortalPad`:
 *  dimmed/desaturated stone, no golden glow, no spin — it reads at a glance
 *  as "not ready yet" rather than "step here to travel". Walking onto it
 *  never travels (game.ts's townStep reports a `dormant` pending, never a
 *  `portal` one) — App.tsx shows a soft hint instead. */
function DormantPad({ tile, w, h }: { tile: [number, number]; w: number; h: number }) {
  const [wx, , wz] = worldOf(tile[0], tile[1], w, h);
  return (
    <group position={[wx, 0.03, wz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 20]} />
        <meshToonMaterial color="#7a7264" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <ringGeometry args={[0.6, 0.7, 20]} />
        <meshBasicMaterial color="#5a5648" transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The Home building — a small cozy house reading clearly as a distinct
 *  structure (not a villager, not a pad): a boxy body, a peaked roof, and a
 *  warm little door. Entered by walking onto its tile or pressing E while
 *  adjacent (mirrors the villager-talk interaction). */
function HomeBuilding({ w, h }: { w: number; h: number }) {
  const [wx, , wz] = worldOf(TOWN_HOME_TILE[0], TOWN_HOME_TILE[1], w, h);
  return (
    <group position={[wx, 0, wz]}>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[1.5, 1.1, 1.3]} />
        <meshToonMaterial color="#c9946b" />
      </mesh>
      <mesh position={[0, 1.28, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.15, 0.7, 4]} />
        <meshToonMaterial color="#8a5a3a" />
      </mesh>
      <mesh position={[0, 0.35, 0.66]}>
        <boxGeometry args={[0.42, 0.7, 0.06]} />
        <meshToonMaterial color="#5a3a24" />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.95, 20]} />
        <meshBasicMaterial color="#f4d98a" transparent opacity={0.32} depthWrite={false} />
      </mesh>
    </group>
  );
}

export interface TownSceneProps {
  /** The villager roster to render (defaults to the full town.ts roster). */
  villagers?: TownVillager[];
  /** UNLOCKED world pads to render as active golden portals (default: none —
   *  the caller filters TOWN_WORLD_PADS to worldtree.ts's `isWorldUnlocked`
   *  before passing it in, so a locked world's pad never renders as active). */
  activePads?: TownWorldPad[];
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
  /** Fired whenever adjacency to the Home building's door tile changes. */
  onApproachHome?: (near: boolean) => void;
  /** Fired whenever adjacency to the Aldercradle tree's tile changes. */
  onApproachTree?: (near: boolean) => void;
  /** How many of the 8 Heartseeds are recovered (0..8) — drives the
   *  Aldercradle tree's bloom stage. Defaults to 0 (a bare, withered sapling)
   *  so this component never needs game.ts to render something reasonable. */
  healedCount?: number;
  /** DORMANT (not-yet-unlocked) world pads to render dimmed (default the full
   *  TOWN_WORLD_PADS list — the caller filters out any pad already active in
   *  `activePads` before passing it in). */
  dormantPads?: TownWorldPad[];
  /** Show the built-in "E: talk to <name>" hint overlay. Default true. */
  showApproachHint?: boolean;
}

/** Grid (Chebyshev) distance — adjacency (including the same tile) is <= APPROACH_RADIUS. */
function gridDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function TownScene({
  villagers = TOWN_VILLAGERS,
  activePads = [],
  playerTile,
  onMove: _onMove,
  onApproach,
  onApproachHome,
  onApproachTree,
  healedCount = 0,
  dormantPads = TOWN_WORLD_PADS,
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

  // Same adjacency rule as villagers — the Home door tile itself, or one
  // cardinal step away, counts as "near enough to press E".
  const nearHome = useMemo(
    () => gridDistance(playerTile[0], playerTile[1], TOWN_HOME_TILE[0], TOWN_HOME_TILE[1]) <= APPROACH_RADIUS,
    [playerTile],
  );
  const lastNearHome = useRef(false);
  useEffect(() => {
    if (lastNearHome.current !== nearHome) {
      lastNearHome.current = nearHome;
      onApproachHome?.(nearHome);
    }
  }, [nearHome, onApproachHome]);

  // Same adjacency rule again — the Aldercradle's own tile, or one step away.
  const nearTree = useMemo(
    () => gridDistance(playerTile[0], playerTile[1], TOWN_TREE_TILE[0], TOWN_TREE_TILE[1]) <= APPROACH_RADIUS,
    [playerTile],
  );
  const lastNearTree = useRef(false);
  useEffect(() => {
    if (lastNearTree.current !== nearTree) {
      lastNearTree.current = nearTree;
      onApproachTree?.(nearTree);
    }
  }, [nearTree, onApproachTree]);

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
        <AldercradleTree w={w} h={h} healedCount={healedCount} />
        <HomeBuilding w={w} h={h} />
        {activePads.map((p) => (
          <PortalPad key={p.worldId} tile={p.tile} w={w} h={h} />
        ))}
        {dormantPads.map((p) => (
          <DormantPad key={p.worldId} tile={p.tile} w={w} h={h} />
        ))}
        <Actor
          spec={specForSeed("player")}
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
            spec={specForSeed(v.id)}
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
      {showApproachHint && !nearestVillager && nearHome && (
        <div className="town-approach-hint">E: enter Home</div>
      )}
      {showApproachHint && !nearestVillager && !nearHome && nearTree && (
        <div className="town-approach-hint">E: visit the Aldercradle</div>
      )}
    </>
  );
}
