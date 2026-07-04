import { useMemo } from "react";
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { CritterSpec } from "./goober";

// Field → world mapping. Metaballs live in the MarchingCubes [0,1] field; its mesh
// spans geometry [-1,1]; a parent group scales that to WORLD. K scales critter-local
// units into the field; YOFF lifts the critter so its feet sit near the field floor.
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

export function Goober({ spec, position }: { spec: CritterSpec; position: [number, number, number] }) {
  const mc = useMemo(() => {
    const mat = new THREE.MeshToonMaterial({ vertexColors: true });
    const m = new MarchingCubes(RES, mat, false, true, 400000);
    m.isolation = ISO;
    m.reset();
    for (const b of spec.balls) {
      const strength = (b.s * K) * (b.s * K) * (ISO + SUB);
      m.addBall(0.5 + b.x * K, YOFF + b.y * K, 0.5 + b.z * K, strength, SUB, new THREE.Color(b.color[0], b.color[1], b.color[2]));
    }
    m.update();
    return m;
  }, [spec]);

  return (
    <group position={position} scale={WORLD}>
      <primitive object={mc} />
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
  );
}
