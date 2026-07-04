/**
 * worldtree — the ALDERCRADLE progression spine: 8 worlds = the 8 creature
 * families (see game-kit/creature's FAMILIES), each a homeland whose Heartseed
 * heals the dying world-tree standing at the town's plaza center one stage.
 * Recovering all 8/8 unlocks the endgame.
 *
 * ALL 8 ARE BUILT (see zone.ts's ZONE_IDS: Meadowmere/beast, Skyreach/bird,
 * Tidewrack/aquatic, Ooze Hollow/slime, Verdant Hush/nature, Emberdeep/dragon,
 * Stonewake/golem, The Hollow Vale/spirit) — every world has a real walkable
 * zone + Guardian. What gates play is no longer "built vs. roadmap" but the
 * LINEAR unlock chain (`WORLD_ORDER` below): a world's town pad is dormant
 * until the world before it in the chain is healed, so the full 8-world
 * journey still reads as a guided arc from day one, exactly like the old
 * built/dormant split did — just DERIVED from progress instead of hand-flagged.
 *
 * DECOUPLED BY DESIGN, like zone.ts/town.ts: pure data + helpers, no game.ts
 * import. `game.ts` holds the actual PERSISTED progress (`GameState.heartseeds`,
 * a world-id -> true record) and calls into this module's pure functions.
 */
import type { Family } from "game-kit/creature";

/** A world's descriptor: its family, the Guardian's element flavour (matches
 *  the family archetype's primary element in game-kit/creature), and the
 *  walkable zone id where its Guardian is fought. */
export interface WorldDescriptor {
  /** Stable id — same string as the family (worlds ARE the 8 families). */
  id: Family;
  family: Family;
  /** The walkable zone this world's Guardian stands in. Every world is built
   *  today, so this is always a real zone.ts id (never null). */
  zoneId: string;
  /** Display label for the world itself (distinct from the zone's own label —
   *  a built world's label matches ZONE_LABELS, but this module doesn't import
   *  zone.ts, so it's repeated here as the single source for world text). */
  label: string;
  /** The Heartseed's own name (what the player is told they've recovered). */
  seedName: string;
  /** A short, warm/wistful lore line — used in the Aldercradle panel. */
  lore: string;
}

/** The full 8-world registry, in a stable declaration order (matches
 *  game-kit/creature's FAMILIES order — NOT the play order; see `WORLD_ORDER`
 *  for the linear unlock chain) — the single source of truth for the 8
 *  worlds that both town.ts's pad rendering and the Aldercradle panel read
 *  from. */
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
    zoneId: "skyreach",
    label: "Skyreach",
    seedName: "the Skyreach Heartseed",
    lore: "A high home of wind and feather, where the bird-kin ride thermals above the cloud-cliffs.",
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
    zoneId: "oozehollow",
    label: "Ooze Hollow",
    seedName: "the Hollow Heartseed",
    lore: "A soft, shifting hollow where the slime-kin pool and reshape themselves at will.",
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
    zoneId: "verdanthush",
    label: "Verdant Hush",
    seedName: "the Hush Heartseed",
    lore: "A green, growing home where the nature-kin tend a hush that never quite goes quiet.",
  },
  {
    id: "golem",
    family: "golem",
    zoneId: "stonewake",
    label: "Stonewake",
    seedName: "the Stonewake Heartseed",
    lore: "A patient, mountainous home of old stone the golem-kin have carried for a thousand years.",
  },
  {
    id: "spirit",
    family: "spirit",
    zoneId: "hollowvale",
    label: "The Hollow Vale",
    seedName: "the Vale Heartseed",
    lore: "A dim, twilight home between worlds, where the spirit-kin drift and remember.",
  },
];

/**
 * WORLD_ORDER — the LINEAR 8-step unlock chain (a guided journey, rising
 * difficulty ramp), distinct from `WORLDS`'s own declaration order (which
 * mirrors game-kit/creature's FAMILIES order and is NOT the play order).
 * Interleaves the 3 built worlds among the 5 new ones so the whole 8-world
 * arc reads as one coherent climb: gentle beast start -> two more built
 * worlds spaced through the early/mid climb -> the 5 new worlds fill out a
 * smooth ramp -> spirit as the hardest pre-finale world. Chain index (0..7)
 * is the SINGLE tunable "how hard is this world" input other modules (zone.ts's
 * difficulty-ramp formula) key off of — see `chainIndexOf`.
 */
export const WORLD_ORDER: readonly Family[] = [
  "beast", // 0 — Meadowmere, the starter world
  "bird", // 1 — Skyreach
  "aquatic", // 2 — Tidewrack
  "slime", // 3 — Ooze Hollow
  "nature", // 4 — Verdant Hush
  "dragon", // 5 — Emberdeep
  "golem", // 6 — Stonewake
  "spirit", // 7 — The Hollow Vale, hardest pre-finale world
];

/** A world's position (0..7) in the linear unlock chain, or -1 if `worldId`
 *  doesn't match any world (defensive — should never happen for a real id). */
export function chainIndexOf(worldId: string): number {
  return WORLD_ORDER.indexOf(worldId as Family);
}

/**
 * Whether `worldId` is unlocked, DERIVED from `seeds` alone (never stored —
 * save-safe by construction: a save only ever needs to carry `heartseeds`,
 * and unlock state is recomputed fresh every time from that). A world is
 * unlocked iff it's first in the chain, OR the world immediately before it
 * in `WORLD_ORDER` is healed (its Guardian defeated / Heartseed collected).
 * An unknown world id is never unlocked.
 */
export function isWorldUnlocked(seeds: Heartseeds, worldId: string): boolean {
  const idx = chainIndexOf(worldId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const prev = WORLD_ORDER[idx - 1]!;
  return isHealed(seeds, prev);
}

/** Every world currently unlocked, in chain order — the derived "which pads
 *  are active" list town.ts/App.tsx read from instead of a persisted list. */
export function unlockedWorlds(seeds: Heartseeds): WorldDescriptor[] {
  return WORLD_ORDER.filter((id) => isWorldUnlocked(seeds, id)).map((id) => worldById(id)!);
}

/** Every world — all 8 have a built, walkable zone today (kept for callers
 *  that pre-date the "all worlds are built" milestone; equivalent to `WORLDS`
 *  itself now that no world's `zoneId` is ever null). */
export function builtWorlds(): WorldDescriptor[] {
  return WORLDS.filter((w) => w.zoneId !== null);
}

/** Worlds with no built zone. Always empty today — kept as a stable "is the
 *  roadmap empty" check rather than removed outright, in case a future world
 *  is ever added ahead of its zone (mirrors `builtWorlds`'s filter shape). */
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
