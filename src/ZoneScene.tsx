/**
 * ZoneScene — CHIMERA's walkable 2.5D overworld (Wave 2). An angled top-down
 * "HD-2D" camera follows the player across a tile grid; goobers are billboarded
 * (always facing the camera) and hop between tiles. Pure render of a
 * `world-runtime` ZoneState — movement is authored by the reducer, the view only
 * tweens toward the current tile positions. Input lives in App (it owns state).
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Billboard } from "game-kit/billboard/r3f";
import { creatureFromToken, type GooberSpec } from "game-kit/creature";
import type { ZoneState } from "game-kit/world-runtime";
import { Goober } from "./Goober.js";

const TILE = 2.2;
// Camera offset from the player: up/back chosen for ~52° downward (angled top-down
// HD-2D) while framing several tiles around the player. atan2(18,14) ≈ 52°.
const CAM_UP = 18;
const CAM_BACK = 14;
const CAM_FOV = 40;
const HOP_H = 0.42;
// Overworld goobers are tile-sized, much smaller than the battle-stage lineup.
const GOOBER_SIZE = 0.42;

function worldOf(x: number, y: number, w: number, h: number): [number, number, number] {
  return [(x - (w - 1) / 2) * TILE, 0, (y - (h - 1) / 2) * TILE];
}

/** A goober that tweens toward its tile with a little hop arc, billboarded. */
function Actor({
  spec,
  tx,
  ty,
  w,
  h,
  seed,
  posOut,
}: {
  spec: GooberSpec;
  tx: number;
  ty: number;
  w: number;
  h: number;
  seed: number;
  posOut?: React.MutableRefObject<THREE.Vector3>;
}) {
  const grp = useRef<THREE.Group>(null);
  const cur = useRef<THREE.Vector3>(
    new THREE.Vector3(...worldOf(tx, ty, w, h)),
  );
  useFrame(() => {
    const [wx, , wz] = worldOf(tx, ty, w, h);
    cur.current.x += (wx - cur.current.x) * 0.25;
    cur.current.z += (wz - cur.current.z) * 0.25;
    const dist = Math.hypot(wx - cur.current.x, wz - cur.current.z);
    const p = 1 - Math.min(dist / TILE, 1); // 0 at step start → 1 on arrival
    const hop = Math.sin(p * Math.PI) * HOP_H;
    if (grp.current) grp.current.position.set(cur.current.x, hop, cur.current.z);
    if (posOut) posOut.current.set(cur.current.x, 0, cur.current.z);
  });
  return (
    <group ref={grp}>
      <Billboard>
        <Goober spec={spec} position={[0, 0, 0]} seed={seed} sizeScale={GOOBER_SIZE} />
      </Billboard>
    </group>
  );
}

/** Smoothly track the player with the angled top-down camera. */
function FollowCam({ target }: { target: React.MutableRefObject<THREE.Vector3> }) {
  const cam = useThree((s) => s.camera);
  const desired = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  useFrame(() => {
    const t = target.current;
    desired.current.set(t.x, CAM_UP, t.z + CAM_BACK);
    cam.position.lerp(desired.current, 0.12);
    look.current.lerp(new THREE.Vector3(t.x, 1.1, t.z), 0.16);
    cam.lookAt(look.current);
  });
  return null;
}

/** Static tile geometry: hedges, tall grass, the portal pad, the ground. */
function Terrain({ zone }: { zone: ZoneState }) {
  const { width: w, height: h, tiles } = zone.descriptor;
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
            <meshToonMaterial color="#5f8a4c" />
          </mesh>,
        );
      } else if (kind === "grass") {
        out.push(
          <group key={i} position={[wx, 0, wz]}>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[TILE, TILE]} />
              <meshToonMaterial color="#6fae52" />
            </mesh>
            {[-0.5, 0.2, 0.6].map((ox, k) => (
              <mesh key={k} position={[ox, 0.32, (k - 1) * 0.5]}>
                <coneGeometry args={[0.22, 0.7, 5]} />
                <meshToonMaterial color="#4f9440" />
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
  }, [zone.descriptor, w, h, tiles]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[w * TILE + 8, h * TILE + 8]} />
        <meshToonMaterial color="#8ec96a" />
      </mesh>
      {cells}
    </>
  );
}

export function ZoneScene({ zone, playerSpec }: { zone: ZoneState; playerSpec: GooberSpec }) {
  const playerPos = useRef(new THREE.Vector3());
  const { width: w, height: h } = zone.descriptor;
  const [spawnX, , spawnZ] = worldOf(zone.player.x, zone.player.y, w, h);

  return (
    <Canvas
      className="stage"
      shadows={false}
      camera={{ position: [spawnX, CAM_UP, spawnZ + CAM_BACK], fov: CAM_FOV }}
    >
      <color attach="background" args={["#bfe6f2"]} />
      <hemisphereLight args={["#eaf6ff", "#7fae66", 1.1]} />
      <directionalLight position={[6, 14, 6]} intensity={1.35} />
      <FollowCam target={playerPos} />
      <Terrain zone={zone} />
      <Actor
        spec={playerSpec}
        tx={zone.player.x}
        ty={zone.player.y}
        w={w}
        h={h}
        seed={99}
        posOut={playerPos}
      />
      {zone.roamers.map((r) => (
        <Actor
          key={r.id}
          spec={creatureFromToken(r.token).gooberSpec}
          tx={r.x}
          ty={r.y}
          w={w}
          h={h}
          seed={r.id.charCodeAt(r.id.length - 1) * 7}
        />
      ))}
    </Canvas>
  );
}
