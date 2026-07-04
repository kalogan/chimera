import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Goober } from "./Goober.js";
import { creatureFromToken, seedToken } from "game-kit/creature";

// A row of creatures generated from identity tokens — the CHIMERA goober party.
// Each token → a full creature (body + voice + stats + skills). Same token → same
// creature. Breeding mixes two tokens into a new one.
const STARTER_IDS = ["ember-01", "brook-02", "thistle-03", "gale-04", "cairn-05"];

function Scene() {
  const party = useMemo(
    () => STARTER_IDS.map((id, i) => ({ i, creature: creatureFromToken(seedToken(id)) })),
    [],
  );
  const spacing = 7;
  return (
    <>
      <color attach="background" args={["#9ed0ee"]} />
      <hemisphereLight args={["#eaf6ff", "#8fbf7a", 1.1]} />
      <directionalLight position={[5, 10, 6]} intensity={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshToonMaterial color="#bfe39a" />
      </mesh>
      {party.map(({ i, creature }) => (
        <Goober
          key={creature.token.id}
          spec={creature.gooberSpec}
          seed={i * 37 + 5}
          position={[(i - (STARTER_IDS.length - 1) / 2) * spacing, 2.5, 0]}
        />
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
