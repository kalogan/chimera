/**
 * villager-npc — the TOWN plaza's townsfolk, rendered as GOOBERS (the game's own
 * creatures) rather than little people. There are no humans in CHIMERA; a
 * villager is a soft two-lobe goober blob with the game's signature big cel-
 * shaded eyes, made recognizable as an individual by (a) a per-role body tint
 * and (b) a distinguishing worn accessory — a cap, a gown, spectacles, a hood,
 * a cloak, a satchel. So they read, at a glance from the town's angled top-down
 * camera, as "a goober you can walk up to and talk to" — same creature family
 * as the player/wild goobers, just dressed for a role.
 *
 * (Supersedes the earlier person-shaped villager — torso/head/arms/legs — which
 * put humans in a game that otherwise has none.)
 *
 * PERF (mobile budget — up to 6 villagers on screen alongside the plaza props):
 * every material is a shared module-level singleton keyed by color (mirrors
 * town-props.tsx's toonOf/basicOf caches). Geometry is cheap primitives (low
 * segment counts, 6-12) declared in JSX — no marching-cubes solve per villager
 * (unlike the real metaball Goober), so 6+ are comfortably affordable. The only
 * per-frame cost is one sin() idle bob/sway + a cheap blink, both skipped under
 * getReducedMotion().
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

const EYE_WHITE = "#ffffff";
const PUPIL = "#1a1420";
const INK = "#2b2440";

/** Cheap flat "grounding" disc under the villager — same fake-AO trick
 *  town-props.tsx's GroundBlob uses, re-derived locally. */
function GroundBlob({ radius = 0.36 }: { radius?: number }) {
  return (
    <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <circleGeometry args={[radius, 12]} />
      <primitive object={basicOf("#20201a", 0.26)} attach="material" />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Body proportions shared by every goober-villager (module-level numbers so
// the accessory silhouettes can position themselves relative to the body).
// A wide, squashed lower lobe + a smaller upper-back bump = the goober read.
// ─────────────────────────────────────────────────────────────────────────
const BODY_R = 0.32;
const BODY_SQUASH = 0.82; // y-scale → a wide, low blob rather than a ball
const BODY_CY = BODY_R * BODY_SQUASH; // center height so the base rests near y=0
const CROWN_Y = BODY_CY + BODY_R * BODY_SQUASH * 0.72; // ~top of the body, for hats/hoods
const EYE_R = 0.072;
const EYE_Y = BODY_CY + 0.05;
const EYE_Z = BODY_R * 0.82; // front face (+z), toward the plaza/camera
const EYE_X = 0.12;

// ─────────────────────────────────────────────────────────────────────────
// Per-role look — a body tint + which worn accessory makes the role distinct.
// The body tint is the goober's own colour (like the game's colourful
// creatures); the accessory is the "job".
// ─────────────────────────────────────────────────────────────────────────
type Accessory = "cap" | "glasses" | "gown" | "hood" | "cloak" | "satchel";

interface RoleLook {
  /** Default goober body colour (overridable per-villager via the `tint` prop). */
  body: string;
  /** A deeper shade of the body, for the worn item's main cloth. */
  cloth: string;
  /** A bright accent (trim, buckle, flower, lens rim). */
  accent: string;
  accessory: Accessory;
}

const ROLE_LOOK: Record<VillagerRole, RoleLook> = {
  // Cradle-Keeper — a gentle warden in a long, soft gown.
  keeper: { body: "#bfe6cf", cloth: "#c9a4d9", accent: "#f6d64b", accessory: "gown" },
  // Shopkeeper — a brisk merchant in a little peaked cap.
  shopkeeper: { body: "#f0c66b", cloth: "#c9762e", accent: "#f7efe2", accessory: "cap" },
  // Loremaster — a scholar in round spectacles.
  loremaster: { body: "#9db8e0", cloth: "#5c7fac", accent: "#e8dcb8", accessory: "glasses" },
  // Quartermaster — a practical outfitter with a slung satchel.
  quartermaster: { body: "#a7bd82", cloth: "#697849", accent: "#caa45a", accessory: "satchel" },
  // Questgiver — a shawled elder with a pulled-up hood.
  questgiver: { body: "#d6b189", cloth: "#8a684e", accent: "#e8a84c", accessory: "hood" },
  // Storyteller — a wanderer under a road-worn travel cloak.
  storyteller: { body: "#aab4d8", cloth: "#4f5c78", accent: "#e07a9a", accessory: "cloak" },
};

export interface VillagerProps {
  role: VillagerRole;
  /** A soft per-villager tint override for the goober body (falls back to the
   *  role's default so every keeper/shopkeeper/etc. isn't identical). */
  tint?: string;
  position?: [number, number, number];
  /** Y-axis facing in radians — 0 faces +z (toward the camera/plaza), matching
   *  town-scene.tsx's worldOf/camera convention. */
  facing?: number;
  scale?: number;
}

/**
 * A goober-shaped villager: a soft two-lobe body with big cel-shaded eyes, a
 * per-role body tint, and a worn accessory (cap / gown / glasses / hood /
 * cloak / satchel) that names the role at a glance. Idle bob/sway + a slow
 * blink give it the same "alive" charm as the real goobers, all skipped under
 * getReducedMotion(). Cheap primitives + shared materials — affordable at 6+
 * on screen alongside the plaza props.
 */
export function Villager({ role, tint, position = [0, 0, 0], facing = 0, scale = 1 }: VillagerProps) {
  const look = ROLE_LOOK[role];
  const bodyColor = tint ?? look.body;
  // A slightly darker body tone for the lower lobe / underside shading read.
  const bodyMat = useMemo(() => toonOf(bodyColor), [bodyColor]);
  const clothMat = useMemo(() => toonOf(look.cloth), [look.cloth]);
  const accentMat = useMemo(() => toonOf(look.accent), [look.accent]);
  const inkMat = useMemo(() => toonOf(INK), []);
  const whiteMat = useMemo(() => toonOf(EYE_WHITE), []);
  const pupilMat = useMemo(() => toonOf(PUPIL), []);

  const bobRef = useRef<THREE.Group>(null);
  const eyeRef = useRef<THREE.Group>(null);
  const reduced = useRef(getReducedMotion());
  // Per-instance phase so 6 villagers don't bob/blink in lockstep (derived from
  // the role name's char codes — deterministic, no Math.random() at mount).
  const phase = useMemo(
    () => [...role].reduce((acc, c) => acc + c.charCodeAt(0), 0) % (Math.PI * 2),
    [role],
  );

  useFrame((state) => {
    if (reduced.current) return;
    const t = state.clock.elapsedTime;
    if (bobRef.current) {
      bobRef.current.position.y = Math.sin(t * 1.2 + phase) * 0.04;
      bobRef.current.rotation.z = Math.sin(t * 0.85 + phase) * 0.03;
    }
    if (eyeRef.current) {
      // Blink: a brief eye-white squash on a slow, offset cycle (matches Goober).
      const cycle = (t * 0.9 + phase) % 4;
      eyeRef.current.scale.y = cycle > 3.85 ? Math.max(0.08, 1 - (cycle - 3.85) * 13) : 1;
    }
  });

  return (
    <group position={position} rotation={[0, facing, 0]} scale={scale}>
      <GroundBlob radius={0.34} />
      <group ref={bobRef}>
        {/* Body — a wide squashed lower lobe + a smaller upper-back bump gives
            the unmistakable goober silhouette (soft, rounded, no limbs). */}
        <mesh position={[0, BODY_CY, 0]} scale={[1, BODY_SQUASH, 1]}>
          <sphereGeometry args={[BODY_R, 12, 10]} />
          <primitive object={bodyMat} attach="material" />
        </mesh>
        <mesh position={[0, BODY_CY + BODY_R * 0.5, -0.06]} scale={[1, 0.9, 1]}>
          <sphereGeometry args={[BODY_R * 0.6, 10, 9]} />
          <primitive object={bodyMat} attach="material" />
        </mesh>

        {/* Eyes — the game's signature look: white sphere + a +z-forward pupil
            + a tiny catch-light, so the villager reads as the same creature
            family as every other goober. Grouped so the blink squashes both. */}
        <group ref={eyeRef}>
          {[-EYE_X, EYE_X].map((ex) => (
            <group key={ex} position={[ex, EYE_Y, EYE_Z]}>
              <mesh>
                <sphereGeometry args={[EYE_R, 12, 12]} />
                <primitive object={whiteMat} attach="material" />
              </mesh>
              <mesh position={[0, 0, EYE_R * 0.6]}>
                <sphereGeometry args={[EYE_R * 0.55, 10, 10]} />
                <primitive object={pupilMat} attach="material" />
              </mesh>
              <mesh position={[EYE_R * 0.28, EYE_R * 0.3, EYE_R * 0.9]}>
                <sphereGeometry args={[EYE_R * 0.28, 6, 6]} />
                <primitive object={basicOf("#ffffff", 0.9)} attach="material" />
              </mesh>
            </group>
          ))}
        </group>

        <RoleAccessory accessory={look.accessory} clothMat={clothMat} accentMat={accentMat} inkMat={inkMat} />
      </group>
    </group>
  );
}

/** The worn item that names each role — sits on/around the goober body built
 *  above. Every branch is a handful of cheap primitives sharing the passed-in
 *  materials (no new material allocation). Positions reference the module-level
 *  body constants so they stay glued to the body as it bobs. */
function RoleAccessory({
  accessory,
  clothMat,
  accentMat,
  inkMat,
}: {
  accessory: Accessory;
  clothMat: THREE.MeshToonMaterial;
  accentMat: THREE.MeshToonMaterial;
  inkMat: THREE.MeshToonMaterial;
}) {
  switch (accessory) {
    case "cap":
      // Shopkeeper: a little peaked cap perched on the crown, with a brim.
      return (
        <group position={[0, CROWN_Y, 0.02]}>
          <mesh position={[0, 0.05, 0]}>
            <coneGeometry args={[BODY_R * 0.5, 0.16, 10]} />
            <primitive object={clothMat} attach="material" />
          </mesh>
          <mesh position={[0, 0.005, 0.11]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[BODY_R * 0.5, 12]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
        </group>
      );

    case "glasses":
      // Loremaster: round spectacles rimming the eyes + a little carried book.
      return (
        <>
          {[-EYE_X, EYE_X].map((ex) => (
            <mesh key={ex} position={[ex, EYE_Y, EYE_Z + EYE_R * 0.7]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[EYE_R * 1.25, 0.014, 6, 16]} />
              <primitive object={inkMat} attach="material" />
            </mesh>
          ))}
          {/* bridge */}
          <mesh position={[0, EYE_Y, EYE_Z + EYE_R * 0.7]}>
            <boxGeometry args={[EYE_X * 0.7, 0.014, 0.014]} />
            <primitive object={inkMat} attach="material" />
          </mesh>
          {/* a small held book, tucked to the side */}
          <mesh position={[BODY_R * 0.82, BODY_CY - 0.02, BODY_R * 0.5]} rotation={[0.2, 0.4, 0]}>
            <boxGeometry args={[0.14, 0.18, 0.04]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
        </>
      );

    case "gown":
      // Cradle-Keeper: a long, soft gown flaring from mid-body to the ground,
      // finished with a bright bloom tucked at the collar.
      return (
        <>
          <mesh position={[0, BODY_CY * 0.55, 0]}>
            <cylinderGeometry args={[BODY_R * 0.72, BODY_R * 1.12, BODY_CY * 1.1, 14, 1, true]} />
            <primitive object={clothMat} attach="material" />
          </mesh>
          <mesh position={[0, BODY_CY + BODY_R * 0.3, EYE_Z * 0.78]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
        </>
      );

    case "hood":
      // Questgiver: a shawled hood pulled up over the crown and down the back.
      return (
        <mesh position={[0, CROWN_Y - 0.04, -0.08]} scale={[1.16, 1.1, 1.2]}>
          <sphereGeometry args={[BODY_R * 0.62, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
          <primitive object={clothMat} attach="material" />
        </mesh>
      );

    case "cloak":
      // Storyteller: a long travel cloak flaring down the back, clasped at front.
      return (
        <>
          <mesh position={[0, BODY_CY * 0.9, -BODY_R * 0.55]} scale={[1.15, 1.5, 0.6]}>
            <sphereGeometry args={[BODY_R * 0.85, 10, 9]} />
            <primitive object={clothMat} attach="material" />
          </mesh>
          <mesh position={[0, BODY_CY + BODY_R * 0.35, EYE_Z * 0.7]}>
            <sphereGeometry args={[0.045, 8, 8]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
        </>
      );

    case "satchel":
      // Quartermaster: a strap slung across the body + a bag at the hip.
      return (
        <>
          <mesh position={[0, BODY_CY + 0.02, 0]} rotation={[0, 0, Math.PI / 5]} scale={[1, 1, 0.85]}>
            <torusGeometry args={[BODY_R * 0.98, 0.028, 6, 20]} />
            <primitive object={clothMat} attach="material" />
          </mesh>
          <mesh position={[BODY_R * 0.86, BODY_CY - 0.08, 0.04]}>
            <boxGeometry args={[0.16, 0.15, 0.1]} />
            <primitive object={clothMat} attach="material" />
          </mesh>
          <mesh position={[BODY_R * 0.86, BODY_CY - 0.05, 0.095]}>
            <boxGeometry args={[0.16, 0.05, 0.02]} />
            <primitive object={accentMat} attach="material" />
          </mesh>
        </>
      );

    default:
      return null;
  }
}
