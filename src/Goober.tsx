import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { GooberSpec } from "game-kit/creature";

// Field → world mapping. Metaballs live in the MarchingCubes [0,1] field; its mesh
// spans geometry [-1,1]; a parent group scales that to WORLD. K scales creature-local
// units into the field; YOFF lifts the creature so its feet sit near the field floor.
const RES = 48;
const ISO = 80;
const SUB = 12;
const K = 0.26;
const YOFF = 0.14;
const WORLD = 4;

const toGeom = (x: number, y: number, z: number): [number, number, number] => [
  2 * K * x,
  2 * YOFF - 1 + 2 * K * y,
  2 * K * z,
];

/**
 * Render a goober from its `creature.gooberSpec` (the token→body data). The body is
 * a MarchingCubes metaball field; the eyes are little spheres. PROCEDURAL IDLE
 * ANIMATION — a gentle breathe/bob (scale + vertical) plus an occasional blink —
 * makes each critter feel alive without any rig. `seed` de-syncs the phases so a
 * row of creatures doesn't bob in lockstep. `blink` collapses the eye whites in Y.
 */
export function Goober({
  spec,
  position,
  seed = 0,
  facing = 0,
}: {
  spec: GooberSpec;
  position: [number, number, number];
  seed?: number;
  facing?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const eyeGroup = useRef<THREE.Group>(null);

  const mc = useMemo(() => {
    const mat = new THREE.MeshToonMaterial({ vertexColors: true });
    const m = new MarchingCubes(RES, mat, false, true, 400000);
    m.isolation = ISO;
    m.reset();
    for (const b of spec.balls) {
      const strength = b.s * K * (b.s * K) * (ISO + SUB);
      m.addBall(
        0.5 + b.x * K,
        YOFF + b.y * K,
        0.5 + b.z * K,
        strength,
        SUB,
        new THREE.Color(b.color[0], b.color[1], b.color[2]),
      );
    }
    m.update();
    return m;
  }, [spec]);

  // Gentle breathe/bob + occasional blink. Deterministic per-creature phase offset.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const ph = (seed % 100) * 0.618;
    if (group.current) {
      const breathe = 1 + Math.sin(t * 1.6 + ph) * 0.035;
      group.current.scale.setScalar(spec.scale * WORLD * breathe);
      group.current.position.y = position[1] + Math.sin(t * 1.1 + ph) * 0.08;
      group.current.rotation.y = facing + Math.sin(t * 0.5 + ph) * 0.06;
    }
    if (eyeGroup.current) {
      // Blink: a brief eye-white squash on a slow, offset cycle.
      const cycle = (t * 0.9 + ph) % 4;
      const blink = cycle > 3.85 ? Math.max(0.08, 1 - (cycle - 3.85) * 13) : 1;
      eyeGroup.current.scale.y = blink;
    }
  });

  return (
    <group
      ref={group}
      position={position}
      scale={spec.scale * WORLD}
      rotation={[0, facing, 0]}
    >
      <primitive object={mc} />
      <group ref={eyeGroup}>
        {spec.eyes.map((e, i) => {
          const g = toGeom(e.x, e.y, e.z);
          const r = e.r * 2 * K;
          return (
            <group key={i} position={g}>
              <mesh>
                <sphereGeometry args={[r, 16, 16]} />
                <meshToonMaterial color="#ffffff" />
              </mesh>
              <mesh position={[0, 0, r * 0.65]}>
                <sphereGeometry args={[r * 0.55, 12, 12]} />
                <meshBasicMaterial color="#1a1420" />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}
