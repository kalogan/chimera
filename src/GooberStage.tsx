import { Canvas } from "@react-three/fiber";
import type { GooberSpec } from "game-kit/creature";
import { Goober } from "./Goober.js";

export interface Placed {
  id: string;
  spec: GooberSpec;
  position: [number, number, number];
  facing?: number;
  fainted?: boolean;
  seed?: number;
}

// A framed, orbit-free 2.5D stage (sidesteps GYRE's camera pain): a fixed camera
// looks at a cozy meadow; goobers stand where placed. Reused for the party lineup,
// the battle field (two facing rows), and the breeding reveal (a single newborn).
export function GooberStage({
  placed,
  cameraPos = [0, 5, 30],
  fov = 30,
  bg = "#9ed0ee",
  ground = "#bfe39a",
}: {
  placed: Placed[];
  cameraPos?: [number, number, number];
  fov?: number;
  bg?: string;
  ground?: string;
}) {
  return (
    <Canvas className="stage" camera={{ position: cameraPos, fov }} shadows={false}>
      <color attach="background" args={[bg]} />
      <hemisphereLight args={["#eaf6ff", "#8fbf7a", 1.15]} />
      <directionalLight position={[5, 12, 6]} intensity={1.5} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshToonMaterial color={ground} />
      </mesh>
      {placed.map((p) => (
        <Goober
          key={p.id}
          spec={p.spec}
          position={p.position}
          facing={p.facing ?? 0}
          fainted={p.fainted}
          seed={p.seed ?? 0}
        />
      ))}
    </Canvas>
  );
}
