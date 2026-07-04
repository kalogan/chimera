/**
 * goober-cache — CHIMERA-local aliases for game-kit's memoized body accessors.
 *
 * The actual walk-perf fix (stable `GooberSpec` references, built once per token
 * id) now lives in the SHARED kit — `gooberSpecFor`/`gooberSpecForSeed` in
 * game-kit/creature — so every game on the kit gets it and it stays in sync via
 * `scripts/vendor-game-kit.mjs`. This file just re-exports them under CHIMERA's
 * vocabulary so the walkable scenes read naturally.
 *
 * WHY IT MATTERS: `Goober` mesh-memoizes on the spec reference; deriving specs
 * inline in render minted a fresh object every walk step and rebuilt every
 * visible metaball field — the mobile "laggy while walking" symptom. These
 * accessors hand back a stable reference so meshes build once and just animate.
 */
export {
  gooberSpecFor as specForToken,
  gooberSpecForSeed as specForSeed,
} from "game-kit/creature";
