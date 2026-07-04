/**
 * SplashScene — the CHIMERA title-screen 3D backdrop: the Aldercradle Tree of
 * Life standing tall and hopeful, with a handful of goobers bouncing in front
 * of it. Factored out of shell/splash.tsx so the DOM overlay (title/menu/fade)
 * stays untouched while this owns its own <Canvas>.
 *
 * Mirrors GooberStage's conventions (ResponsiveFov, GooberEnv, the mottled
 * ground plane, `getQuality().dprCap`) rather than reusing GooberStage itself,
 * since the tree needs to sit in the scene alongside goobers rather than as a
 * `Placed` item (GooberStage only knows how to place Goober meshes).
 *
 * Perf: one tree (a fixed-geometry prop, memoized) + a few goobers (specs
 * memoized via goober-cache's specForSeed so meshes build once) — comfortably
 * inside the "one hero stage" mobile budget the rest of the game already
 * assumes.
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GooberSpec } from "game-kit/creature";
import { Goober } from "./Goober.js";
import { AldercradleTreeProp } from "./town-props.js";
import { ContactBlob, GooberEnv, STAGE_PALETTE } from "./env.js";
import { ResponsiveFov } from "./responsive-cam.js";
import { getQuality, getReducedMotion } from "./quality.js";
import { specForSeed } from "./goober-cache.js";

// Same mottled-meadow ground recipe GooberStage uses, inlined here so this
// scene stays a self-contained sibling rather than reaching into GooberStage's
// module-private helper.
function makeSplashGroundTexture(ground: string): THREE.CanvasTexture {
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

// The seeds behind the 4 bouncing goobers — distinct tokens so each reads as a
// different creature (not just re-tinted clones). Purely decorative: never
// touches game state or the starter roster.
const SPLASH_BOUNCE_SEEDS = ["splash-bounce-1", "splash-bounce-2", "splash-bounce-3", "splash-bounce-4"];

// Where each bouncer stands, front-and-below the tree (tree is centered at
// z=0; goobers are pulled forward toward camera and fanned out in x so all 4
// read clearly without overlapping the trunk). Kept a plain array (not
// randomized) so the splash framing is stable/reproducible run to run.
const BOUNCE_LAYOUT: Array<{ position: [number, number, number]; facing: number; sizeScale: number }> = [
  { position: [-2.2, 0, 3.6], facing: 0.4, sizeScale: 0.85 },
  { position: [-0.7, 0, 4.4], facing: -0.15, sizeScale: 0.95 },
  { position: [0.9, 0, 4.2], facing: 0.2, sizeScale: 0.8 },
  { position: [2.3, 0, 3.5], facing: -0.4, sizeScale: 0.9 },
];

// Bounce tuning — noticeably springier than Goober's own idle bob (which tops
// out around ±0.08 world units). A per-goober phase offset (derived from
// index) keeps the four hops out of lockstep.
const BOUNCE_HEIGHT = 0.55;
const BOUNCE_SPEED = 2.1;

/**
 * Wraps a single bouncing goober in its own animated group — Goober's built-in
 * idle bob is a subtle breathe/sway, too gentle for a "bouncing in front of
 * the tree of life" splash moment, so this layers a pronounced eased vertical
 * hop on top via a dedicated group transform (Goober's own internal transform
 * is untouched). Reduced-motion holds the group still at rest height.
 */
function BouncingGoober({
  spec,
  position,
  facing,
  sizeScale,
  phase,
}: {
  spec: GooberSpec;
  position: [number, number, number];
  facing: number;
  sizeScale: number;
  phase: number;
}) {
  const group = useRef<THREE.Group>(null);
  const reducedMotion = getReducedMotion();

  useFrame((state) => {
    if (!group.current || reducedMotion) return;
    // abs(sin) gives a springy "hop, land, hop" cadence rather than a smooth
    // up-down sine drift — reads as bouncing, not floating.
    const t = state.clock.elapsedTime * BOUNCE_SPEED + phase;
    const hop = Math.abs(Math.sin(t)) * BOUNCE_HEIGHT;
    group.current.position.y = hop;
    // A touch of squash on landing (low hop) / stretch at the peak, cheap
    // life-in-the-drawing sell for the bounce.
    const squash = 1 - Math.max(0, 0.18 - hop) * 0.9;
    group.current.scale.set(1 / squash, squash, 1 / squash);
  });

  return (
    <group ref={group}>
      <Goober spec={spec} position={position} facing={facing} sizeScale={sizeScale} seed={phase * 17} />
    </group>
  );
}

export interface SplashSceneProps {
  /** Tree bloom stage 0..1 — defaults to a lush, hopeful ~0.75 (full green
   *  crown, just shy of golden-bloom) so the splash reads as "worth weaving
   *  back to life" rather than either bare-winter or already-saved. */
  treeStage?: number;
}

/**
 * The splash's 3D backdrop: Aldercradle's Tree of Life as the hero (tall,
 * centered, set back), with a few goobers bouncing in front of it. Its own
 * fixed-camera `<Canvas>` (no orbit), matching GooberStage's stage conventions
 * so it reads as "the same warm world" as every other scene.
 */
export function SplashScene({ treeStage = 0.75 }: SplashSceneProps) {
  const groundTex = useMemo(() => makeSplashGroundTexture("#cfe6a8"), []);
  const bounceSpecs = useMemo(() => SPLASH_BOUNCE_SEEDS.map((seed) => specForSeed(seed)), []);

  return (
    <Canvas className="stage" camera={{ position: [0, 4.6, 12.5], fov: 28 }} shadows={false} dpr={[1, getQuality().dprCap]}>
      <ResponsiveFov baseFov={28} />
      <color attach="background" args={["#f0dcb8"]} />
      <GooberEnv palette={STAGE_PALETTE} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshToonMaterial map={groundTex} />
      </mesh>

      {/* The hero: Aldercradle's Tree of Life, tall + centered + set back. */}
      <AldercradleTreeProp stage={treeStage} position={[0, 0, -1.4]} scale={2.1} />

      {/* A few goobers bouncing in front of / below the tree. */}
      {BOUNCE_LAYOUT.map((b, i) => (
        <group key={SPLASH_BOUNCE_SEEDS[i]}>
          <ContactBlob position={[b.position[0], 0, b.position[2]]} radius={0.8 * b.sizeScale} />
          <BouncingGoober
            spec={bounceSpecs[i]}
            position={b.position}
            facing={b.facing}
            sizeScale={b.sizeScale}
            phase={i * 1.4}
          />
        </group>
      ))}
    </Canvas>
  );
}
