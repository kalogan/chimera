/**
 * rivals — CHIMERA's chimera-side rival roster + off-screen sim (Wave 4). Two
 * named AI rivals (Vesk the Hoarder, Lune the Breeder) play the kit's
 * deterministic `rival` module off-screen: their own roster/dex/economy grow
 * via `runRival` between visits, using the SAME seeded utility AI + reducers
 * as the dev inspector. This module does NOT reimplement any of that — it
 * only (a) seeds two rivals + a shared `RivalCtx` zone pool, (b) advances
 * their sim a few steps whenever the player enters a zone, and (c) tracks a
 * lightweight, chimera-owned overworld TILE POSITION per rival so one can be
 * placed in Meadowmere and walked into — the kit's `world-runtime` stays
 * untouched (rivals are NOT `RoamerState`s; they're a parallel, simpler
 * "wander/drift" model kept entirely in chimera).
 *
 * The payoff: the rival's party when you meet them is `rival.roster.party`
 * straight from the sim — never a fixed/authored team. Battle them again
 * later and the roster has moved on (bred, scouted, ranked up) exactly as
 * far as its `runRival` steps took it.
 */
import { createRng, hashStringToSeed, type Rng } from "game-kit/prng";
import { seedToken } from "game-kit/creature";
import {
  createRival,
  runRival,
  HOARDER_PERSONALITY,
  BREEDER_PERSONALITY,
  type RivalState,
  type RivalCtx,
} from "game-kit/rival";
import type { Dir } from "game-kit/world-runtime";

/** Wild pool a rival's sim draws from while "in" Meadowmere — mirrors zone.ts's flavour. */
const MEADOWMERE_RIVAL_POOL = ["w9", "w25", "w3", "w16", "w70", "w56"].map((id) => seedToken(id));

/** The shared, pure context every rival's sim step reads (per-zone wild pools). */
export function makeRivalCtx(): RivalCtx {
  return { zonePool: { meadowmere: MEADOWMERE_RIVAL_POOL } };
}

/** A rival's chimera-tracked overworld placement — separate from its sim state. */
export interface RivalPlacement {
  /** Which zone (by ZoneDescriptor id) this rival is currently roaming, if any. */
  zone: string | null;
  x: number;
  y: number;
}

/** A rival paired with its overworld placement — what game.ts/ZoneScene need. */
export interface PlacedRival {
  rival: RivalState;
  placement: RivalPlacement;
}

// Tiles Vesk/Lune may roam Meadowmere on — hand-picked open floor/grass spots
// (verified against zone.ts's MAP) away from the spawn so the player runs into
// them while exploring, not the instant they enter. (Meadowmere is 13x9.)
const MEADOWMERE_SPOTS: Array<[number, number]> = [
  [1, 2],
  [10, 2],
  [8, 3],
  [10, 6],
  [1, 6],
  [11, 5],
];

function startingSpot(rng: Rng): [number, number] {
  return rng.pick(MEADOWMERE_SPOTS);
}

/** Create the two chimera rivals, each with its own seeded starter + placement. */
export function makeRivals(): PlacedRival[] {
  const vesk = createRival({
    id: "vesk",
    name: "Vesk",
    personality: HOARDER_PERSONALITY,
    currentZone: "meadowmere",
    seed: "vesk-rival-seed",
    starters: [seedToken("rival-vesk-starter")],
    gold: 60,
  });
  const lune = createRival({
    id: "lune",
    name: "Lune",
    personality: BREEDER_PERSONALITY,
    currentZone: "meadowmere",
    seed: "lune-rival-seed",
    starters: [seedToken("rival-lune-starter"), seedToken("rival-lune-starter-2")],
    gold: 60,
  });

  const veskRng = createRng(hashStringToSeed("vesk-spot"));
  const luneRng = createRng(hashStringToSeed("lune-spot"));
  const [vx, vy] = startingSpot(veskRng);
  const [lx, ly] = startingSpot(luneRng);

  return [
    { rival: vesk, placement: { zone: "meadowmere", x: vx, y: vy } },
    { rival: lune, placement: { zone: "meadowmere", x: lx, y: ly } },
  ];
}

/**
 * Advance every rival's off-screen sim by `nSteps` (their roster/economy grow
 * via the kit's deterministic `runRival`), then — for any rival whose
 * `currentZone` matches `zoneId` — relocate it to a fresh seeded tile so it
 * isn't standing in the same spot visit after visit. Rivals not in this zone
 * keep their last placement (zone: null reads as "not encounterable here").
 */
export function advanceRivals(
  placed: PlacedRival[],
  ctx: RivalCtx,
  nSteps: number,
  zoneId: string,
): PlacedRival[] {
  return placed.map(({ rival, placement }) => {
    const { rival: next } = runRival(rival, ctx, nSteps);
    if (next.currentZone !== zoneId) {
      return { rival: next, placement: { zone: null, x: placement.x, y: placement.y } };
    }
    // Reseed the spot from (id, step) so repeat visits vary but stay deterministic.
    const rng = createRng(hashStringToSeed(`${next.id}:spot:${next.step}`));
    const [x, y] = startingSpot(rng);
    return { rival: next, placement: { zone: zoneId, x, y } };
  });
}

/** True iff (x, y) matches a currently-in-zone rival's tile. */
export function rivalAt(placed: PlacedRival[], zoneId: string, x: number, y: number): PlacedRival | null {
  for (const p of placed) {
    if (p.placement.zone === zoneId && p.placement.x === x && p.placement.y === y) return p;
  }
  return null;
}

/** [dx, dy] for a single step in `dir` — mirrors world-runtime's private `delta`. */
function delta(dir: Dir): [number, number] {
  switch (dir) {
    case "up":
      return [0, -1];
    case "down":
      return [0, 1];
    case "left":
      return [-1, 0];
    case "right":
      return [1, 0];
  }
}

/**
 * Drift every in-zone rival one tile, seeded off (rival id, step counter) so
 * movement is deterministic yet independent of the player's own rng cursor.
 * A simple biased random-walk: mostly wanders, occasionally drifts toward the
 * player (so they're findable) — never walks onto a `blocked` predicate here
 * since chimera doesn't own tile collision; callers clamp to `isWalkable`.
 */
export function driftRivals(
  placed: PlacedRival[],
  zoneId: string,
  playerX: number,
  playerY: number,
  stepCounter: number,
  isWalkable: (x: number, y: number) => boolean,
): PlacedRival[] {
  return placed.map((p) => {
    if (p.placement.zone !== zoneId) return p;
    const rng = createRng(hashStringToSeed(`${p.rival.id}:drift`)).fork(stepCounter);
    const dirs: Dir[] = ["up", "down", "left", "right"];
    const candidates = dirs.filter((d) => {
      const [dx, dy] = delta(d);
      return isWalkable(p.placement.x + dx, p.placement.y + dy);
    });
    if (candidates.length === 0) return p;

    const SEEK_BIAS = 0.2; // mostly wander, occasionally drift toward the player
    let dir: Dir;
    if (rng.next() < SEEK_BIAS) {
      let best = candidates[0]!;
      let bestDist = Infinity;
      for (const d of candidates) {
        const [dx, dy] = delta(d);
        const nx = p.placement.x + dx;
        const ny = p.placement.y + dy;
        const dist = Math.abs(nx - playerX) + Math.abs(ny - playerY);
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      dir = best;
    } else {
      dir = rng.pick(candidates);
    }
    const [dx, dy] = delta(dir);
    return { ...p, placement: { ...p.placement, x: p.placement.x + dx, y: p.placement.y + dy } };
  });
}

/** Replace one rival's entry (by id) after it's been advanced post-battle. */
export function updateRival(placed: PlacedRival[], updated: PlacedRival): PlacedRival[] {
  return placed.map((p) => (p.rival.id === updated.rival.id ? updated : p));
}
