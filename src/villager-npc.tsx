/**
 * villager-npc — distinct, cel-shaded TOWNSFOLK figures for the TOWN plaza,
 * replacing the old tinted-Goober-blob villager rendering (town-scene.tsx's
 * `Actor`, the exact same billboarded blob shape as wild monsters — no visual
 * cue that these were PEOPLE you could talk to).
 *
 * A `Villager` reads, at a glance and from the town's angled top-down camera,
 * as: rounded body/torso + head + simple arms + a ROLE-flavoured clothing
 * silhouette (apron+cap / robe+book / shawl / cloak / vest) — a person, not a
 * blob. Same warm DQM/Ghibli cel-shaded tone as the rest of town-props.tsx
 * (`meshToonMaterial`, low segment counts, shared module-level materials).
 *
 * PERF (mobile budget — up to 6 villagers on screen alongside the plaza
 * props): every material is a shared module-level `MeshToonMaterial`/
 * `MeshBasicMaterial` singleton keyed by color (mirrors town-props.tsx's
 * `toonOf`/`basicOf` caches — re-derived locally here rather than importing
 * town-props.tsx, matching this codebase's existing "small shared recipes
 * re-derived per file" convention). Geometry is built once via `useMemo`
 * (no per-frame allocation) — the only per-frame cost is a single cheap
 * sin() idle-bob/sway per villager, skipped entirely under
 * `getReducedMotion()`. Segment counts are low (5-8) throughout.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getReducedMotion } from "./quality.js";
import type { VillagerRole } from "./town.js";

// ─────────────────────────────────────────────────────────────────────────
// Shared materials — module-level singletons, keyed by color, so N mounted
// villagers reuse the same GPU material rather than each allocating its own.
// ─────────────────────────────────────────────────────────────────────────
const sharedToon = new Map<string, THREE.MeshToonMaterial>();
function toonOf(color: string): THREE.MeshToonMaterial {
  let mat = sharedToon.get(color);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({ color });
    sharedToon.set(color, mat);
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

// Warm, storybook skin/hair tones — kept small + reused across every
// villager regardless of role tint (only clothing carries the role tint).
const SKIN = "#e8b98a";
const HAIR = "#6b4a30";
const INK = "#2b2440";

/** Cheap flat "grounding" disc under the villager's feet — same fake-AO
 *  trick town-props.tsx's GroundBlob uses, re-derived locally. */
function GroundBlob({ radius = 0.36 }: { radius?: number }) {
  return (
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <circleGeometry args={[radius, 12]} />
      <primitive object={basicOf("#20201a", 0.26)} attach="material" />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Per-role look — clothing color + which accessory silhouette to add, so
// each of the town's six roles reads as a distinct individual rather than a
// palette-swapped clone.
// ─────────────────────────────────────────────────────────────────────────
type Accessory = "cap" | "book" | "shawl" | "cloak" | "apron-shawl" | "vest";

interface RoleLook {
  clothing: string;
  clothingDeep: string;
  accessory: Accessory;
  accentColor: string;
}

const ROLE_LOOK: Record<VillagerRole, RoleLook> = {
  // Cradle-Keeper — a gentle warden: soft apron/shawl over a long robe.
  keeper: { clothing: "#c9a4d9", clothingDeep: "#a97fc0", accessory: "apron-shawl", accentColor: "#f7efe2" },
  // Shopkeeper — brisk peddler: apron + a little cap.
  shopkeeper: { clothing: "#e8a84c", clothingDeep: "#c9762e", accessory: "cap", accentColor: "#f7efe2" },
  // Loremaster — a scholar: a robe + a carried book.
  loremaster: { clothing: "#7fa0c9", clothingDeep: "#5c7fac", accessory: "book", accentColor: "#e8dcb8" },
  // Quartermaster — practical outfitter: a sturdy vest.
  quartermaster: { clothing: "#8a9a6a", clothingDeep: "#697849", accessory: "vest", accentColor: "#c9a75a" },
  // Questgiver — a shawled elder.
  questgiver: { clothing: "#b08a6b", clothingDeep: "#8a684e", accessory: "shawl", accentColor: "#e8a84c" },
  // Storyteller — a travel cloak, road-worn.
  storyteller: { clothing: "#6b7a9a", clothingDeep: "#4f5c78", accessory: "cloak", accentColor: "#e07a9a" },
};

export interface VillagerProps {
  role: VillagerRole;
  /** A soft per-villager tint override for the clothing (falls back to the
   *  role's default look so every keeper/shopkeeper/etc. isn't identical). */
  tint?: string;
  position?: [number, number, number];
  /** Y-axis facing in radians — 0 faces +z (toward the camera/plaza), matching
   *  town-scene.tsx's worldOf/camera convention (no facing input currently
   *  varies villagers, but the prop exists for future-proofing/symmetry). */
  facing?: number;
  scale?: number;
}

/** Body proportions shared by every role — built once as plain numbers (no
 *  geometry allocation cost since primitive Three.js geometries are cheap
 *  and JSX-declarative here, matching town-props.tsx's own style). */
const BODY_H = 0.46;
const HEAD_R = 0.16;
const LEG_H = 0.16;

/**
 * A low-poly, cel-shaded villager: rounded torso + head + two simple arms +
 * legs stub + role-flavoured clothing accessory. Reads as a PERSON silhouette
 * from the angled top-down town camera — distinct from the wild Goober blobs.
 * Idle bob/sway is a single cheap sin() per frame, skipped under
 * getReducedMotion(). Static geometry, shared materials — cheap enough for 6+
 * on screen alongside the plaza props.
 */
export function Villager({ role, tint, position = [0, 0, 0], facing = 0, scale = 1 }: VillagerProps) {
  const look = ROLE_LOOK[role];
  const clothColor = tint ?? look.clothing;
  const clothDeepColor = look.clothingDeep;

  const skinMat = useMemo(() => toonOf(SKIN), []);
  const hairMat = useMemo(() => toonOf(HAIR), []);
  const clothMat = useMemo(() => toonOf(clothColor), [clothColor]);
  const clothDeepMat = useMemo(() => toonOf(clothDeepColor), [clothDeepColor]);
  const accentMat = useMemo(() => toonOf(look.accentColor), [look.accentColor]);
  const inkMat = useMemo(() => toonOf(INK), []);

  const bobRef = useRef<THREE.Group>(null);
  const reduced = useRef(getReducedMotion());
  // Per-instance phase so 6 villagers don't bob in lockstep (derived from the
  // role name's char codes — deterministic, no Math.random() at mount).
  const phase = useMemo(
    () => [...role].reduce((acc, c) => acc + c.charCodeAt(0), 0) % (Math.PI * 2),
    [role],
  );

  useFrame((state) => {
    if (reduced.current || !bobRef.current) return;
    const t = state.clock.elapsedTime;
    bobRef.current.position.y = Math.sin(t * 1.1 + phase) * 0.035;
    bobRef.current.rotation.z = Math.sin(t * 0.8 + phase) * 0.025;
  });

  return (
    <group position={position} rotation={[0, facing, 0]} scale={scale}>
      <GroundBlob radius={0.34} />
      <group ref={bobRef} position={[0, LEG_H, 0]}>
        {/* Legs — a single squat cylinder reads as "standing figure" at this
            camera distance; no need for two separate leg meshes. */}
        <mesh position={[0, LEG_H * 0.35, 0]}>
          <cylinderGeometry args={[0.12, 0.14, LEG_H * 0.7, 7]} />
          <primitive object={clothDeepMat} attach="material" />
        </mesh>

        {/* Torso — a rounded capsule-like body via a stretched sphere reads
            softer/friendlier than a hard box (Ghibli-warm, not blocky). */}
        <mesh position={[0, LEG_H * 0.7 + BODY_H * 0.5, 0]} scale={[1, 1.15, 0.85]}>
          <sphereGeometry args={[0.22, 8, 7]} />
          <primitive object={clothMat} attach="material" />
        </mesh>

        {/* Head. */}
        <mesh position={[0, LEG_H * 0.7 + BODY_H + HEAD_R * 0.95, 0]}>
          <sphereGeometry args={[HEAD_R, 9, 8]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        {/* A simple hair cap on the head (kept under any accessory hat). */}
        <mesh position={[0, LEG_H * 0.7 + BODY_H + HEAD_R * 1.35, 0]} scale={[1, 0.6, 1]}>
          <sphereGeometry args={[HEAD_R * 0.95, 8, 6]} />
          <primitive object={hairMat} attach="material" />
        </mesh>

        {/* Simple arms — two short cylinders angled slightly outward, giving
            a clear "person with limbs" read without per-joint articulation. */}
        <mesh
          position={[-0.27, LEG_H * 0.7 + BODY_H * 0.62, 0.02]}
          rotation={[0, 0, Math.PI / 10]}
        >
          <cylinderGeometry args={[0.055, 0.05, 0.3, 6]} />
          <primitive object={clothMat} attach="material" />
        </mesh>
        <mesh
          position={[0.27, LEG_H * 0.7 + BODY_H * 0.62, 0.02]}
          rotation={[0, 0, -Math.PI / 10]}
        >
          <cylinderGeometry args={[0.055, 0.05, 0.3, 6]} />
          <primitive object={clothMat} attach="material" />
        </mesh>

        <RoleAccessory
          accessory={look.accessory}
          clothDeepMat={clothDeepMat}
          accentMat={accentMat}
          inkMat={inkMat}
        />
      </group>
    </group>
  );
}

/** The clothing/accessory silhouette that makes each role distinct — sits on
 *  top of the shared body built above. Every branch is a handful of cheap
 *  primitives sharing the passed-in materials (no new material allocation). */
function RoleAccessory({
  accessory,
  clothDeepMat,
  accentMat,
  inkMat,
}: {
  accessory: Accessory;
  clothDeepMat: THREE.MeshToonMaterial;
  accentMat: THREE.MeshToonMaterial;
  inkMat: THREE.MeshToonMaterial;
}) {
  const torsoY = LEG_H * 0.7 + BODY_H * 0.5;
  const headTopY = LEG_H * 0.7 + BODY_H + HEAD_R * 1.75;

  switch (accessory) {
    case "cap":
      // Shopkeeper: a little rounded cap on the head.
      return (
        <mesh position={[0, headTopY, 0]}>
          <coneGeometry args={[HEAD_R * 0.85, 0.14, 8]} />
          <primitive object={clothDeepMat} attach="material" />
        </mesh>
      );

    case "book":
      // Loremaster: a small carried book held at chest height, plus a
      // scholarly hood-back accent so the robe reads as "learned".
      return (
        <>
          <mesh position={[0.24, torsoY + 0.02, 0.16]} rotation={[0.2, 0.3, 0]}>
            <boxGeometry args={[0.16, 0.2, 0.04]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
          <mesh position={[0.24, torsoY + 0.02, 0.185]} rotation={[0.2, 0.3, 0]}>
            <boxGeometry args={[0.1, 0.13, 0.01]} />
            <primitive object={inkMat} attach="material" />
          </mesh>
          <mesh position={[0, torsoY + BODY_H * 0.42, -0.04]} scale={[1.05, 0.7, 1.05]}>
            <sphereGeometry args={[0.2, 8, 6]} />
            <primitive object={clothDeepMat} attach="material" />
          </mesh>
        </>
      );

    case "shawl":
      // Questgiver: an elder's shawl draped over the shoulders.
      return (
        <mesh position={[0, torsoY + BODY_H * 0.36, -0.02]} rotation={[0.15, 0, 0]} scale={[1.1, 0.55, 1.05]}>
          <sphereGeometry args={[0.23, 8, 6]} />
          <primitive object={accentMat} attach="material" />
        </mesh>
      );

    case "cloak":
      // Storyteller: a long travel cloak flaring down the back.
      return (
        <mesh position={[0, torsoY - 0.02, -0.12]} scale={[1, 1.3, 0.5]}>
          <sphereGeometry args={[0.24, 8, 7]} />
          <primitive object={clothDeepMat} attach="material" />
        </mesh>
      );

    case "apron-shawl":
      // Cradle-Keeper: a gentle apron down the front + a soft shawl tie.
      return (
        <>
          <mesh position={[0, torsoY - 0.08, 0.17]} scale={[0.72, 0.85, 0.3]}>
            <sphereGeometry args={[0.2, 8, 6]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
          <mesh position={[0, torsoY + BODY_H * 0.3, 0]} scale={[1.05, 0.4, 1.05]}>
            <sphereGeometry args={[0.22, 8, 6]} />
            <primitive object={clothDeepMat} attach="material" />
          </mesh>
        </>
      );

    case "vest":
      // Quartermaster: a sturdy sleeveless vest with a buckle accent.
      return (
        <>
          <mesh position={[0, torsoY, 0.02]} scale={[1.02, 1.0, 0.7]}>
            <sphereGeometry args={[0.225, 8, 7]} />
            <primitive object={clothDeepMat} attach="material" />
          </mesh>
          <mesh position={[0, torsoY - 0.06, 0.19]}>
            <boxGeometry args={[0.08, 0.08, 0.02]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
        </>
      );

    default:
      return null;
  }
}
