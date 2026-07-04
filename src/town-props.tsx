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

const TREE_WITHERED = "#8a7a5a";
const TREE_BUDDING = "#9db56a";
const TREE_LUSH = "#5fae5a";
const TREE_BLOOM = "#e7c86a";

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
  canopyColor: string;
  trunkColor: string;
  canopyScale: number;
  canopyOpacity: number;
  glowOpacity: number;
  lightIntensity: number;
}

function stageFor(t01: number): TreeStage {
  const t = Math.max(0, Math.min(1, t01));
  const canopyColor =
    t < 0.5 ? lerpColor(TREE_WITHERED, TREE_BUDDING, t / 0.5) : lerpColor(TREE_LUSH, TREE_BLOOM, (t - 0.5) / 0.5);
  const trunkColor = lerpColor("#6b5638", "#8a6a3f", t);
  return {
    canopyColor,
    trunkColor,
    canopyScale: 0.55 + t * 0.65,
    canopyOpacity: 0.55 + t * 0.45,
    glowOpacity: t * 0.5,
    lightIntensity: t * 1.4,
  };
}

const CANOPY_BALLS: Array<[number, number, number, number]> = [
  [0, 0, 0, 1.0],
  [0.5, 0.18, 0.3, 0.72],
  [-0.5, 0.12, -0.25, 0.7],
  [0.15, 0.42, -0.4, 0.6],
  [-0.3, 0.38, 0.35, 0.62],
  [0, -0.15, 0.5, 0.58],
];

export interface AldercradleTreeProps extends PropTransform {
  /** Bloom progress 0..1 — bare/withered/grey at 0, full green mid-way,
   *  golden-blossomed with a warm glow + point light at 1. Defaults to a
   *  fully-bloomed tree so the prop looks good with zero required props. */
  stage?: number;
}

/**
 * The Aldercradle world-tree as a standalone, reusable prop: a tapered trunk
 * + a small FIXED cluster of layered canopy balls (never regenerated —
 * `useMemo` keyed only on `stage` recomputes color/scale/opacity, not
 * geometry) plus a soft golden glow + point light once blooming starts.
 * Cheap and static, matching town-scene.tsx's existing AldercradleTree.
 */
export function AldercradleTreeProp({ stage = 1, position, rotation, scale }: AldercradleTreeProps) {
  const g = useGroupProps({ position, rotation, scale });
  const s = useMemo(() => stageFor(stage), [stage]);
  const canopyY = 1.15;
  const trunkMat = useMemo(() => toonOf(s.trunkColor), [s.trunkColor]);
  const canopyMat = useMemo(
    () => toonOf(s.canopyColor, { transparent: true, opacity: s.canopyOpacity }),
    [s.canopyColor, s.canopyOpacity],
  );
  return (
    <group {...g}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.62, 0.72, 0.16, 10]} />
        <primitive object={toonOf(TOWN_PROPS_PALETTE.woodLight)} attach="material" />
      </mesh>
      <mesh position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 1.1, 8]} />
        <primitive object={trunkMat} attach="material" />
      </mesh>
      {CANOPY_BALLS.map(([ox, oy, oz, baseR], i) => (
        <mesh key={i} position={[ox * s.canopyScale, canopyY + oy * s.canopyScale, oz * s.canopyScale]}>
          <sphereGeometry args={[baseR * s.canopyScale * 0.62, 8, 8]} />
          <primitive object={canopyMat} attach="material" />
        </mesh>
      ))}
      {s.glowOpacity > 0 && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.3, 20]} />
          <primitive object={basicOf(TREE_BLOOM, s.glowOpacity)} attach="material" />
        </mesh>
      )}
      {s.lightIntensity > 0 && (
        <pointLight position={[0, 1.6, 0]} color={TREE_BLOOM} intensity={s.lightIntensity} distance={6} decay={2} />
      )}
    </group>
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
