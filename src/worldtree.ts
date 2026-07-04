/**
 * worldtree — the ALDERCRADLE progression spine: 8 worlds = the 8 creature
 * families (see game-kit/creature's FAMILIES), each a homeland whose Heartseed
 * heals the dying world-tree standing at the town's plaza center one stage.
 * Recovering all 8/8 unlocks the endgame.
 *
 * THREE ARE BUILT TODAY (Meadowmere/beast, Emberdeep/dragon, Tidewrack/aquatic
 * — see zone.ts's ZONE_IDS); the other FIVE (bird/slime/nature/golem/spirit)
 * are ROADMAP — no zone exists for them yet, so their `zoneId` is null and
 * they render in town as dormant/locked pads (town.ts's TOWN_DORMANT_PADS),
 * visible but untravelable, so the full 8-world journey reads from day one.
 *
 * DECOUPLED BY DESIGN, like zone.ts/town.ts: pure data + helpers, no game.ts
 * import. `game.ts` holds the actual PERSISTED progress (`GameState.heartseeds`,
 * a world-id -> true record) and calls into this module's pure functions.
 */
import type { Family } from "game-kit/creature";

/** A world's descriptor: its family, the Guardian's element flavour (matches
 *  the family archetype's primary element in game-kit/creature), and — for
 *  the 3 built worlds — the walkable zone id where its Guardian is fought. */
export interface WorldDescriptor {
  /** Stable id — same string as the family (worlds ARE the 8 families). */
  id: Family;
  family: Family;
  /** The walkable zone this world's Guardian stands in, or null if the world
   *  is not yet built (roadmap — dormant pad only, no Guardian to fight). */
  zoneId: string | null;
  /** Display label for the world itself (distinct from the zone's own label —
   *  a built world's label matches ZONE_LABELS, but this module doesn't import
   *  zone.ts, so it's repeated here as the single source for world text). */
  label: string;
  /** The Heartseed's own name (what the player is told they've recovered). */
  seedName: string;
  /** A short, warm/wistful lore line — used in the Aldercradle panel + the
   *  dormant-pad hint's flavour for a built-vs-roadmap world. */
  lore: string;
}

/** The full 8-world registry, in a stable declaration order (matches
 *  game-kit/creature's FAMILIES order) — the single source of truth for
 *  "which worlds exist / are roadmap" that both town.ts's pad rendering and
 *  the Aldercradle panel read from. */
export const WORLDS: readonly WorldDescriptor[] = [
  {
    id: "beast",
    family: "beast",
    zoneId: "meadowmere",
    label: "Meadowmere",
    seedName: "the Meadow Heartseed",
    lore: "Where the beast-kin run free under an open sky, and the grass remembers every footfall.",
  },
  {
    id: "bird",
    family: "bird",
    zoneId: null,
    label: "Skyreach",
    seedName: "the Skyreach Heartseed",
    lore: "A high home of wind and feather, still lost to the Fading — no path there yet.",
  },
  {
    id: "dragon",
    family: "dragon",
    zoneId: "emberdeep",
    label: "Emberdeep",
    seedName: "the Ember Heartseed",
    lore: "Caverns that remember fire — the dragon-kin's ancient, scorched cradle.",
  },
  {
    id: "slime",
    family: "slime",
    zoneId: null,
    label: "Ooze Hollow",
    seedName: "the Hollow Heartseed",
    lore: "A soft, shifting home somewhere beyond the map's edge — still lost to the Fading.",
  },
  {
    id: "aquatic",
    family: "aquatic",
    zoneId: "tidewrack",
    label: "Tidewrack",
    seedName: "the Tide Heartseed",
    lore: "Tide pools and salt-worn stone, where the aquatic-kin have always kept their own quiet tides.",
  },
  {
    id: "nature",
    family: "nature",
    zoneId: null,
    label: "Verdant Hush",
    seedName: "the Hush Heartseed",
    lore: "A green, growing home the Fading has not yet let the world remember how to reach.",
  },
  {
    id: "golem",
    family: "golem",
    zoneId: null,
    label: "Stonewake",
    seedName: "the Stonewake Heartseed",
    lore: "A patient, mountainous home of old stone — still lost to the Fading.",
  },
  {
    id: "spirit",
    family: "spirit",
    zoneId: null,
    label: "The Hollow Vale",
    seedName: "the Vale Heartseed",
    lore: "A dim, twilight home between worlds — still lost to the Fading.",
  },
];

/** Worlds with a built, walkable zone today (Meadowmere/Emberdeep/Tidewrack). */
export function builtWorlds(): WorldDescriptor[] {
  return WORLDS.filter((w) => w.zoneId !== null);
}

/** Worlds still roadmap (no zone yet — bird/slime/nature/golem/spirit). */
export function dormantWorlds(): WorldDescriptor[] {
  return WORLDS.filter((w) => w.zoneId === null);
}

/** Look up a world by id (== family), or undefined if unknown. */
export function worldById(id: string): WorldDescriptor | undefined {
  return WORLDS.find((w) => w.id === id);
}

/** The world a given zone id's Guardian belongs to, or undefined if the zone
 *  id doesn't match any built world (defensive — should never happen for a
 *  real ZONE_IDS entry). */
export function worldForZone(zoneId: string): WorldDescriptor | undefined {
  return WORLDS.find((w) => w.zoneId === zoneId);
}

/** The persisted Heartseed collection shape: world id -> true once collected.
 *  A plain record (not a Set) so it's directly JSON/save-friendly. */
export type Heartseeds = Partial<Record<Family, true>>;

/** A fresh game starts with no seeds recovered — the tree is bare. */
export function createHeartseeds(): Heartseeds {
  return {};
}

/** Whether a given world's Heartseed has been recovered. */
export function isHealed(seeds: Heartseeds, worldId: string): boolean {
  return seeds[worldId as Family] === true;
}

/** Mark a world's Heartseed recovered. Pure — returns a NEW Heartseeds record
 *  (a no-op re-set of an already-healed world still returns a fresh object
 *  reference for consistency, but never double-counts in `healedCount`). */
export function awardHeartseed(seeds: Heartseeds, worldId: string): Heartseeds {
  return { ...seeds, [worldId as Family]: true };
}

/** How many of the 8 Heartseeds are recovered (0..8) — the tree's bloom stage. */
export function healedCount(seeds: Heartseeds): number {
  return WORLDS.reduce((n, w) => n + (isHealed(seeds, w.id) ? 1 : 0), 0);
}

/** True once every one of the 8 worlds is healed — the endgame gate. */
export function isTreeWhole(seeds: Heartseeds): boolean {
  return healedCount(seeds) >= WORLDS.length;
}

/** The Guardian yet to fall for a zone's world, or undefined if that zone's
 *  world is already healed (or the zone matches no world). Used to gate
 *  "is there still a Guardian to fight here" without re-deriving from the
 *  roamer list. */
export function nextGuardianFor(seeds: Heartseeds, zoneId: string): WorldDescriptor | undefined {
  const world = worldForZone(zoneId);
  if (!world) return undefined;
  return isHealed(seeds, world.id) ? undefined : world;
}
