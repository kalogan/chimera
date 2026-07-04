import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Goober } from "./Goober.js";
import { critterFromSeed } from "./goober.js";

// A row of critters generated from seeds — the CHIMERA goober spike. Each seed is a
// stand-in for an identity token; same seed → same critter. "Breeding" later mixes seeds.
const SEEDS = [7, 21, 42, 99, 128];

function Scene() {
  const critters = useMemo(() => SEEDS.map((s) => ({ seed: s, spec: critterFromSeed(s) })), []);
  const spacing = 7;
  return (
    <>
      <color attach="background" args={["#9ed0ee"]} />
      <hemisphereLight args={["#eaf6ff", "#8fbf7a", 1.1]} />
      <directionalLight position={[5, 10, 6]} intensity={1.6} />
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshToonMaterial color="#bfe39a" />
      </mesh>
      {critters.map((c, i) => (
        <Goober key={c.seed} spec={c.spec} position={[(i - (SEEDS.length - 1) / 2) * spacing, 2.5, 0]} />
      ))}
      <OrbitControls target={[0, 3, 0]} />
    </>
  );
}

export function App() {
  return (
    <Canvas camera={{ position: [0, 6, 42], fov: 28 }} shadows={false}>
      <Scene />
    </Canvas>
  );
}
