/**
 * walk-view — the 2.5D tile-walk *feel*, distilled to pure math.
 *
 * The "HD-2D" overworld feel of a top-down-angled tile walker: a camera that
 * follows the player across a centered grid, actors that tween between tiles
 * with a little hop arc, and sprites that either billboard to the camera or turn
 * to face their heading. This module is the THREE-free, React-free core of that
 * feel; the `r3f.tsx` sibling is the thin view that drives real cameras/groups
 * from it, so vanilla + r3f never drift.
 *
 * The feel is distilled from CHIMERA, where this exact math lived DUPLICATED in
 * `ZoneScene.tsx` (the overworld) and `town-scene.tsx` (the plaza) — the reason
 * this module exists is so the next 2.5D walker gets it for free instead of a
 * third copy.
 *
 * THREE-FREE: plain numbers and tuples only — fully unit-testable without a
 * WebGL context. No `three`, no React, no `Math.random`/`Date.now`.
 *
 * CONVENTIONS:
 *  - Grid is centered on the world origin: tile (0,0) is the top-left corner,
 *    world +x goes right, world +z goes "down"/toward the camera.
 *  - "front axis" is local **+Z** (same as the `billboard` module): an actor
 *    authored facing +Z, yawed by `facingFromDelta`/`billboardYaw`, points its
 *    front where it should.
 */

/** Tuning knobs for the whole walk view. Every field has a sensible default in
 *  {@link DEFAULT_WALK_VIEW}; pass a partial to {@link resolveConfig} to override. */
export interface WalkViewConfig {
  /** World units per tile. */
  tile: number;
  /** Camera height above the player (the "up" leg of the angled offset). */
  camUp: number;
  /** Camera +z distance behind the player (the "back" leg). `atan2(camUp,camBack)`
   *  is the downward view angle — e.g. 18/14 ≈ 52°. */
  camBack: number;
  /** Per-frame smoothing for the camera POSITION lerp (0..1; higher = snappier). */
  camLerp: number;
  /** Per-frame smoothing for the camera LOOK-AT lerp (0..1). */
  lookLerp: number;
  /** World height the camera aims at (roughly the actors' mid-height). */
  lookHeight: number;
  /** Peak height of the per-step hop arc. */
  hopHeight: number;
  /** Per-frame smoothing for an actor tweening toward its target tile (0..1). */
  stepLerp: number;
  /** Minimum squared movement (world units²) before an actor re-aims its facing,
   *  so a settled actor holds its last heading instead of snapping to 0. */
  faceDeadzone: number;
}

/** The CHIMERA-tuned defaults — the values the feel was dialed in at. */
export const DEFAULT_WALK_VIEW: WalkViewConfig = {
  tile: 2.2,
  camUp: 18,
  camBack: 14,
  camLerp: 0.12,
  lookLerp: 0.16,
  lookHeight: 1.1,
  hopHeight: 0.42,
  stepLerp: 0.25,
  faceDeadzone: 0.0004,
};

/** Fill a partial config with {@link DEFAULT_WALK_VIEW}. */
export function resolveConfig(partial?: Partial<WalkViewConfig>): WalkViewConfig {
  return partial ? { ...DEFAULT_WALK_VIEW, ...partial } : DEFAULT_WALK_VIEW;
}

/** A world-space position/direction. */
export type Vec3 = readonly [x: number, y: number, z: number];

/**
 * Tile (grid) coordinate → world position, centering the grid on the origin so
 * a `width`×`height` map straddles (0,0). Y is always 0 (the ground plane).
 */
export function tileToWorld(
  x: number,
  y: number,
  width: number,
  height: number,
  tile: number,
): Vec3 {
  return [(x - (width - 1) / 2) * tile, 0, (y - (height - 1) / 2) * tile];
}

/**
 * Per-step hop height: a sine arc that is 0 when the actor is AT its target tile
 * (`dist` ≈ 0) and 0 at the moment a step BEGINS (`dist` ≈ `tile`), peaking at
 * `peak` mid-step. `dist` is the remaining world distance to the target tile.
 *
 * Clamps `dist/tile` to 1 so an actor teleported >1 tile away doesn't produce a
 * giant hop — it just eases in.
 */
export function stepHop(dist: number, tile: number, peak: number): number {
  const p = 1 - Math.min(dist / tile, 1); // 0 at step start → 1 on arrival
  return Math.sin(p * Math.PI) * peak;
}

/**
 * Heading (radians, +Z-forward) from a movement delta `(dx, dz)`, or `null` when
 * the move is within `deadzone` (squared) — so callers hold the last facing
 * while idle rather than snapping back to 0.
 *
 * Matches three.js Y-rotation: a +Z-forward object rotated by the result faces
 * `(dx, dz)`. Down (+z, toward camera) → 0; right (+x) → +π/2; up (−z) → π.
 */
export function facingFromDelta(dx: number, dz: number, deadzone: number): number | null {
  if (dx * dx + dz * dz <= deadzone) return null;
  return Math.atan2(dx, dz);
}

/** The follow-camera's desired position + look target for a player at world
 *  `(px, pz)`. The r3f view lerps toward these each frame (see `camLerp`). */
export function followCam(px: number, pz: number, cfg: WalkViewConfig): {
  position: Vec3;
  look: Vec3;
} {
  return {
    position: [px, cfg.camUp, pz + cfg.camBack],
    look: [px, cfg.lookHeight, pz],
  };
}

/**
 * Billboard yaw: the world-Y rotation (radians) that turns a **+Z-forward**
 * object at world `(objX, objZ)` so its front faces the camera at `(camX, camZ)`
 * — XZ only, so the object stays upright. Same convention as the `billboard`
 * module; inlined here so `walk-view` stays self-contained.
 */
export function billboardYaw(objX: number, objZ: number, camX: number, camZ: number): number {
  const dx = camX - objX;
  const dz = camZ - objZ;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}
