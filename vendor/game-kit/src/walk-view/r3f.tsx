/**
 * walk-view — react-three-fiber view.
 *
 * Thin components that drive real three cameras/groups from the THREE-free math
 * in `./index.ts`, so vanilla + r3f never drift:
 *
 *  - <FollowCam>  — lerps the active camera toward `followCam(...)` each frame.
 *  - <WalkActor>  — tweens a group between tiles with a `stepHop` arc, and either
 *                   billboards it to the camera or turns it to face its heading.
 *                   The actor's VISUAL is whatever you nest as `children` (a
 *                   sprite, a metaball goober, a mesh) — walk-view owns the
 *                   MOTION, the game owns the LOOK.
 *
 * Requires the react + @react-three/fiber peer deps (optional in package.json).
 */
import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  resolveConfig,
  tileToWorld,
  stepHop,
  facingFromDelta,
  followCam,
  billboardYaw,
  type WalkViewConfig,
} from './index.js';

/**
 * Follow the target position with the angled top-down camera, lerping toward
 * `followCam(...)` each frame. `target` is a ref the parent keeps updated with
 * the player's world position (see <WalkActor>'s `onWorldPos`).
 */
export function FollowCam({
  target,
  config,
}: {
  target: React.MutableRefObject<THREE.Vector3>;
  config?: Partial<WalkViewConfig>;
}): null {
  const cfg = useMemo(() => resolveConfig(config), [config]);
  const cam = useThree((s) => s.camera);
  const desired = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  useFrame(() => {
    const t = target.current;
    const { position, look: lookAt } = followCam(t.x, t.z, cfg);
    desired.current.set(position[0], position[1], position[2]);
    cam.position.lerp(desired.current, cfg.camLerp);
    look.current.lerp(new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]), cfg.lookLerp);
    cam.lookAt(look.current);
  });
  return null;
}

/** How a walk actor orients as it moves. */
export type WalkFacing =
  /** Always turn to face the camera (wild critters, NPCs that "look at you"). */
  | 'billboard'
  /** Turn to face the movement heading (the player — its front leads the walk). */
  | 'directional';

export interface WalkActorProps {
  /** Target tile the actor tweens toward. */
  tileX: number;
  tileY: number;
  /** Grid dimensions (to center the world mapping). */
  width: number;
  height: number;
  config?: Partial<WalkViewConfig>;
  /** Orientation behavior. Default `'billboard'`. */
  facing?: WalkFacing;
  /** A ref this actor writes its ground world position (y=0) into each frame —
   *  wire the player's to <FollowCam>'s `target`. Written in place (no per-frame
   *  allocation), matching the kit's no-alloc convention. */
  posOut?: React.MutableRefObject<THREE.Vector3>;
  /** The actor's visual (sprite / goober / mesh). walk-view owns the motion; you
   *  own the look. Rendered inside the tweened, oriented group. */
  children: ReactNode;
}

/**
 * A group that tweens between tiles with a hop arc and orients per `facing`. The
 * nested `children` are the actor's visual; give them their own local Y offset
 * if they need to hover (walk-view keeps the group's base on the ground so a
 * ground shadow/ring can sit at y=0 as a sibling of this actor).
 */
export function WalkActor({
  tileX,
  tileY,
  width,
  height,
  config,
  facing = 'billboard',
  posOut,
  children,
}: WalkActorProps) {
  const cfg = useMemo(() => resolveConfig(config), [config]);
  const grp = useRef<THREE.Group>(null);
  const cur = useRef<THREE.Vector3>(
    new THREE.Vector3(...tileToWorld(tileX, tileY, width, height, cfg.tile)),
  );
  const heading = useRef(0); // 0 = facing +Z = toward camera at spawn
  const cam = useThree((s) => s.camera);

  useFrame(() => {
    const [wx, , wz] = tileToWorld(tileX, tileY, width, height, cfg.tile);
    const dx = wx - cur.current.x;
    const dz = wz - cur.current.z;
    if (facing === 'directional') {
      const f = facingFromDelta(dx, dz, cfg.faceDeadzone);
      if (f !== null) heading.current = f;
    }
    cur.current.x += dx * cfg.stepLerp;
    cur.current.z += dz * cfg.stepLerp;
    const dist = Math.hypot(wx - cur.current.x, wz - cur.current.z);
    const hop = stepHop(dist, cfg.tile, cfg.hopHeight);
    const g = grp.current;
    if (g) {
      g.position.set(cur.current.x, hop, cur.current.z);
      g.rotation.y =
        facing === 'directional'
          ? heading.current
          : billboardYaw(cur.current.x, cur.current.z, cam.position.x, cam.position.z);
    }
    posOut?.current.set(cur.current.x, 0, cur.current.z);
  });

  return <group ref={grp}>{children}</group>;
}
