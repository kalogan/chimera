/**
 * Billboard — react-three-fiber variant.
 *
 * `<Billboard>` is a `<group>` that, every frame, yaws itself to face the
 * active camera around world Y only — the 2.5D "standup sprite" look for
 * CHIMERA's top-down overworld (3D metaball goober bodies that read like
 * flat sprites, staying upright/grounded instead of tipping toward the
 * camera the way a full look-at would).
 *
 * Wraps the pure {@link billboardYaw} (./index.ts): each frame reads the
 * group's + camera's world positions and sets `group.rotation.y` directly, no
 * per-frame allocation (a scratch Vector3 is reused for the world-position
 * reads).
 *
 * Requires the react + @react-three/fiber peer deps (optional in package.json).
 */

import { useRef, type JSX, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { billboardYaw } from './index.js';

export interface BillboardProps {
  children?: ReactNode;
  /**
   * Y-axis-only billboarding (upright, grounded — the 2.5D case). This is the
   * only mode implemented; the prop exists so a caller can explicitly opt in
   * (documenting intent) and so a future full look-at variant has a place to
   * hang off `false` without an API break. Default `true`.
   */
  yAxisOnly?: boolean;
}

// Reused across frames to avoid per-frame allocation.
const _camWorldPos = new THREE.Vector3();
const _groupWorldPos = new THREE.Vector3();

/**
 * A `<group>` whose contents always face the camera by yawing around world Y
 * (front axis = local +Z, see `./index.ts`), staying upright. Drop a goober
 * (or any front-facing prop) inside it.
 */
export function Billboard({ children, yAxisOnly = true }: BillboardProps): JSX.Element {
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const group = ref.current;
    if (!group || !yAxisOnly) return;
    camera.getWorldPosition(_camWorldPos);
    group.getWorldPosition(_groupWorldPos);
    group.rotation.y = billboardYaw(
      [_camWorldPos.x, _camWorldPos.y, _camWorldPos.z],
      [_groupWorldPos.x, _groupWorldPos.y, _groupWorldPos.z],
    );
  });

  return <group ref={ref}>{children}</group>;
}
