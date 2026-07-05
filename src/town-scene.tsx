/**
 * town-scene — the walkable TOWN square, rendered self-contained (its own
 * angled top-down camera + tile terrain + goober-bodied villagers), mirroring
 * `ZoneScene.tsx`'s look (same TILE/CAM constants, the same billboard +
 * hop-tween "Actor" shape) so the town reads as the same world as the
 * overworld rather than a bolted-on screen.
 *
 * The plaza is dressed from the `town-props` kit (buildings, gateway pads, the
 * Aldercradle tree, lanterns/bushes/flowers/etc.) — a warm storybook square
 * rather than the old greybox of brown cuboids + flat colored ovals. The prop
 * components are placement-agnostic; this file decides WHERE everything sits
 * (off the tile grid) and wires live state (pad active/dormant, tree bloom).
 *
 * DECOUPLED: takes `villagers` + `playerTile` as props and fires `onMove`/
 * `onApproach` callbacks — it owns NO player-position state itself (the
 * Architect's screen/App layer does) and imports nothing from `game.ts`.
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Billboard } from "game-kit/billboard/r3f";
import { type GooberSpec } from "game-kit/creature";
import { Goober, gooberGroundLift } from "./Goober.js";
import { specForSeed } from "./goober-cache.js";
import { Villager } from "./villager-npc.js";
import { ContactBlob, GooberEnv, ZONE_PALETTE } from "./env.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality, getReducedMotion } from "./quality.js";
import {
  TownBuilding,
  MarketStall,
  AldercradleTreeProp,
  WorldGatewayPad,
  Lantern,
  FlowerBed,
  Bush,
  Barrel,
  Banner,
  Well,
  Cobblestone,
} from "./town-props.js";
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
// Tip the goober's face up toward the ~52° top-down camera so its front-facing
// eyes clear the top dome (see ZoneScene's FACE_PITCH for the full rationale).
const FACE_PITCH = 0.4;
const EYE_BULGE = 0.5;
/** A player standing on this tile, or one cardinal step away, can talk to a
 *  villager occupying that tile (adjacency, not exact overlap). */
const APPROACH_RADIUS = 1;

const TOWN_BG = "#f4e6c9";
const TOWN_GROUND_BASE = "#e3c894";
const TOWN_GROUND_SPOTS: [string, string] = ["rgba(150,110,60,0.14)", "rgba(255,244,214,0.18)"];
const TOWN_PLAZA_FLOOR = "#e9d2a0";
/** A low, warm plaza-edge wall — much shorter than the old 1.6-tall brown
 *  boxes so the square feels open, not boxed-in. */
const TOWN_WALL_LOW = "#b7a98f";

// A soft per-world accent for each gateway pad's glow, so the 8 destinations
// read as distinct places at a glance (keyed by worldtree family id).
const WORLD_PAD_TINT: Record<string, string> = {
  beast: "#8bbf5f",
  bird: "#bcdaf0",
  aquatic: "#6aa6d8",
  slime: "#a6cf72",
  nature: "#5fae5a",
  dragon: "#e8794c",
  golem: "#caa46a",
  spirit: "#b8a0e0",
};

// The 4 inner "building lots" — each was a 1×2 block of `#` wall tiles (the old
// brown cuboids). We render a real building centered on each lot instead, and
// skip drawing wall boxes for those tiles (collision still comes from the tile
// data, unchanged). `rot: 0` faces the door south (+z) toward the plaza; PI
// faces it north (−z) for the lots below the plaza.
const TOWN_BUILDINGS: Array<{ cx: number; cy: number; kind: "cottage" | "shop" | "nursery"; rot: number; banner: string }> = [
  { cx: 3, cy: 2.5, kind: "nursery", rot: 0, banner: "#6fb98f" }, // by the Cradle-Keeper
  { cx: 9, cy: 2.5, kind: "shop", rot: 0, banner: "#e8a84c" }, // by the Shopkeeper
  { cx: 3, cy: 7.5, kind: "cottage", rot: Math.PI, banner: "#7fb0c9" },
  { cx: 9, cy: 7.5, kind: "cottage", rot: Math.PI, banner: "#c97e6b" },
];
const INNER_WALL_KEYS = new Set(["3,2", "3,3", "9,2", "9,3", "3,7", "3,8", "9,7", "9,8"]);

function worldOf(x: number, y: number, w: number, h: number): [number, number, number] {
  return [(x - (w - 1) / 2) * TILE, 0, (y - (h - 1) / 2) * TILE];
}

// Deterministic ground mottling (same recipe as ZoneScene.tsx's makeGroundTexture).
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
  tex.repeat.set((TOWN_WIDTH * TILE) / 6, (TOWN_HEIGHT * TILE) / 6);
  return tex;
}

/** A goober that tweens toward its tile with a little hop arc. Lifted
 *  `gooberGroundLift` off the tile so its body rests on the plaza rather than
 *  sinking through y=0 (shadow/ring stays on the ground). The player passes
 *  `directional` to face its walk heading (eyes lead the walk) instead of
 *  billboarding — see ZoneScene's Actor for the full rationale. */
function Actor({
  spec,
  tx,
  ty,
  w,
  h,
  seed,
  posOut,
  tint,
  directional,
}: {
  spec: GooberSpec;
  tx: number;
  ty: number;
  w: number;
  h: number;
  seed: number;
  posOut?: React.MutableRefObject<THREE.Vector3>;
  tint?: string;
  /** When set, the goober faces its walk direction instead of billboarding (the player). */
  directional?: boolean;
}) {
  const grp = useRef<THREE.Group>(null);
  const cur = useRef<THREE.Vector3>(new THREE.Vector3(...worldOf(tx, ty, w, h)));
  const facing = useRef(0); // 0 = facing +Z = toward camera (see ZoneScene Actor)
  const lift = useMemo(() => gooberGroundLift(spec, GOOBER_SIZE), [spec]);
  useFrame(() => {
    const [wx, , wz] = worldOf(tx, ty, w, h);
    const dx = wx - cur.current.x;
    const dz = wz - cur.current.z;
    if (directional && dx * dx + dz * dz > 0.0004) {
      facing.current = Math.atan2(dx, dz);
    }
    cur.current.x += dx * 0.25;
    cur.current.z += dz * 0.25;
    const dist = Math.hypot(wx - cur.current.x, wz - cur.current.z);
    const p = 1 - Math.min(dist / TILE, 1);
    const hop = Math.sin(p * Math.PI) * HOP_H;
    if (grp.current) {
      grp.current.position.set(cur.current.x, hop, cur.current.z);
      if (directional) grp.current.rotation.y = facing.current;
    }
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
      {directional ? (
        <group position={[0, lift, 0]} rotation={[-FACE_PITCH, 0, 0]}>
          <Goober spec={spec} position={[0, 0, 0]} seed={seed} sizeScale={GOOBER_SIZE} eyeBulge={EYE_BULGE} />
        </group>
      ) : (
        <Billboard>
          <group position={[0, lift, 0]} rotation={[-FACE_PITCH, 0, 0]}>
            <Goober spec={spec} position={[0, 0, 0]} seed={seed} sizeScale={GOOBER_SIZE} eyeBulge={EYE_BULGE} />
          </group>
        </Billboard>
      )}
    </group>
  );
}

/** A soft floating "…" speech-bubble marker hovering over a villager's head —
 *  the "talkable" affordance so the player spots who they can walk up to
 *  before they're adjacent. A gentle up/down float + fade, reduced-motion-
 *  gated (holds a static soft glow when motion is off, never disappears). */
function TalkBubble({ tint }: { tint: string }) {
  const grp = useRef<THREE.Group>(null);
  const reduced = useRef(getReducedMotion());
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame((state) => {
    if (!grp.current) return;
    if (reduced.current) {
      grp.current.position.y = 1.28;
      return;
    }
    const t = state.clock.elapsedTime;
    grp.current.position.y = 1.28 + Math.sin(t * 1.6 + phase.current) * 0.06;
  });
  return (
    <group ref={grp} position={[0, 1.28, 0]}>
      <Billboard>
        <mesh position={[-0.11, 0, 0]}>
          <circleGeometry args={[0.05, 10]} />
          <meshBasicMaterial color="#f7efe2" transparent opacity={0.92} />
        </mesh>
        <mesh position={[0, 0.015, 0]}>
          <circleGeometry args={[0.06, 10]} />
          <meshBasicMaterial color="#f7efe2" transparent opacity={0.92} />
        </mesh>
        <mesh position={[0.11, 0, 0]}>
          <circleGeometry args={[0.05, 10]} />
          <meshBasicMaterial color="#f7efe2" transparent opacity={0.92} />
        </mesh>
        <mesh position={[-0.11, 0, -0.001]}>
          <circleGeometry args={[0.022, 8]} />
          <meshBasicMaterial color={tint} />
        </mesh>
        <mesh position={[0, 0.015, -0.001]}>
          <circleGeometry args={[0.026, 8]} />
          <meshBasicMaterial color={tint} />
        </mesh>
        <mesh position={[0.11, 0, -0.001]}>
          <circleGeometry args={[0.022, 8]} />
          <meshBasicMaterial color={tint} />
        </mesh>
      </Billboard>
    </group>
  );
}

/** A villager standing on their tile — the new person-shaped `Villager` model
 *  (idle-bobbing in place, no hop-tween since villagers never move) plus the
 *  floating talk-bubble affordance above their head and a soft tinted ground
 *  ring (kept from the old Actor look) so they still read as "this one's
 *  interactive" at a glance across the plaza. */
function VillagerActor({
  role,
  tx,
  ty,
  w,
  h,
  tint,
}: {
  role: TownVillager["role"];
  tx: number;
  ty: number;
  w: number;
  h: number;
  tint: string;
}) {
  const [wx, , wz] = worldOf(tx, ty, w, h);
  return (
    <group position={[wx, 0, wz]}>
      <group position={[0, 0.03, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[GOOBER_SIZE * 1.9, 24]} />
          <meshBasicMaterial color={tint} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      </group>
      <Villager role={role} tint={tint} position={[0, 0, 0]} scale={1} />
      <TalkBubble tint={tint} />
    </group>
  );
}

/** Smoothly track the player with the angled top-down camera. */
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

/**
 * Static plaza dressing: the textured ground, low warm edge-walls, a paved
 * cobblestone plaza ring, the four buildings on their lots, and scattered
 * decoration (lanterns, bushes, flowers, barrels, banners, a market stall, a
 * well). All static + memoized — no per-frame cost. The Aldercradle tree, the
 * Home cottage, and the world pads are rendered by TownScene (they carry live
 * state) so they aren't in here.
 */
function TownTerrain() {
  const w = TOWN_WIDTH;
  const h = TOWN_HEIGHT;
  const groundTex = useMemo(() => makeTownGroundTexture(), []);

  const cells = useMemo(() => {
    const out: React.ReactElement[] = [];
    for (let i = 0; i < TOWN_TILES.length; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      const [wx, , wz] = worldOf(x, y, w, h);
      const kind = TOWN_TILES[i];
      if (kind === "wall") {
        // Building lots are drawn as real buildings below, not wall boxes.
        if (INNER_WALL_KEYS.has(`${x},${y}`)) continue;
        out.push(
          <mesh key={i} position={[wx, 0.42, wz]}>
            <boxGeometry args={[TILE * 0.98, 0.85, TILE * 0.98]} />
            <meshToonMaterial color={TOWN_WALL_LOW} />
          </mesh>,
        );
      } else if (kind === "plaza") {
        out.push(<Cobblestone key={i} position={[wx, 0, wz]} tileSize={TILE} />);
      }
    }
    return out;
  }, [w, h]);

  const buildings = useMemo(() => {
    return TOWN_BUILDINGS.map((b, i) => {
      const [wx, , wz] = worldOf(b.cx, b.cy, w, h);
      const f = b.rot === 0 ? 1 : -1; // which way the door/front faces in z
      return (
        <group key={i}>
          <TownBuilding kind={b.kind} position={[wx, 0, wz]} rotation={b.rot} />
          <Lantern position={[wx + 1.0, 0, wz + f * 0.9]} />
          <Bush position={[wx - 1.05, 0, wz + f * 0.6]} />
          <Barrel position={[wx + 1.1, 0, wz + f * 0.15]} />
          <Banner position={[wx - 0.55, 0, wz + f * 0.78]} tint={b.banner} />
          {b.kind === "shop" && <MarketStall position={[wx, 0, wz + f * 1.55]} rotation={b.rot} />}
        </group>
      );
    });
  }, [w, h]);

  const plazaDressing = useMemo(() => {
    const [tx, , tz] = worldOf(TOWN_TREE_TILE[0], TOWN_TREE_TILE[1], w, h);
    const [wellX, , wellZ] = worldOf(8, 7, w, h);
    return (
      <>
        <Lantern position={[tx - 1.9, 0, tz - 1.9]} />
        <Lantern position={[tx + 1.9, 0, tz - 1.9]} />
        <Lantern position={[tx - 1.9, 0, tz + 1.9]} />
        <Lantern position={[tx + 1.9, 0, tz + 1.9]} />
        <FlowerBed position={[tx - 1.0, 0, tz - 2.0]} />
        <FlowerBed position={[tx + 1.0, 0, tz - 2.0]} />
        <Well position={[wellX, 0, wellZ]} />
      </>
    );
  }, [w, h]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[w * TILE + 6, h * TILE + 6]} />
        <meshToonMaterial map={groundTex} color={TOWN_PLAZA_FLOOR} />
      </mesh>
      {cells}
      {buildings}
      {plazaDressing}
    </>
  );
}

export interface TownSceneProps {
  /** The villager roster to render (defaults to the full town.ts roster). */
  villagers?: TownVillager[];
  /** UNLOCKED world pads — rendered as active glowing gateways. */
  activePads?: TownWorldPad[];
  /** The player's current grid tile — this component tweens toward it. */
  playerTile: [number, number];
  /** Fired when the input layer requests a grid step (WASD/d-pad). */
  onMove: (dir: TownDirection) => void;
  /** Fired whenever the nearest in-range villager changes (null = none). */
  onApproach: (villagerId: string | null) => void;
  /** Fired whenever adjacency to the Home building's door tile changes. */
  onApproachHome?: (near: boolean) => void;
  /** Fired whenever adjacency to the Aldercradle tree's tile changes. */
  onApproachTree?: (near: boolean) => void;
  /** How many of the 8 Heartseeds are recovered (0..8) — drives the tree's bloom. */
  healedCount?: number;
  /** DORMANT (not-yet-unlocked) world pads — rendered dimmed/mossy. */
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
        <AldercradleTreeProp
          position={worldOf(TOWN_TREE_TILE[0], TOWN_TREE_TILE[1], w, h)}
          stage={healedCount / 8}
          scale={1.35}
        />
        <TownBuilding kind="cottage" position={worldOf(TOWN_HOME_TILE[0], TOWN_HOME_TILE[1], w, h)} tint="#d9b48a" />
        {activePads.map((p) => (
          <WorldGatewayPad
            key={p.worldId}
            position={worldOf(p.tile[0], p.tile[1], w, h)}
            tint={WORLD_PAD_TINT[p.worldId] ?? "#e7c86a"}
            active
          />
        ))}
        {dormantPads.map((p) => (
          <WorldGatewayPad key={p.worldId} position={worldOf(p.tile[0], p.tile[1], w, h)} active={false} />
        ))}
        <Actor
          spec={specForSeed("player")}
          tx={playerTile[0]}
          ty={playerTile[1]}
          w={w}
          h={h}
          seed={99}
          posOut={playerPos}
          directional
        />
        {villagers.map((v) => (
          <VillagerActor
            key={v.id}
            role={v.role}
            tx={v.tile[0]}
            ty={v.tile[1]}
            w={w}
            h={h}
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
