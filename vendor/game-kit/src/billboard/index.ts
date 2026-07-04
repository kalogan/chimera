/**
 * Billboard yaw — the math seam for Y-axis-only billboarding.
 *
 * THREE-FREE: this module must never import three so it unit-tests without it.
 * All functions are pure: no internal state, no Math.random, no Date.now.
 *
 * FRONT-AXIS CONVENTION: an object's "front" is its local **+Z** axis (the
 * opposite of this kit's camera-forward convention, where yaw=0 faces −Z —
 * see `camera/index.ts`. Billboarded props (goober creatures, markers) are
 * authored/modeled facing +Z, so that's the axis this module rotates toward
 * the camera).
 *
 * Y-AXIS-ONLY: unlike a full look-at (which tips the object to also point at
 * the camera's height), this only considers the XZ projection — the object
 * stays upright and grounded, spinning around world Y like a 2.5D sprite.
 */

/** A plain XZ position/direction pair — the only two axes billboarding needs. */
export type XZ = readonly [x: number, z: number];

/**
 * The world-Y rotation (radians) that turns a **+Z-forward** object at the
 * origin so its front faces the direction `(toX, toZ)` (already relative,
 * i.e. `to - from`).
 *
 * Three.js's Y-axis rotation maps local +Z → world `(sin(y), 0, cos(y))`, so
 * solving for `y` given a target direction is `atan2(dx, dz)`. Degenerate
 * input `(0, 0)` (camera exactly at the object's XZ position) returns 0
 * (keep current facing rather than producing NaN via atan2(0,0), which is
 * technically 0 already, but this documents the guarantee explicitly).
 */
export function billboardYawTo(fromXZ: XZ, toXZ: XZ): number {
  const dx = toXZ[0] - fromXZ[0];
  const dz = toXZ[1] - fromXZ[1];
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/**
 * The world-Y rotation (radians) that turns a **+Z-forward** object at
 * `objPos` to face `cameraPos`, ignoring both positions' Y entirely (so the
 * object stays upright — only the XZ projection of the camera direction
 * matters).
 *
 * - Camera directly on the object's +Z side → `0` (front already faces it).
 * - Camera on the object's +X side → `+PI/2`.
 * - Camera on the object's −X side → `-PI/2`.
 * - Camera directly on the object's −Z side (behind) → `PI` (or `-PI`;
 *   `atan2` returns `PI` for this exact case).
 * - Camera height (Y) never affects the result — two cameras with the same
 *   XZ position but different Y produce identical yaw.
 */
export function billboardYaw(cameraPos: readonly [number, number, number], objPos: readonly [number, number, number]): number {
  return billboardYawTo([objPos[0], objPos[2]], [cameraPos[0], cameraPos[2]]);
}
