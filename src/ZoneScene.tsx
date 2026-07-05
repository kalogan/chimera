/**
 * ZoneScene — CHIMERA's walkable 2.5D overworld (Wave 2, per-zone themed in
 * Wave 5). An angled top-down "HD-2D" camera follows the player across a tile
 * grid; goobers are billboarded (always facing the camera) and hop between
 * tiles. Pure render of a `world-runtime` ZoneState — movement is authored by
 * the reducer, the view only tweens toward the current tile positions. Input
 * lives in App (it owns state). The zone's own `descriptor.id` picks its
 * `ZoneTheme` (env palette + ground/wall/grass tint) so Meadowmere/Emberdeep/
 * Tidewrack each read as a distinct place, not a recolored copy.
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { FollowCam, WalkActor } from "game-kit/walk-view/r3f";
import { type GooberSpec } from "game-kit/creature";
import type { ZoneState } from "game-kit/world-runtime";
import { Goober, gooberGroundLift } from "./Goober.js";
import { specForToken } from "./goober-cache.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality } from "./quality.js";
import {
  ContactBlob,
  GooberEnv,
  ZONE_PALETTE,
  EMBERDEEP_PALETTE,
  TIDEWRACK_PALETTE,
  SKYREACH_PALETTE,
  OOZEHOLLOW_PALETTE,
  VERDANTHUSH_PALETTE,
  STONEWAKE_PALETTE,
  HOLLOWVALE_PALETTE,
  type EnvPalette,
} from "./env.js";
import type { PlacedRival } from "./rivals.js";

const TILE = 2.2;
// Camera offset from the player: up/back chosen for ~52° downward (angled top-down
// HD-2D) while framing several tiles around the player. atan2(18,14) ≈ 52°.
const CAM_UP = 18;
const CAM_BACK = 14;
const CAM_FOV = 40;
const HOP_H = 0.42;
// Overworld goobers are tile-sized, much smaller than the battle-stage lineup.
const GOOBER_SIZE = 0.34;
// The angled top-down camera (~52° above horizontal) looks down onto a goober's
// top dome, so its front-facing (+Z, horizontal) eyes hide below the bulge. Tip
// the whole goober's face UP toward the camera by this much (~28°) so the eyes
// read from the overworld angle. Applied in the goober's LOCAL frame (under the
// facing yaw), so the face always tilts "up along its heading" regardless of
// which way it's walking. Battle/Dex/splash cameras are near head-on and need none.
const FACE_PITCH = 0.4;
// Push overworld goober eyes forward+up so they protrude from the body and read
// from the steep top-down camera (deep-set eyes otherwise hide under the dome).
const EYE_BULGE = 0.5;
// walk-view (the shared kit module) drives the follow-cam + tile-hop + facing.
// These CHIMERA constants feed its config so the two stay coupled; the rest of
// the tuning (lerps, look height, deadzone) matches the kit defaults.
const WALK_CFG = { tile: TILE, camUp: CAM_UP, camBack: CAM_BACK, hopHeight: HOP_H };

function worldOf(x: number, y: number, w: number, h: number): [number, number, number] {
  return [(x - (w - 1) / 2) * TILE, 0, (y - (h - 1) / 2) * TILE];
}

/** Per-zone "look": env palette + the tile colors Terrain paints with. */
interface ZoneTheme {
  palette: EnvPalette;
  bg: string;
  groundBase: string;
  groundSpots: [string, string];
  wall: string;
  grassFloor: string;
  grassBlade: string;
}

const MEADOWMERE_THEME: ZoneTheme = {
  palette: ZONE_PALETTE,
  bg: "#bfe6f2",
  groundBase: "#8ec96a",
  groundSpots: ["rgba(70,120,60,0.16)", "rgba(190,230,150,0.14)"],
  wall: "#5f8a4c",
  grassFloor: "#6fae52",
  grassBlade: "#4f9440",
};

// Emberdeep — hot cavern floor, dark basalt walls, ember-vents instead of grass.
const EMBERDEEP_THEME: ZoneTheme = {
  palette: EMBERDEEP_PALETTE,
  bg: "#2a1712",
  groundBase: "#5a3324",
  groundSpots: ["rgba(20,10,8,0.28)", "rgba(255,140,60,0.16)"],
  wall: "#3a241c",
  grassFloor: "#7a3a22",
  grassBlade: "#ff8a3d",
};

// Tidewrack — wet sand floor, weathered rock walls, tide-pools instead of grass.
const TIDEWRACK_THEME: ZoneTheme = {
  palette: TIDEWRACK_PALETTE,
  bg: "#bfe9e6",
  groundBase: "#d8c99a",
  groundSpots: ["rgba(90,110,90,0.16)", "rgba(220,240,235,0.18)"],
  wall: "#5a6b6a",
  grassFloor: "#3fa79c",
  grassBlade: "#bff0e6",
};

// Skyreach — pale wind-swept cloud-stone floor, bright airy cliff walls,
// updraft-vents (the encounter tile) instead of grass.
const SKYREACH_THEME: ZoneTheme = {
  palette: SKYREACH_PALETTE,
  bg: "#eaf6ff",
  groundBase: "#dfe9ee",
  groundSpots: ["rgba(150,180,200,0.14)", "rgba(255,255,255,0.22)"],
  wall: "#a8c0d0",
  grassFloor: "#bcdaf0",
  grassBlade: "#f4faff",
};

// Ooze Hollow — damp mossy floor, soft rounded wall stone, ooze-pools instead
// of grass — a hushed, tucked-away hollow, not a grand vista.
const OOZEHOLLOW_THEME: ZoneTheme = {
  palette: OOZEHOLLOW_PALETTE,
  bg: "#cbd9a8",
  groundBase: "#8a9a6a",
  groundSpots: ["rgba(60,80,50,0.2)", "rgba(210,230,170,0.18)"],
  wall: "#5f7048",
  grassFloor: "#7fae5a",
  grassBlade: "#c9dc7f",
};

// Verdant Hush — mossy woodland floor, hedge-green walls, bloom-patches
// instead of grass — a deep, lush, growing home.
const VERDANTHUSH_THEME: ZoneTheme = {
  palette: VERDANTHUSH_PALETTE,
  bg: "#cdeec0",
  groundBase: "#4f7a3f",
  groundSpots: ["rgba(30,60,20,0.2)", "rgba(200,235,150,0.18)"],
  wall: "#3f6a34",
  grassFloor: "#8fc95f",
  grassBlade: "#eaffb8",
};

// Stonewake — worn rock floor, old-stone walls, rubble-vents instead of
// grass — a patient, mountainous, amber-lit home.
const STONEWAKE_THEME: ZoneTheme = {
  palette: STONEWAKE_PALETTE,
  bg: "#e8d3a8",
  groundBase: "#8a7355",
  groundSpots: ["rgba(60,45,30,0.22)", "rgba(230,200,150,0.18)"],
  wall: "#6b5a44",
  grassFloor: "#a9885f",
  grassBlade: "#ffd9a0",
};

// The Hollow Vale — violet-shadowed floor, dusk-stone walls, will-o-wisps
// instead of grass — the dimmest, most twilight-otherworldly of the 8.
const HOLLOWVALE_THEME: ZoneTheme = {
  palette: HOLLOWVALE_PALETTE,
  bg: "#4a3a5e",
  groundBase: "#3a2e4a",
  groundSpots: ["rgba(15,10,25,0.3)", "rgba(180,160,220,0.18)"],
  wall: "#2a2038",
  grassFloor: "#5a4a70",
  grassBlade: "#cfc0ef",
};

// One theme per zone.ts's ZONE_IDS entry (verified by inspection — this
// headless-tested repo can't import this .tsx file from a vitest suite since
// it pulls in three/@react-three/fiber; see difficulty-ramp.test.ts's note).
const ZONE_THEMES: Record<string, ZoneTheme> = {
  meadowmere: MEADOWMERE_THEME,
  skyreach: SKYREACH_THEME,
  tidewrack: TIDEWRACK_THEME,
  oozehollow: OOZEHOLLOW_THEME,
  verdanthush: VERDANTHUSH_THEME,
  emberdeep: EMBERDEEP_THEME,
  stonewake: STONEWAKE_THEME,
  hollowvale: HOLLOWVALE_THEME,
};

function themeFor(zoneId: string): ZoneTheme {
  return ZONE_THEMES[zoneId] ?? MEADOWMERE_THEME;
}

// Ground mottling: a small tileable canvas of soft irregular blotches, layered
// over the flat toon base color so the ground reads as textured terrain
// rather than a pool table. Deterministic (fixed seed) — built once per
// theme, no Math.random in render.
function makeGroundTexture(theme: ZoneTheme): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = theme.groundBase;
  ctx.fillRect(0, 0, size, size);
  let s = 1337;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 14;
    const dark = rand() > 0.5;
    ctx.fillStyle = dark ? theme.groundSpots[0] : theme.groundSpots[1];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * A slowly-spinning ring + colored disc under a rival goober — reads as
 * "trainer, not wild" at a glance (distinct from the soft dark `ContactBlob`
 * every wild roamer/player gets). Ground-hugging, so it doesn't fight the
 * billboarded sprite above it for read clarity.
 */
function RivalMarker({ color = "#e97b4f" }: { color?: string }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.6;
  });
  return (
    <group position={[0, 0.03, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[GOOBER_SIZE * 1.9, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[GOOBER_SIZE * 1.9, GOOBER_SIZE * 2.15, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A goober placed on the walkable grid via the kit's <WalkActor> (which owns the
 *  tween + tile-hop + facing). This wrapper owns the goober LOOK:
 *   - lifted `gooberGroundLift` so the low-packed body rests above the grass
 *     (the ContactBlob shadow, a WalkActor child, stays on the ground);
 *   - `FACE_PITCH` + `eyeBulge` so the eyes read from the steep overworld camera.
 *  The PLAYER passes `directional` (its front leads the walk — down = full face
 *  toward camera, up = its back); wild roamers/rivals billboard (always meet the
 *  camera's eye). */
function Actor({
  spec,
  tx,
  ty,
  w,
  h,
  seed,
  posOut,
  rival,
  directional,
}: {
  spec: GooberSpec;
  tx: number;
  ty: number;
  w: number;
  h: number;
  seed: number;
  posOut?: React.MutableRefObject<THREE.Vector3>;
  /** When set, renders the "trainer, not wild" ring marker instead of a ContactBlob. */
  rival?: boolean;
  /** When set, the goober faces its walk direction instead of billboarding (the player). */
  directional?: boolean;
}) {
  const lift = useMemo(() => gooberGroundLift(spec, GOOBER_SIZE), [spec]);
  return (
    <WalkActor
      tileX={tx}
      tileY={ty}
      width={w}
      height={h}
      config={WALK_CFG}
      facing={directional ? "directional" : "billboard"}
      posOut={posOut}
    >
      {rival ? <RivalMarker /> : <ContactBlob position={[0, 0, 0]} radius={GOOBER_SIZE * 1.6} />}
      <group position={[0, lift, 0]} rotation={[-FACE_PITCH, 0, 0]}>
        <Goober spec={spec} position={[0, 0, 0]} seed={seed} sizeScale={GOOBER_SIZE} eyeBulge={EYE_BULGE} />
      </group>
    </WalkActor>
  );
}

/** Static tile geometry: walls, the encounter-tile dressing, the portal pad, the ground. */
function Terrain({ zone, theme }: { zone: ZoneState; theme: ZoneTheme }) {
  const { width: w, height: h, tiles } = zone.descriptor;
  const groundTex = useMemo(() => {
    const tex = makeGroundTexture(theme);
    tex.repeat.set((w * TILE) / 6, (h * TILE) / 6);
    return tex;
  }, [w, h, theme]);
  const cells = useMemo(() => {
    const out: React.ReactElement[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      const [wx, , wz] = worldOf(x, y, w, h);
      const kind = tiles[i];
      if (kind === "wall") {
        out.push(
          <mesh key={i} position={[wx, 0.7, wz]} castShadow={false}>
            <boxGeometry args={[TILE * 0.98, 1.4, TILE * 0.98]} />
            <meshToonMaterial color={theme.wall} />
          </mesh>,
        );
      } else if (kind === "grass") {
        out.push(
          <group key={i} position={[wx, 0, wz]}>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[TILE, TILE]} />
              <meshToonMaterial color={theme.grassFloor} />
            </mesh>
            {[-0.5, 0.2, 0.6].map((ox, k) => (
              <mesh key={k} position={[ox, 0.32, (k - 1) * 0.5]}>
                <coneGeometry args={[0.22, 0.7, 5]} />
                <meshToonMaterial color={theme.grassBlade} />
              </mesh>
            ))}
          </group>,
        );
      } else if (kind === "portal") {
        out.push(
          <group key={i} position={[wx, 0.06, wz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.7, 0.14, 12, 28]} />
              <meshBasicMaterial color="#e7c86a" />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
              <circleGeometry args={[0.7, 24]} />
              <meshBasicMaterial color="#f4e3c4" transparent opacity={0.55} />
            </mesh>
          </group>,
        );
      }
    }
    return out;
  }, [zone.descriptor, w, h, tiles, theme]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[w * TILE + 8, h * TILE + 8]} />
        <meshToonMaterial map={groundTex} />
      </mesh>
      {cells}
    </>
  );
}

export function ZoneScene({
  zone,
  playerSpec,
  rivals = [],
}: {
  zone: ZoneState;
  playerSpec: GooberSpec;
  /** In-zone rivals to render as distinct "trainer" goobers (see `RivalMarker`). */
  rivals?: PlacedRival[];
}) {
  const playerPos = useRef(new THREE.Vector3());
  const { width: w, height: h } = zone.descriptor;
  const [spawnX, , spawnZ] = worldOf(zone.player.x, zone.player.y, w, h);
  const theme = themeFor(zone.descriptor.id);

  return (
    <Canvas
      className="stage"
      shadows={false}
      dpr={[1, getQuality().dprCap]}
      camera={{ position: [spawnX, CAM_UP, spawnZ + CAM_BACK], fov: CAM_FOV }}
    >
      <color attach="background" args={[theme.bg]} />
      <ResponsiveFov baseFov={CAM_FOV} maxFov={54} />
      <GooberEnv palette={theme.palette} />
      <FollowCam target={playerPos} config={WALK_CFG} />
      <Terrain zone={zone} theme={theme} />
      <Actor
        spec={playerSpec}
        tx={zone.player.x}
        ty={zone.player.y}
        w={w}
        h={h}
        seed={99}
        posOut={playerPos}
        directional
      />
      {zone.roamers.map((r) => (
        <Actor
          key={r.id}
          spec={specForToken(r.token)}
          tx={r.x}
          ty={r.y}
          w={w}
          h={h}
          seed={r.id.charCodeAt(r.id.length - 1) * 7}
        />
      ))}
      {rivals.map(({ rival, placement }) => {
        const lead = rival.roster.party[0];
        if (!lead) return null;
        return (
          <Actor
            key={rival.id}
            spec={specForToken(lead)}
            tx={placement.x}
            ty={placement.y}
            w={w}
            h={h}
            seed={rival.id.charCodeAt(rival.id.length - 1) * 13 + 5}
            rival
          />
        );
      })}
    </Canvas>
  );
}
