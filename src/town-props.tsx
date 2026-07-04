/**
 * town-props — a reusable library of low-poly, cel-shaded decoration/building
 * props for upgrading the TOWN plaza from greybox (brown cuboids + a stump +
 * flat colored ovals) to a warm, lived-in storybook place (DQM/Ghibli
 * cozy — Animal Crossing / Ni no Kuni warmth, NOT grimdark, NOT hyper-detailed).
 *
 * Self-contained + placement-agnostic: every component here is a pure,
 * presentational `<group>` of meshes taking position/rotation/scale/tint
 * props. NOTHING here imports game state — the Architect (town-scene.tsx)
 * decides where things go and wires any live state (e.g. `active` on the
 * world-gateway pad, `stage`/`healedCount` on the Aldercradle tree).
 *
 * Conventions matched from town-scene.tsx (read-only reference, not edited):
 *   - TILE = 2.2 world units/tile, and its `worldOf(x,y,w,h)` grid mapping —
 *     props are sized to sit naturally within one ~2.2-unit tile footprint
 *     (a building may spill slightly over its tile, same as town-scene's
 *     existing HomeBuilding box).
 *   - The angled top-down camera (~52°, CAM_UP=18/CAM_BACK=14) — silhouettes
 *     favor readable roeflines/canopy tops over front-face detail.
 *   - Plain `meshToonMaterial color={...}` (no custom gradientMap) is the
 *     look town-scene.tsx already uses for terrain/buildings/pads — matched
 *     here rather than Goober.tsx's custom rim-lit toon shader (that shader
 *     is creature-specific; re-implementing it for static props would cost
 *     more than it buys visually and isn't asked for).
 *   - `ContactBlob`-style soft ground shadows, `GooberEnv`/`ZONE_PALETTE`
 *     tone, and the styles.css warm palette (parchment/tan/warm/bond greens).
 *
 * PERF (the whole point — mobile budget is tight, dozens of these on screen):
 *   - A handful of MODULE-LEVEL shared `meshToonMaterial` instances (by tint
 *     family) so many props reuse the same GPU material rather than each
 *     mounting its own; component-level `useMemo` is used only where a color
 *     genuinely varies per-instance (tint-parameterized props).
 *   - Low segment counts everywhere (6–10 radial segments on cylinders/cones,
 *     8–10 on spheres) — these read fine as smooth-enough at the camera's
 *     distance and angle, and cost a fraction of a default-32-segment mesh.
 *   -   NO per-prop useFrame. The only animated things are (a) the world
 *     gateway's single shared shimmer driven by one shared clock read inside
 *     each mounted pad (a cheap sin() on existing frame time, skipped
 *     entirely when getReducedMotion() is true) and (b) nothing else moves.
 *   - Ground/plaza textures are deterministic CanvasTexture generators,
 *     same recipe as town-scene's makeTownGroundTexture — built once and
 *     memoized, never regenerated per frame.
 *   - `shadows={false}` is a scene-level Canvas setting (the Architect's
 *     concern) — nothing here casts/receives real shadows; grounding is via
 *     the same cheap flat "fake AO" blob/glow-disc trick town-scene.tsx uses.
 *
 * Usage (Architect wiring sketch):
 *   <Canvas shadows={false}>
 *     <TownLighting />
 *     <Cottage position={[wx, 0, wz]} />
 *     <MarketStall position={[wx2, 0, wz2]} rotation={Math.PI / 2} />
 *     <AldercradleTreeProp position={[wx3, 0, wz3]} stage={healedCount / 8} />
 *     <WorldGatewayPad position={[wx4, 0, wz4]} active={isWorldUnlocked(id)} />
 *   </Canvas>
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getReducedMotion } from "./quality.js";

// ─────────────────────────────────────────────────────────────────────────
// Palette — pulled from styles.css tokens + env.tsx's ZONE_PALETTE so props
// sit in the same warm world as the rest of the game (parchment/tan/sable
// browns, soft greens, warm glows — never random bright colors).
// ─────────────────────────────────────────────────────────────────────────
export const TOWN_PROPS_PALETTE = {
  parchment: "#f7efe2",
  parchmentDeep: "#efe3cf",
  warm: "#e8a84c",
  warmDeep: "#c9762e",
  bond: "#6fb98f",
  sky: "#9ed0ee",
  ink: "#2b2440",
  // Building materials.
  woodLight: "#c9946b",
  woodMid: "#a97a4a",
  woodDark: "#6b4a30",
  roofClay: "#b0623c",
  roofSlate: "#7a6a63",
  roofThatch: "#c9a75a",
  stone: "#a79a86",
  stoneDark: "#877a68",
  moss: "#6a8f5a",
  leafDark: "#4f8a4a",
  leafLight: "#8bbf5f",
  glowGold: "#f4d98a",
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Shared materials — module-level singletons so many prop instances share
// the same GPU material rather than each allocating its own. Keyed loosely
// by color family; tint-parameterized props fall back to a small memoized
// per-instance material only when a caller actually overrides the color.
// ─────────────────────────────────────────────────────────────────────────
const sharedToon = new Map<string, THREE.MeshToonMaterial>();
function toonOf(color: string, opts?: { transparent?: boolean; opacity?: number }): THREE.MeshToonMaterial {
  const key = `${color}|${opts?.transparent ?? false}|${opts?.opacity ?? 1}`;
  let mat = sharedToon.get(key);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({
      color,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
    });
    sharedToon.set(key, mat);
  }
  return mat;
}

const sharedBasic = new Map<string, THREE.MeshBasicMaterial>();
function basicOf(color: string, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  let mat = sharedBasic.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false });
    sharedBasic.set(key, mat);
  }
  return mat;
}

/** Cheap flat "grounding" disc under a prop's base — same fake-AO trick as
 *  env.tsx's ContactBlob, reimplemented tiny/inline so this file stays
 *  zero-cross-import from env.tsx (mirrors town-scene.tsx's own philosophy
 *  of re-deriving small shared recipes locally rather than coupling files). */
function GroundBlob({ radius = 0.7, opacity = 0.28 }: { radius?: number; opacity?: number }) {
  return (
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <circleGeometry args={[radius, 16]} />
      <primitive object={basicOf("#20201a", opacity)} attach="material" />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Common prop-transform props every component accepts.
// ─────────────────────────────────────────────────────────────────────────
export interface PropTransform {
  position?: [number, number, number];
  /** Y-axis rotation in radians (props only ever need to face a direction). */
  rotation?: number;
  scale?: number;
}

function useGroupProps(t: PropTransform) {
  return {
    position: t.position ?? ([0, 0, 0] as [number, number, number]),
    rotation: [0, t.rotation ?? 0, 0] as [number, number, number],
    scale: t.scale ?? 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// BUILDINGS
// ─────────────────────────────────────────────────────────────────────────

/** Shared hipped/pitched roof — four sloped faces via a low-poly cone with a
 *  square base (radialSegments=4), reused by every building kind at whatever
 *  size/color/rotation it's asked for. Cheap: one draw call, 4 tris/side. */
function HippedRoof({
  y,
  radius,
  height,
  color,
  segments = 4,
}: {
  y: number;
  radius: number;
  height: number;
  color: string;
  segments?: number;
}) {
  return (
    <mesh position={[0, y, 0]} rotation={[0, Math.PI / 4, 0]}>
      <coneGeometry args={[radius, height, segments]} />
      <primitive object={toonOf(color)} attach="material" />
    </mesh>
  );
}

/** A simple door plate + a couple of tiny window plates — shared by all
 *  buildings so facades read consistently. */
function Facade({
  doorColor,
  frameColor,
  windowColor,
  depth,
  bodyHeight,
  withWindows = true,
}: {
  doorColor: string;
  frameColor: string;
  windowColor: string;
  depth: number;
  bodyHeight: number;
  withWindows?: boolean;
}) {
  return (
    <>
      {/* Door. */}
      <mesh position={[0, bodyHeight * 0.32, depth / 2 + 0.001]}>
        <boxGeometry args={[0.42, bodyHeight * 0.62, 0.06]} />
        <primitive object={toonOf(doorColor)} attach="material" />
      </mesh>
      {withWindows && (
        <>
          <mesh position={[-0.5, bodyHeight * 0.62, depth / 2 + 0.001]}>
            <boxGeometry args={[0.28, 0.28, 0.05]} />
            <primitive object={toonOf(windowColor, { transparent: true, opacity: 0.85 })} attach="material" />
          </mesh>
          <mesh position={[0.5, bodyHeight * 0.62, depth / 2 + 0.001]}>
            <boxGeometry args={[0.28, 0.28, 0.05]} />
            <primitive object={toonOf(windowColor, { transparent: true, opacity: 0.85 })} attach="material" />
          </mesh>
          <mesh position={[0, bodyHeight * 0.62, depth / 2 + 0.002]}>
            <boxGeometry args={[0.32, 0.32, 0.02]} />
            <primitive object={toonOf(frameColor)} attach="material" />
          </mesh>
        </>
      )}
    </>
  );
}

export type BuildingKind = "cottage" | "shop" | "nursery";

export interface TownBuildingProps extends PropTransform {
  kind?: BuildingKind;
  /** Overrides the body wall color (defaults come from `kind`). */
  tint?: string;
}

const BUILDING_DEFAULTS: Record<BuildingKind, { wall: string; roof: string; door: string; trim: string }> = {
  cottage: { wall: TOWN_PROPS_PALETTE.woodLight, roof: TOWN_PROPS_PALETTE.roofClay, door: TOWN_PROPS_PALETTE.woodDark, trim: TOWN_PROPS_PALETTE.warmDeep },
  shop: { wall: TOWN_PROPS_PALETTE.parchmentDeep, roof: TOWN_PROPS_PALETTE.roofSlate, door: TOWN_PROPS_PALETTE.woodDark, trim: TOWN_PROPS_PALETTE.warm },
  nursery: { wall: "#e7d3b8", roof: TOWN_PROPS_PALETTE.bond, door: TOWN_PROPS_PALETTE.woodMid, trim: TOWN_PROPS_PALETTE.leafLight },
};

/**
 * A general-purpose small building — body + pitched/hipped roof + door +
 * windows, `kind` picks a sensible default palette so facilities read as
 * distinct at a glance (a market's cooler slate roof + awning-ready walls vs.
 * a cottage's warm clay roof vs. a nursery's soft green-roofed cradle-house).
 * Replaces the plain brown-cuboid HomeBuilding/generic building meshes.
 */
export function TownBuilding({ kind = "cottage", tint, position, rotation, scale }: TownBuildingProps) {
  const g = useGroupProps({ position, rotation, scale });
  const d = BUILDING_DEFAULTS[kind];
  const wall = tint ?? d.wall;
  const bodyH = kind === "nursery" ? 0.95 : 1.1;
  const bodyW = kind === "shop" ? 1.7 : 1.5;
  const bodyD = 1.3;
  const wallMat = useMemo(() => toonOf(wall), [wall]);
  return (
    <group {...g}>
      <GroundBlob radius={1.0} />
      <mesh position={[0, bodyH / 2, 0]}>
        <boxGeometry args={[bodyW, bodyH, bodyD]} />
        <primitive object={wallMat} attach="material" />
      </mesh>
      <HippedRoof
        y={bodyH + (kind === "nursery" ? 0.32 : 0.36)}
        radius={kind === "shop" ? 1.35 : 1.15}
        height={kind === "nursery" ? 0.55 : 0.7}
        color={d.roof}
      />
      <Facade doorColor={d.door} frameColor={d.trim} windowColor="#bfe3ea" depth={bodyD} bodyHeight={bodyH} />
      {kind === "shop" && (
        // A striped awning over the door reads "market/shop" at a glance.
        <mesh position={[0, bodyH * 0.78, bodyD / 2 + 0.28]} rotation={[-0.35, 0, 0]}>
          <boxGeometry args={[0.9, 0.06, 0.5]} />
          <primitive object={toonOf(TOWN_PROPS_PALETTE.warmDeep)} attach="material" />
        </mesh>
      )}
      {kind === "nursery" && (
        // A softer little dormer/gable accent instead of a hard peak, plus a
        // small cradle-shaped porch rail, keeping the nursery gentle/round.
        <mesh position={[0, bodyH + 0.02, bodyD / 2 + 0.02]}>
          <torusGeometry args={[0.34, 0.05, 6, 12, Math.PI]} />
          <primitive object={toonOf(TOWN_PROPS_PALETTE.leafLight)} attach="material" />
        </mesh>
      )}
      {/* A warm little glow disc at the doorway — same base treatment as
          town-scene.tsx's HomeBuilding "window glow" ground disc. */}
      <mesh position={[0, 0.045, bodyD / 2 + 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.85, 16]} />
        <primitive object={basicOf(TOWN_PROPS_PALETTE.glowGold, 0.28)} attach="material" />
      </mesh>
    </group>
  );
}

/** Convenience aliases — same component, fixed `kind`, so callers can write
 *  `<Cottage />` / `<Shop />` / `<Nursery />` without repeating the prop. */
export function Cottage(props: Omit<TownBuildingProps, "kind">) {
  return <TownBuilding kind="cottage" {...props} />;
}
export function Shop(props: Omit<TownBuildingProps, "kind">) {
  return <TownBuilding kind="shop" {...props} />;
}
export function Nursery(props: Omit<TownBuildingProps, "kind">) {
  return <TownBuilding kind="nursery" {...props} />;
}

// ─────────────────────────────────────────────────────────────────────────
// MARKET STALL
// ─────────────────────────────────────────────────────────────────────────

export interface MarketStallProps extends PropTransform {
  /** Awning stripe tint (the second stripe color is always the parchment). */
  tint?: string;
}

/** A shopkeeper's stall — four posts + a striped pitched awning + a counter
 *  plank + a couple of produce crates. Reads as "market" from the angled cam
 *  via the awning's silhouette + color stripes. */
export function MarketStall({ tint = TOWN_PROPS_PALETTE.warmDeep, position, rotation, scale }: MarketStallProps) {
  const g = useGroupProps({ position, rotation, scale });
  const stripeMat = useMemo(() => toonOf(tint), [tint]);
  const postMat = toonOf(TOWN_PROPS_PALETTE.woodMid);
  const parchmentMat = toonOf(TOWN_PROPS_PALETTE.parchment);
  const postPositions: [number, number][] = [
    [-0.7, -0.45],
    [0.7, -0.45],
    [-0.7, 0.45],
    [0.7, 0.45],
  ];
  return (
    <group {...g}>
      <GroundBlob radius={0.95} />
      {postPositions.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.55, z]}>
          <cylinderGeometry args={[0.045, 0.045, 1.1, 6]} />
          <primitive object={postMat} attach="material" />
        </mesh>
      ))}
      {/* Counter plank. */}
      <mesh position={[0, 0.5, 0.45]}>
        <boxGeometry args={[1.5, 0.08, 0.35]} />
        <primitive object={postMat} attach="material" />
      </mesh>
      {/* Striped pitched awning — two thin slanted planes, alternating tint. */}
      <mesh position={[0, 1.15, -0.15]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[1.6, 0.05, 0.9]} />
        <primitive object={stripeMat} attach="material" />
      </mesh>
      <mesh position={[0, 1.2, -0.02]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[1.6, 0.06, 0.18]} />
        <primitive object={parchmentMat} attach="material" />
      </mesh>
      <mesh position={[0, 1.1, -0.32]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[1.6, 0.06, 0.18]} />
        <primitive object={parchmentMat} attach="material" />
      </mesh>
      {/* A hanging sign plank. */}
      <mesh position={[0.75, 0.95, 0.46]}>
        <boxGeometry args={[0.22, 0.16, 0.03]} />
        <primitive object={parchmentMat} attach="material" />
      </mesh>
      {/* Produce crates + a couple of "fruit" balls. */}
      <mesh position={[-0.55, 0.16, 0.55]}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <primitive object={postMat} attach="material" />
      </mesh>
      <mesh position={[0.05, 0.4, 0.58]}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.warm)} attach="material" />
      </mesh>
      <mesh position={[-0.05, 0.38, 0.62]}>
        <sphereGeometry args={[0.08, 8, 6]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.bond)} attach="material" />
      </mesh>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ALDERCRADLE TREE (a proper standalone version — same bloom-stage recipe as
// town-scene.tsx's AldercradleTree, but self-contained here as a reusable
// prop taking a plain 0..1 `stage` so this file has zero import of town.ts's
// healedCount semantics; the Architect maps healedCount/8 -> stage).
// ─────────────────────────────────────────────────────────────────────────

const TREE_BARK_WINTER = "#8f8578"; // greyed, wistful winter bark
const TREE_BARK_WINTER_B = "#7d7566"; // second winter bark tone (subtle variation)
const TREE_BARK_WARM = "#7a5a38"; // warm lived-in bark once budding starts
const TREE_BARK_WARM_B = "#6a4c30"; // second warm bark tone (subtle variation)
const TREE_LEAF_WITHERED = "#a89a6e"; // sparse dry clinging leaves at stage 0
const TREE_LEAF_BUD = "#8fb35f"; // fresh budding green
const TREE_LEAF_LUSH = "#4f9a4c"; // full lush green
const TREE_LEAF_LUSH_LIGHT = "#8bc766"; // top-lit lush highlight
const TREE_LEAF_GOLD = "#e9b94a"; // radiant golden bloom foliage
const TREE_LEAF_GOLD_LIGHT = "#f7dd8a"; // top-lit gold highlight
const TREE_UNDERSIDE_DARK = "#2f5230"; // shadowed inner/underside green
const TREE_BLOOM_ACCENT = "#f2c8dd"; // small blossom-dot accents at full bloom
const TREE_GLOW = "#f4d98a";

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const gc = Math.round(ag + (bg - ag) * t);
  const bc = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (gc << 8) + bc).toString(16).slice(1)}`;
}

interface TreeStage {
  /** 0 winter / 1 budding / 2 lush / 3 golden-bloom — drives which canopy
   *  clusters are present (sparse→full), not just their tint. */
  bareness: number;
  trunkColor: string;
  trunkColorB: string;
  /** Underside/inner shadow tone for this stage's foliage family. */
  underColor: string;
  /** Top-lit brighter tone for this stage's foliage family. */
  topColor: string;
  /** Base (mid) tone for this stage's foliage family. */
  midColor: string;
  canopyFill: number; // 0..1 — how much of the full canopy cluster set renders
  canopyScale: number;
  glowOpacity: number;
  lightIntensity: number;
  blossoms: boolean;
  motes: boolean;
}

/**
 * A believable seasonal arc: 0 = bare wistful winter (grey bark, a scatter of
 * dry clinging leaves, no full crown), ~0.4 budding green tips, ~0.7 a full
 * lush crown, 1.0 = golden-blossomed (warm gold canopy + blossom dots + glow +
 * light + drifting motes). Every value in between eases smoothly.
 */
function stageFor(t01: number): TreeStage {
  const t = Math.max(0, Math.min(1, t01));
  const trunkColor = lerpColor(TREE_BARK_WINTER, TREE_BARK_WARM, Math.min(1, t / 0.5));
  const trunkColorB = lerpColor(TREE_BARK_WINTER_B, TREE_BARK_WARM_B, Math.min(1, t / 0.5));
  let midColor: string, topColor: string, underColor: string;
  if (t < 0.4) {
    const lt = t / 0.4;
    midColor = lerpColor(TREE_LEAF_WITHERED, TREE_LEAF_BUD, lt);
    topColor = midColor;
    underColor = lerpColor("#6b6248", "#3f6a3f", lt);
  } else if (t < 0.7) {
    const lt = (t - 0.4) / 0.3;
    midColor = lerpColor(TREE_LEAF_BUD, TREE_LEAF_LUSH, lt);
    topColor = lerpColor(TREE_LEAF_BUD, TREE_LEAF_LUSH_LIGHT, lt);
    underColor = lerpColor("#3f6a3f", TREE_UNDERSIDE_DARK, lt);
  } else {
    const lt = (t - 0.7) / 0.3;
    midColor = lerpColor(TREE_LEAF_LUSH, TREE_LEAF_GOLD, lt);
    topColor = lerpColor(TREE_LEAF_LUSH_LIGHT, TREE_LEAF_GOLD_LIGHT, lt);
    underColor = lerpColor(TREE_UNDERSIDE_DARK, "#7a5a24", lt);
  }
  return {
    bareness: 1 - t,
    trunkColor,
    trunkColorB,
    underColor,
    topColor,
    midColor,
    canopyFill: 0.32 + t * 0.68,
    canopyScale: 0.6 + t * 0.5,
    glowOpacity: t > 0.85 ? ((t - 0.85) / 0.15) * 0.5 : 0,
    lightIntensity: t > 0.85 ? ((t - 0.85) / 0.15) * 1.3 : 0,
    blossoms: t > 0.88,
    motes: t > 0.95,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PROCEDURAL BRANCH STRUCTURE — a small deterministic (seeded) builder run
// ONCE via useMemo (never per-frame). Trunk splits into PRIMARY limbs, each
// of which forks again into SECONDARY branches (2 branching levels), each
// leg tapering and naturally spreading outward/upward. Produces a flat list
// of cylinder segment descriptors (world-space-ish local transforms) plus
// the list of branch-TIP points the canopy clusters get generated around,
// so canopy density/position always matches the actual branch structure
// rather than a hand-authored table that could drift from it.
// ─────────────────────────────────────────────────────────────────────────

interface BranchSeg {
  /** Midpoint position (cylinder meshes are positioned+rotated to span
   *  base->tip, matching the existing trunk/branch convention below). */
  pos: [number, number, number];
  rot: [number, number, number];
  length: number;
  radiusBase: number;
  radiusTip: number;
  /** Alternates true/false per-branch for the subtle bark tint variation. */
  altBark: boolean;
}

interface BranchTip {
  pos: [number, number, number];
  /** Outward direction (normalized-ish) — canopy clusters bias further out
   *  along this direction so foliage reaches past its branch tip. */
  dir: [number, number, number];
  /** Primary limbs get a bigger canopy mass than secondary twigs. */
  weight: number;
}

// Small deterministic PRNG (mulberry32-style) so the branch layout is a
// FIXED shape every mount — no per-frame or per-render regeneration, and
// no dependency on Math.random() (keeps the silhouette stable/reviewable).
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds one tapered limb segment (trunk or branch) between a base point
 *  and a computed tip point given a Y-angle + upward tilt + length, in the
 *  same position/rotation convention the original single-level tree used
 *  (cylinder's local +Y axis rotated to point from base to tip). */
function makeLimb(
  base: [number, number, number],
  angleY: number,
  tilt: number,
  length: number,
  radiusBase: number,
  radiusTip: number,
  altBark: boolean,
): { seg: BranchSeg; tip: [number, number, number]; dir: [number, number, number] } {
  const dir: [number, number, number] = [
    Math.cos(angleY) * Math.cos(tilt),
    Math.sin(tilt),
    Math.sin(angleY) * Math.cos(tilt),
  ];
  const tip: [number, number, number] = [
    base[0] + dir[0] * length,
    base[1] + dir[1] * length,
    base[2] + dir[2] * length,
  ];
  const mid: [number, number, number] = [
    (base[0] + tip[0]) / 2,
    (base[1] + tip[1]) / 2,
    (base[2] + tip[2]) / 2,
  ];
  return {
    seg: {
      pos: mid,
      rot: [Math.cos(angleY) * tilt, angleY, Math.PI / 2 - tilt],
      length,
      radiusBase,
      radiusTip,
      altBark,
    },
    tip,
    dir,
  };
}

const PRIMARY_COUNT = 3;
const SECONDARY_PER_PRIMARY = 2;
const TRUNK_SPLIT_Y = 1.4; // matches original trunk-top height

/** Builds the full 2-level branch structure ONCE (pure function of nothing
 *  but constants — called from a top-level `useMemo` with an empty dep
 *  array so it truly never rebuilds). Returns the trunk+limb segments to
 *  render as tapered cylinders plus the branch-tip list the canopy uses. */
function buildBranchStructure(): { segs: BranchSeg[]; tips: BranchTip[] } {
  const rand = seededRand(1337);
  const segs: BranchSeg[] = [];
  const tips: BranchTip[] = [];
  const trunkTop: [number, number, number] = [0, TRUNK_SPLIT_Y, 0];

  for (let p = 0; p < PRIMARY_COUNT; p++) {
    // Spread the primary limbs roughly evenly around the trunk with a bit
    // of jitter so it doesn't look like a perfect radial fan.
    const baseAngle = (p / PRIMARY_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const tilt = 0.5 + rand() * 0.28;
    const len = 0.85 + rand() * 0.3;
    const { seg, tip, dir } = makeLimb(trunkTop, baseAngle, tilt, len, 0.17, 0.09, p % 2 === 0);
    segs.push(seg);

    // Each primary forks into SECONDARY_PER_PRIMARY secondary branches,
    // splaying outward from the primary's own direction (not the trunk's),
    // so the crown reads as a real forking structure, not spokes.
    for (let sIdx = 0; sIdx < SECONDARY_PER_PRIMARY; sIdx++) {
      const splay = (sIdx - (SECONDARY_PER_PRIMARY - 1) / 2) * 0.85 + (rand() - 0.5) * 0.3;
      const subAngle = baseAngle + splay;
      const subTilt = Math.min(1.15, tilt + 0.22 + rand() * 0.25);
      const subLen = 0.55 + rand() * 0.28;
      const r = makeLimb(tip, subAngle, subTilt, subLen, 0.09, 0.035, (p + sIdx) % 2 === 0);
      segs.push(r.seg);
      tips.push({ pos: r.tip, dir: r.dir, weight: 0.85 + rand() * 0.3 });
    }
    // The primary limb tip itself also gets a (smaller) canopy mass so the
    // crown has an inner/lower layer, not just the outermost twig tips.
    tips.push({ pos: tip, dir, weight: 0.55 });
  }
  return { segs, tips };
}

/** Builds the canopy cluster layout from the branch tips ONCE, in the same
 *  deterministic-seed spirit as the branch builder. Each tip gets 2-3
 *  overlapping foliage balls of varied size/tone (biased further outward
 *  along the tip's own direction) plus a handful of low "core mass" and
 *  silhouette-filling clusters, so the crown reads as one full, irregular,
 *  layered mass rather than neat balls sitting exactly on each twig.
 *
 *  IMPORTANT: `tips` are in tree-root-local space (Y measured from the
 *  ground), but the rendered canopy sits inside a sway `<group>` pivoted at
 *  `[0, TRUNK_SPLIT_Y, 0]` (see AldercradleTreeProp) so the crown leans
 *  around a sensible point. Every coordinate here is therefore emitted
 *  relative to that same pivot (`pivotY` subtracted from tip.pos[1]) so the
 *  foliage actually lands ON the branch tips instead of floating high above
 *  them once the group's own Y offset is added back at render time. */
function buildCanopyClusters(tips: BranchTip[], pivotY: number): Array<[number, number, number, number, 0 | 1 | 2]> {
  const rand = seededRand(9001);
  const out: Array<[number, number, number, number, 0 | 1 | 2]> = [];

  // Low, wide core mass (partly shadowed underside + a mid layer), anchors
  // the silhouette so it never looks like isolated balls floating apart.
  out.push([0, -0.1, 0, 1.05, 0]);
  out.push([0.05, 0.15, 0.05, 0.95, 1]);
  out.push([-0.08, 0.05, -0.1, 0.8, 0]);

  for (const t of tips) {
    const reach = 0.28 + rand() * 0.18;
    const cx = t.pos[0] + t.dir[0] * reach;
    const cy = t.pos[1] - pivotY + t.dir[1] * reach * 0.7 + 0.05;
    const cz = t.pos[2] + t.dir[2] * reach;
    const baseR = (0.42 + rand() * 0.22) * t.weight;
    // Mid-tone body ball at the tip.
    out.push([cx, cy, cz, baseR, 1]);
    // A slightly smaller, higher/outer top-lit highlight ball offset from
    // the mid ball so the two overlap rather than coincide exactly.
    out.push([
      cx + t.dir[0] * 0.16,
      cy + 0.14 + rand() * 0.06,
      cz + t.dir[2] * 0.16,
      baseR * 0.66,
      2,
    ]);
    // A smaller shadow-toned ball tucked slightly under/inward for depth —
    // only on about half the tips (perf: keeps the total cluster count in
    // budget while still reading as layered/irregular, not per-tip-uniform).
    if (rand() > 0.5) {
      out.push([
        cx - t.dir[0] * 0.12,
        cy - 0.12,
        cz - t.dir[2] * 0.12,
        baseR * 0.58,
        0,
      ]);
    }
  }

  // A few extra fillers so the silhouette reads full/round rather than
  // clumpy-with-gaps, and a top crown cap.
  const fillers: Array<[number, number, number, number, 0 | 1 | 2]> = [
    [0.18, 1.15, 0.08, 0.46, 2],
    [-0.15, 0.42, 0.62, 0.5, 0],
    [0.4, 0.32, -0.5, 0.48, 0],
  ];
  out.push(...fillers);

  return out;
}

// Flared root ridges spreading from the trunk base onto the mound — a
// fuller ring (6) than a stumpy tree would need, so the base reads as
// genuinely ancient/buttressed from the angled top-down camera.
const ROOT_ANGLES = [0.2, 1.25, 2.15, 3.05, 4.05, 5.1];

export interface AldercradleTreeProps extends PropTransform {
  /** Bloom progress 0..1 — bare/withered/grey at 0, full green mid-way,
   *  golden-blossomed with a warm glow + point light at 1. Defaults to a
   *  fully-bloomed tree so the prop looks good with zero required props. */
  stage?: number;
}

/**
 * The Aldercradle world-tree: a real stylized Tree of Life. A tapered trunk
 * SPLITS into `PRIMARY_COUNT` primary limbs, which fork AGAIN into
 * `SECONDARY_PER_PRIMARY` secondary branches each (two branching levels,
 * built once by `buildBranchStructure`) — naturally spread, not a single
 * cylinder with a ball on top. It's rooted by a flared buttress-root base
 * (six ridges) spreading onto a mound. A rich, layered, OPAQUE crown of MANY
 * overlapping foliage clusters (`buildCanopyClusters`, generated from the
 * actual branch tips so canopy mass always matches the branch shape) forms a
 * full, irregular, organic silhouette — a shadowed underside tone, a mid
 * tone, and a brighter top-lit tone give it depth. `stage` (0..1) drives a
 * believable seasonal arc: bare wistful winter (visible branch skeleton +
 * a few dry clinging leaves, grey bark) -> ~0.4 budding green tips -> ~0.7 a
 * full lush crown -> 1.0 golden-blossomed (warm gold foliage + blossom dots
 * + glow + light + drifting motes). Geometry is a FIXED layout built ONCE
 * (`useMemo` with an empty dep array) — `stage` only ever recomputes
 * color/scale/fill via `stageFor`, never geometry. Materials are shared via
 * the module-level `toonOf`/`basicOf` caches (a handful of distinct colors
 * total, reused across every mesh). A single cheap shared canopy sway
 * (gated on `getReducedMotion()`) is the only per-frame cost, appropriate
 * for the one hero tree on screen (~59 meshes total at full bloom, within
 * the ~60-mesh mobile budget).
 */
export function AldercradleTreeProp({ stage = 1, position, rotation, scale }: AldercradleTreeProps) {
  const g = useGroupProps({ position, rotation, scale });
  const s = useMemo(() => stageFor(stage), [stage]);
  // The canopy sway group's pivot — the trunk split point, so leaning
  // rotates the whole crown around a sensible anchor (see buildCanopyClusters
  // doc comment for why canopy coords are emitted relative to this same Y).
  const canopyY = TRUNK_SPLIT_Y;

  // The branch skeleton + the canopy layout derived from it are built ONCE
  // ever (empty dep array) — nothing here depends on `stage`.
  const { segs: branchSegs, tips: branchTips } = useMemo(() => buildBranchStructure(), []);
  const canopyClusters = useMemo(() => buildCanopyClusters(branchTips, canopyY), [branchTips, canopyY]);

  const trunkMat = useMemo(() => toonOf(s.trunkColor), [s.trunkColor]);
  const trunkMatB = useMemo(() => toonOf(s.trunkColorB), [s.trunkColorB]);
  const underMat = useMemo(() => toonOf(s.underColor), [s.underColor]);
  const midMat = useMemo(() => toonOf(s.midColor), [s.midColor]);
  const topMat = useMemo(() => toonOf(s.topColor), [s.topColor]);
  const toneMat = [underMat, midMat, topMat] as const;

  // How many canopy clusters render, sparse -> full, keyed on canopyFill
  // (bare stage keeps only the core + a few tip clusters, spread across the
  // WHOLE cluster list by stride rather than truncating it, so a sparse
  // winter canopy still scatters thinly across every branch instead of
  // only ever showing one side of the tree).
  const visibleCount = Math.max(3, Math.round(canopyClusters.length * s.canopyFill));
  const stride = Math.max(1, Math.floor(canopyClusters.length / visibleCount));
  const visibleClusters = useMemo(() => {
    const picked: Array<[number, number, number, number, 0 | 1 | 2]> = [];
    for (let i = 0; i < canopyClusters.length && picked.length < visibleCount; i += stride) {
      picked.push(canopyClusters[i]);
    }
    return picked;
  }, [canopyClusters, visibleCount, stride]);

  // A few dry withered leaf-flecks + clinging buds, visible only near the
  // bare end of the arc, scattered near branch tips for a "sparse but alive"
  // winter read instead of a totally naked skeleton.
  const witheredFlecks = s.bareness > 0.3;

  // Sway ref + a shared, cheap per-frame rotation — ONE transform, skipped
  // entirely under reduced motion. A gentle "breathing" crown, not a full
  // tree-wide wind sway (the trunk/branches stay still; only the canopy
  // group leans, so it reads as living foliage, not a wobbling toy).
  const canopyRef = useRef<THREE.Group>(null);
  const reduced = useRef(getReducedMotion());
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame((state) => {
    if (reduced.current || !canopyRef.current) return;
    const t = state.clock.elapsedTime;
    canopyRef.current.rotation.z = Math.sin(t * 0.35 + phase.current) * 0.02;
    canopyRef.current.rotation.x = Math.sin(t * 0.27 + phase.current * 1.3) * 0.015;
    canopyRef.current.scale.setScalar(1 + Math.sin(t * 0.5 + phase.current) * 0.012);
  });

  return (
    <group {...g}>
      {/* Flared, rooted base — a low mound + six buttress-root ridges
          spreading outward, so the base feels ancient and truly rooted. */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.72, 0.9, 0.2, 10]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.woodLight)} attach="material" />
      </mesh>
      {ROOT_ANGLES.map((a, i) => (
        <mesh
          key={i}
          position={[Math.cos(a) * 0.58, 0.09, Math.sin(a) * 0.58]}
          rotation={[0, -a, Math.PI / 2 - 0.22]}
        >
          <coneGeometry args={[0.17, 0.92, 6]} />
          <primitive object={i % 2 === 0 ? trunkMat : trunkMatB} attach="material" />
        </mesh>
      ))}

      {/* Tapered trunk, rising to the split point. */}
      <mesh position={[0, TRUNK_SPLIT_Y / 2, 0]}>
        <cylinderGeometry args={[0.24, 0.44, TRUNK_SPLIT_Y, 9]} />
        <primitive object={trunkMat} attach="material" />
      </mesh>

      {/* The branching structure — primary limbs forking into secondary
          branches (2 levels), naturally spread via the seeded builder. */}
      {branchSegs.map((b, i) => (
        <mesh key={i} position={b.pos} rotation={b.rot}>
          <cylinderGeometry args={[b.radiusTip, b.radiusBase, b.length, 6]} />
          <primitive object={b.altBark ? trunkMatB : trunkMat} attach="material" />
        </mesh>
      ))}

      {/* Canopy — layered, OPAQUE clusters forming a full, irregular,
          organic rounded crown. A dedicated sway group so the trunk/branches
          stay planted. */}
      <group ref={canopyRef} position={[0, canopyY, 0]}>
        {visibleClusters.map(([ox, oy, oz, baseR, tone], i) => (
          <mesh key={i} position={[ox * s.canopyScale, oy * s.canopyScale, oz * s.canopyScale]}>
            <sphereGeometry args={[baseR * s.canopyScale * 0.62, 8, 7]} />
            <primitive object={toneMat[tone]} attach="material" />
          </mesh>
        ))}

        {/* Sparse dry leaf-flecks near the bare end — small flat withered
            leaf-colored discs clinging near the tip clusters. */}
        {witheredFlecks &&
          canopyClusters.slice(0, 6).map(([ox, oy, oz], i) => (
            <mesh key={`fleck-${i}`} position={[ox * s.canopyScale * 1.05, oy * s.canopyScale + 0.1, oz * s.canopyScale * 1.05]}>
              <sphereGeometry args={[0.13, 6, 5]} />
              <primitive object={toonOf(TREE_LEAF_WITHERED)} attach="material" />
            </mesh>
          ))}

        {/* Small colored blossom-dot accents once fully golden-blooming. */}
        {s.blossoms &&
          canopyClusters.slice(0, 8).map(([ox, oy, oz, baseR], i) => (
            <mesh
              key={`bloom-${i}`}
              position={[
                ox * s.canopyScale * 1.08,
                oy * s.canopyScale + baseR * 0.25,
                oz * s.canopyScale * 1.08,
              ]}
            >
              <sphereGeometry args={[0.08, 6, 6]} />
              <primitive object={toonOf(i % 2 === 0 ? TREE_BLOOM_ACCENT : TREE_LEAF_GOLD_LIGHT)} attach="material" />
            </mesh>
          ))}

        {/* A few drifting light motes at full radiance. */}
        {s.motes &&
          [0, 1, 2].map((i) => (
            <MoteSpark key={`mote-${i}`} index={i} radius={1.1 * s.canopyScale} />
          ))}
      </group>

      {s.glowOpacity > 0 && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.5, 20]} />
          <primitive object={basicOf(TREE_GLOW, s.glowOpacity)} attach="material" />
        </mesh>
      )}
      {s.lightIntensity > 0 && (
        <pointLight position={[0, canopyY + 0.5, 0]} color={TREE_GLOW} intensity={s.lightIntensity} distance={7.5} decay={2} />
      )}
    </group>
  );
}

/** One drifting golden light mote — a tiny glowing basic-material sphere
 *  orbiting slowly near the canopy, reduced-motion-gated (holds still). Cheap:
 *  one mesh, one sin/cos pair per frame, no allocation. */
function MoteSpark({ index, radius }: { index: number; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const reduced = useRef(getReducedMotion());
  const phase = (index * 1.7) % (Math.PI * 2);
  useFrame((state) => {
    if (!ref.current) return;
    if (reduced.current) {
      ref.current.position.set(Math.cos(phase) * radius, 0.4, Math.sin(phase) * radius);
      return;
    }
    const t = state.clock.elapsedTime * 0.4 + phase;
    ref.current.position.set(Math.cos(t) * radius, 0.4 + Math.sin(t * 1.3) * 0.35, Math.sin(t) * radius);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.045, 6, 6]} />
      <primitive object={basicOf(TREE_GLOW, 0.85)} attach="material" />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// WORLD GATEWAY PAD
// ─────────────────────────────────────────────────────────────────────────

export interface WorldGatewayPadProps extends PropTransform {
  /** ACTIVE = warm golden glow + a slow subtle shimmer. DORMANT = dark,
   *  mossy/vined, unlit. Default true (active). */
  active?: boolean;
  tint?: string;
}

/** One shared shimmer clock so N mounted active pads cost ~1 sin() each per
 *  frame (no allocation, no geometry rebuild) — skipped entirely under
 *  reduced motion, per the brief's "respects getReducedMotion, adds ~0 cost". */
function useShimmer(ref: React.RefObject<THREE.Mesh>) {
  const reduced = useRef(getReducedMotion());
  useFrame((_, dt) => {
    if (reduced.current || !ref.current) return;
    ref.current.rotation.z += dt * 0.25;
  });
}

/**
 * A low stone ring/arch gateway pad, replacing the flat colored ground-oval
 * teleporter. ACTIVE: a golden torus ring + glow disc + gentle spin-shimmer
 * + warm point light, unlocked-and-inviting. DORMANT: desaturated stone ring,
 * moss patches, no light, no motion — reads as "not ready yet".
 */
export function WorldGatewayPad({ active = true, tint = "#e7c86a", position, rotation, scale }: WorldGatewayPadProps) {
  const g = useGroupProps({ position, rotation, scale });
  const ringRef = useRef<THREE.Mesh>(null);
  useShimmer(ringRef as React.RefObject<THREE.Mesh>);

  const stoneMat = toonOf(active ? TOWN_PROPS_PALETTE.stone : TOWN_PROPS_PALETTE.stoneDark);
  const mossMat = toonOf(TOWN_PROPS_PALETTE.moss);
  const ringMat = useMemo(() => basicOf(tint, active ? 1 : 0.5), [tint, active]);
  const glowMat = useMemo(() => basicOf("#f4e3c4", active ? 0.55 : 0), [active]);

  return (
    <group {...g}>
      {/* Low stone base ring (always present — a simple flattened torus). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <torusGeometry args={[0.78, 0.1, 6, 20]} />
        <primitive object={stoneMat} attach="material" />
      </mesh>
      {active ? (
        <>
          <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
            <torusGeometry args={[0.7, 0.12, 8, 24]} />
            <primitive object={ringMat} attach="material" />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <circleGeometry args={[0.7, 20]} />
            <primitive object={glowMat} attach="material" />
          </mesh>
          <pointLight position={[0, 1.2, 0]} color={tint} intensity={0.9} distance={5} decay={2} />
        </>
      ) : (
        <>
          {/* Dormant: a dull ring + a few moss clumps, no light, no spin. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
            <torusGeometry args={[0.7, 0.1, 6, 20]} />
            <primitive object={toonOf("#5a5648")} attach="material" />
          </mesh>
          {[[-0.4, 0.3], [0.35, -0.35], [0.1, 0.5]].map(([ox, oz], i) => (
            <mesh key={i} position={[ox, 0.06, oz]}>
              <sphereGeometry args={[0.1, 6, 6]} />
              <primitive object={mossMat} attach="material" />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DECORATION PROPS
// ─────────────────────────────────────────────────────────────────────────

export interface TintableProp extends PropTransform {
  tint?: string;
}

/** A post + a warm glowing lantern top — a cheap emissive-look point of warm
 *  light using a basic-material "glass" sphere (no real light by default to
 *  keep per-lantern cost near zero; pass `lit` to add a tiny point light for
 *  a hero lantern or two, not all of them). */
export function Lantern({
  position,
  rotation,
  scale,
  tint = TOWN_PROPS_PALETTE.glowGold,
  lit = false,
}: TintableProp & { lit?: boolean }) {
  const g = useGroupProps({ position, rotation, scale });
  const glowMat = useMemo(() => basicOf(tint, 0.9), [tint]);
  return (
    <group {...g}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.035, 0.045, 0.9, 6]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.woodDark)} attach="material" />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <boxGeometry args={[0.16, 0.2, 0.16]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.woodDark)} attach="material" />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <primitive object={glowMat} attach="material" />
      </mesh>
      {lit && <pointLight position={[0, 0.92, 0]} color={tint} intensity={0.6} distance={3.2} decay={2} />}
    </group>
  );
}

/** A tileable fence segment — two posts + two rails, sized to butt up
 *  against another fence segment when placed one TILE apart. */
export function Fence({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.woodMid }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  const mat = useMemo(() => toonOf(tint), [tint]);
  return (
    <group {...g}>
      <mesh position={[-0.9, 0.3, 0]}>
        <boxGeometry args={[0.09, 0.6, 0.09]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh position={[0.9, 0.3, 0]}>
        <boxGeometry args={[0.09, 0.6, 0.09]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[1.9, 0.08, 0.06]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[1.9, 0.08, 0.06]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** A simple two-plank bench on four little legs. */
export function Bench({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.woodMid }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  const mat = useMemo(() => toonOf(tint), [tint]);
  const legPositions: [number, number][] = [
    [-0.55, -0.22],
    [0.55, -0.22],
    [-0.55, 0.22],
    [0.55, 0.22],
  ];
  return (
    <group {...g}>
      <GroundBlob radius={0.6} opacity={0.2} />
      {legPositions.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.16, z]}>
          <boxGeometry args={[0.07, 0.32, 0.07]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
      <mesh position={[0, 0.34, 0]}>
        <boxGeometry args={[1.3, 0.06, 0.5]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh position={[0, 0.58, -0.22]}>
        <boxGeometry args={[1.3, 0.4, 0.06]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** A planter box with a few little colorful blossom blobs. */
export function FlowerBed({ position, rotation, scale, tint }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  const blossomColors = [TOWN_PROPS_PALETTE.warm, "#e07a9a", "#e8e07a", TOWN_PROPS_PALETTE.bond];
  const boxMat = toonOf(tint ?? TOWN_PROPS_PALETTE.woodMid);
  const soilMat = toonOf("#5a4632");
  const spots: [number, number][] = [
    [-0.28, -0.1],
    [0.05, 0.12],
    [0.3, -0.08],
    [-0.05, -0.25],
  ];
  return (
    <group {...g}>
      <mesh position={[0, 0.13, 0]}>
        <boxGeometry args={[0.8, 0.26, 0.4]} />
        <primitive object={boxMat} attach="material" />
      </mesh>
      <mesh position={[0, 0.27, 0]}>
        <boxGeometry args={[0.74, 0.06, 0.34]} />
        <primitive object={soilMat} attach="material" />
      </mesh>
      {spots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.36, z]}>
          <sphereGeometry args={[0.09, 6, 6]} />
          <primitive object={toonOf(blossomColors[i % blossomColors.length])} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

/** A small potted plant (indoor/porch-scale version of FlowerBed). */
export function PottedPlant({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.roofClay }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  return (
    <group {...g}>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.14, 0.11, 0.24, 8]} />
        <primitive object={toonOf(tint)} attach="material" />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.17, 8, 8]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.leafDark)} attach="material" />
      </mesh>
      <mesh position={[0.08, 0.4, 0.06]}>
        <sphereGeometry args={[0.1, 6, 6]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.leafLight)} attach="material" />
      </mesh>
    </group>
  );
}

/** A rounded low-poly bush/shrub. */
export function Bush({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.leafDark }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  const mat = useMemo(() => toonOf(tint), [tint]);
  return (
    <group {...g}>
      <mesh position={[0, 0.22, 0]}>
        <sphereGeometry args={[0.28, 8, 7]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh position={[0.18, 0.16, 0.1]}>
        <sphereGeometry args={[0.18, 7, 6]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh position={[-0.16, 0.14, -0.08]}>
        <sphereGeometry args={[0.17, 7, 6]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** A wooden barrel. */
export function Barrel({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.woodMid }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  return (
    <group {...g}>
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.24, 0.22, 0.56, 10]} />
        <primitive object={toonOf(tint)} attach="material" />
      </mesh>
      <mesh position={[0, 0.28, 0]}>
        <torusGeometry args={[0.235, 0.02, 5, 12]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.woodDark)} attach="material" />
      </mesh>
    </group>
  );
}

/** A wooden crate. */
export function Crate({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.woodLight }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  return (
    <group {...g}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <primitive object={toonOf(tint)} attach="material" />
      </mesh>
    </group>
  );
}

/** A hanging cloth banner/flag — a single slightly-curved plane (no cloth
 *  sim; a static curved shape reads as "hanging fabric" cheaply). */
export function Banner({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.bond }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  return (
    <group {...g}>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.1, 6]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.woodDark)} attach="material" />
      </mesh>
      <mesh position={[0.22, 0.85, 0]} rotation={[0, 0, -0.08]}>
        <boxGeometry args={[0.4, 0.32, 0.02]} />
        <primitive object={toonOf(tint)} attach="material" />
      </mesh>
    </group>
  );
}

/** A signpost — a post + a small board. Label text is intentionally left to
 *  the Architect (avoiding drei <Text>/Html per the brief); pass nothing and
 *  you get a blank board the Architect can compose a DOM/label overlay atop,
 *  same technique town-scene.tsx already uses for its approach-hint overlay. */
export function Signpost({ position, rotation, scale, tint = TOWN_PROPS_PALETTE.woodMid }: TintableProp) {
  const g = useGroupProps({ position, rotation, scale });
  return (
    <group {...g}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.9, 6]} />
        <primitive object={toonOf(tint)} attach="material" />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[0.5, 0.3, 0.05]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.parchmentDeep)} attach="material" />
      </mesh>
    </group>
  );
}

/** A stone well — a low cylindrical wall + two posts + a little peaked roof. */
export function Well({ position, rotation, scale }: PropTransform) {
  const g = useGroupProps({ position, rotation, scale });
  return (
    <group {...g}>
      <GroundBlob radius={0.7} />
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.42, 0.44, 0.56, 12]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.stone)} attach="material" />
      </mesh>
      <mesh position={[0, 0.57, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.42, 12]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.stoneDark)} attach="material" />
      </mesh>
      {[-0.32, 0.32].map((x, i) => (
        <mesh key={i} position={[x, 0.95, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.75, 6]} />
          <primitive object={toonOf(TOWN_PROPS_PALETTE.woodMid)} attach="material" />
        </mesh>
      ))}
      <mesh position={[0, 1.32, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.55, 0.32, 4]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.roofClay)} attach="material" />
      </mesh>
    </group>
  );
}

/**
 * A subtly-textured plaza/path ground tile — replaces flat ground in walked
 * areas. Sized to exactly cover one TILE (pass `tileSize` matching the
 * scene's TILE constant, default 2.2). Uses a deterministic cobble
 * CanvasTexture (see `makeCobbleTexture`) shared across every instance via
 * `useMemo` on the module-scoped texture cache.
 */
let _cobbleTexCache: THREE.CanvasTexture | null = null;
/** Deterministic cobble/path CanvasTexture generator — same recipe pattern
 *  as town-scene.tsx's makeTownGroundTexture, built once and cached. */
export function makeCobbleTexture(): THREE.CanvasTexture {
  if (_cobbleTexCache) return _cobbleTexCache;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = TOWN_PROPS_PALETTE.stoneDark;
  ctx.fillRect(0, 0, size, size);
  let s = 7331;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
  // Cobble stones: rounded rects of varying warm-grey tones.
  for (let i = 0; i < 46; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 12;
    const shade = 0.75 + rand() * 0.3;
    const base = 140 + Math.round(shade * 30);
    ctx.fillStyle = `rgb(${base},${base - 8},${base - 20})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.8 + rand() * 0.3), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // A few moss flecks for warmth.
  for (let i = 0; i < 20; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle = "rgba(106,143,90,0.25)";
    ctx.beginPath();
    ctx.arc(x, y, 3 + rand() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _cobbleTexCache = tex;
  return tex;
}

export interface PathTileProps extends PropTransform {
  tileSize?: number;
}

/** A single cobblestone/path plaza tile-plane — drop one per walked-area
 *  grid cell in place of flat ground color to give the plaza texture. */
export function Cobblestone({ position, rotation, scale, tileSize = 2.2 }: PathTileProps) {
  const g = useGroupProps({ position, rotation, scale });
  const tex = useMemo(() => makeCobbleTexture(), []);
  const mat = useMemo(() => new THREE.MeshToonMaterial({ map: tex, color: TOWN_PROPS_PALETTE.stone }), [tex]);
  return (
    <group {...g}>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[tileSize * 0.98, tileSize * 0.98]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
/** Alias — same tile, named for the "path through grass" use case. */
export const PathTile = Cobblestone;

// ─────────────────────────────────────────────────────────────────────────
// ENVIRONMENT HELPERS
// ─────────────────────────────────────────────────────────────────────────

let _grassTexCache: THREE.CanvasTexture | null = null;
/** A warm grass-and-dirt ground texture generator (deterministic Canvas
 *  texture, same recipe family as town-scene.tsx's makeTownGroundTexture) for
 *  the plaza's non-walked/greener areas — an alternative to `makeCobbleTexture`
 *  for the Architect to pick per-area. */
export function makeGrassDirtTexture(): THREE.CanvasTexture {
  if (_grassTexCache) return _grassTexCache;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#7fae66";
  ctx.fillRect(0, 0, size, size);
  let s = 918273;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 3 + rand() * 10;
    const dirt = rand() > 0.72;
    ctx.fillStyle = dirt ? "rgba(150,110,60,0.22)" : rand() > 0.5 ? "rgba(90,150,70,0.2)" : "rgba(200,230,160,0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _grassTexCache = tex;
  return tex;
}

export interface TownLightingProps {
  /** Warm key light intensity (the "sun"). */
  keyIntensity?: number;
  /** Hemisphere fill intensity. */
  fillIntensity?: number;
}

/**
 * A cozy warm lighting rig: a hemisphere fill (soft sky/ground bounce) + a
 * warm low-intensity ambient + a warm directional key — tuned for the
 * storybook-plaza tone, alongside/instead of `GooberEnv` if the Architect
 * wants a town-specific variant. No shadows (matches `shadows={false}`).
 */
export function TownLighting({ keyIntensity = 1.25, fillIntensity = 1.0 }: TownLightingProps) {
  return (
    <>
      <hemisphereLight args={["#fff3d6", "#8a9a5a", fillIntensity]} />
      <ambientLight color="#f4e3c4" intensity={0.35} />
      <directionalLight position={[6, 14, 6]} intensity={keyIntensity} color="#ffe8b8" />
    </>
  );
}
