/**
 * zone — CHIMERA's walkable world map (Wave 5): a small ZONE REGISTRY (id →
 * ZoneDescriptor) instead of a single hardcoded Meadowmere. Each zone is a
 * hand-drawn tile map compiled into a `world-runtime` ZoneDescriptor: walls,
 * a family-flavoured encounter pool + roamers, and PORTALS that route either
 * back to the Sanctuary (`to: 'sanctuary'`) or into another zone (`to: <zone
 * id>`), so the player can walk meadowmere ↔ emberdeep ↔ tidewrack without
 * ever leaving the overworld loop.
 *
 * Wild tokens are drawn from each zone's own pool (reusing the existing
 * WILD_POOL family split from game.ts's Meadowmere ids where it fits, and new
 * `w1xx`/`w2xx`-range seed ids elsewhere) so the goober you SEE in a given
 * zone is flavour-appropriate (Emberdeep = dragon/golem, Tidewrack =
 * aquatic/slime) AND the one you fight on contact.
 */
import { seedToken, type CreatureToken, type Family } from "game-kit/creature";
import { hashStringToSeed, createRng } from "game-kit/prng";
import type { RoamerSeed, TileKind, ZoneDescriptor } from "game-kit/world-runtime";
import { chainIndexOf } from "./worldtree.js";
import { LEVEL_CAP } from "./leveling.js";

const CHAR_TO_TILE: Record<string, TileKind> = {
  "#": "wall",
  ".": "floor",
  ",": "grass",
  P: "portal",
  Q: "portal", // a second portal tile (to a different destination than P)
  R: "portal", // a third portal tile (to yet another destination than P/Q)
  S: "spawn",
};

function compileTiles(map: readonly string[]): TileKind[] {
  return map.flatMap((row) => [...row].map((ch) => CHAR_TO_TILE[ch] ?? "floor"));
}

// ── Guardians (Aldercradle progression) ─────────────────────────────────────
//
// Each of the 3 built worlds' Guardian stands at a fixed FAR tile in its zone
// (idle — it never wanders, so it's always exactly where the player expects a
// boss to be) and is modeled as an ordinary `RoamerSeed`/`RoamerState`: the
// SAME collision/encounter machinery every wild roamer already uses (walking
// onto its tile fires a normal `ZoneEvent: 'encounter'`). `GUARDIAN_ROAMER_ID`
// is the fixed id every zone's Guardian roamer uses, so game.ts can recognize
// "this encounter is the Guardian" by id alone rather than a new ZoneEvent
// variant (keeps `world-runtime` itself untouched).
//
// The Guardian's token is constructed DIRECTLY (not via `seedToken`, whose
// family is a hash of the id and can't be pinned) so it's guaranteed
// family-correct for its world, with `plus`/`generation` pushed high enough
// to reliably land rank S — a clearly tougher, elevated champion rather than
// a reskinned wild goober. `creatureFromToken`'s own procedural name (e.g.
// "Gnaranling") is kept as the creature's true name; the WARM, READABLE
// title ("Meadowmere's Guardian") the player sees in the log/HUD is a
// display-only string from `GUARDIAN_TITLE`, not the token's name.
export const GUARDIAN_ROAMER_ID = "guardian";

// ── the difficulty ramp (Aldercradle progression) ───────────────────────────
//
// ONE tunable formula, keyed purely on a world's WORLD_ORDER position (0..7,
// see worldtree.ts's `chainIndexOf`) — every zone's roamers + Guardian derive
// their `CreatureToken.plus`/`generation` from it, so world 0 (Meadowmere)
// opens gentle and world 7 (The Hollow Vale) is a genuinely tough pre-finale
// climb, with the 5 new worlds AND the 3 built ones all slotting into the
// same smooth curve (no scattered magic numbers per zone).
//
// `creatureFromToken`'s `rankFor` derives a rank index from
// `floor(plus / 5) + min(generation, 3)`, clamped to F..S (0..6) — so rank
// itself saturates at S partway up the chain. Stat scaling
// (`scaleStats`'s `plusMult = 1 + plus*0.05`) keeps climbing with raw `plus`
// even after rank caps, so EFFECTIVE power stays strictly increasing across
// all 8 steps, not just the rank letter shown in the log/HUD.
//
// Roamers (the wild goobers you casually bump into) climb gently — they're
// flavour/grinding, not the wall. The Guardian is the real difficulty spike
// per world, climbing faster and starting higher so even world 0's boss is a
// real fight, not a formality.
function roamerPlus(chainIdx: number): number {
  return 1 + chainIdx * 2;
}
function roamerGeneration(chainIdx: number): number {
  return 1 + Math.floor(chainIdx / 3);
}
function guardianPlus(chainIdx: number): number {
  return 6 + chainIdx * 4;
}
function guardianGeneration(chainIdx: number): number {
  return 2 + Math.floor(chainIdx / 2);
}

// ── enemy LEVELS (leveling.ts) — a SEPARATE axis from plus/generation above ──
//
// The leveling slice adds a second difficulty knob: every enemy (roamer,
// encounter-pool mon, rival, Guardian) now also carries a LEVEL, fed straight
// into `leveledStats` at battle-construction time (see game.ts). Levels are
// tiered off the SAME `chainIndexOf` position the plus/generation ramp above
// already uses, deliberately kept in a MODEST range (roamers ~3..45, Guardians
// ~8..50 across the 8-world chain) — NOT stacked additively on top of the full
// plus/generation ramp's own already-large multiplier, so the two axes don't
// double-count into an unbeatable curve. See the report's balance note: the
// plus/gen ramp still drives most of a Guardian's toughness; level growth
// (leveling.ts's small per-family biases) is a gentler top-up, not a second
// exponential.
//
// A little deterministic per-token variance (±2 levels for roamers, ±1 for a
// Guardian) keeps same-tier enemies from reading as perfectly identical
// without breaking determinism (seeded off the token's own id, mirroring
// `creatureFromToken`'s own hashStringToSeed convention).
function levelVariance(seedId: string, spread: number): number {
  if (spread <= 0) return 0;
  const rng = createRng(hashStringToSeed(`${seedId}:level`));
  return rng.int(spread * 2 + 1) - spread;
}

function clampLevel(n: number): number {
  return Math.max(1, Math.min(LEVEL_CAP, Math.round(n)));
}

/** A roamer/encounter-pool enemy's level for `family`'s chain position. */
export function roamerLevel(family: Family, seedId: string): number {
  const idx = Math.max(0, chainIndexOf(family));
  const base = 3 + idx * 6;
  return clampLevel(base + levelVariance(seedId, 2));
}

/** A Guardian's level for `family`'s chain position — a bit above its zone's
 *  ordinary roamers, matching the plus/generation ramp's own "roamers climb
 *  gently, the Guardian is the spike" shape. */
export function guardianLevel(family: Family, seedId: string): number {
  const idx = Math.max(0, chainIndexOf(family));
  const base = 8 + idx * 6;
  return clampLevel(base + levelVariance(seedId, 1));
}

/**
 * The battle level for ANY enemy token — a wild roamer/encounter-pool mon, a
 * rival's own party member, or a Guardian — the one call site game.ts needs
 * when constructing a battle. `isGuardian` selects the (slightly higher)
 * Guardian curve; everything else (including a rival's creatures, which are
 * plain authored/bred tokens without a chain-tiered plus/generation of their
 * own) uses the ordinary roamer curve keyed off the TOKEN'S OWN family so a
 * rival's dragon-family mon still levels like a dragon-tier enemy would. */
export function enemyLevelForToken(token: CreatureToken, isGuardian = false): number {
  return isGuardian ? guardianLevel(token.family, token.id) : roamerLevel(token.family, token.id);
}

/** A roamer token for `family`, tiered to that family's own WORLD_ORDER
 *  position (a world's id === its family, so `family` doubles as the chain
 *  lookup key) — falls back to chain-index 0 (the gentlest tier) for a
 *  family that's somehow not in WORLD_ORDER, rather than throwing. */
function tieredRoamerToken(family: Family, seedId: string): CreatureToken {
  const idx = Math.max(0, chainIndexOf(family));
  const base = seedToken(seedId);
  return { ...base, family, plus: roamerPlus(idx), generation: roamerGeneration(idx) };
}

function guardianToken(family: Family, seedId: string): CreatureToken {
  const idx = Math.max(0, chainIndexOf(family));
  return { id: seedId, family, plus: guardianPlus(idx), generation: guardianGeneration(idx), parents: null };
}

/** zoneId -> the Guardian's token. */
export const GUARDIAN_TOKEN: Record<string, CreatureToken> = {
  meadowmere: guardianToken("beast", "guardian-meadowmere-beast"),
  skyreach: guardianToken("bird", "guardian-skyreach-bird"),
  tidewrack: guardianToken("aquatic", "guardian-tidewrack-aquatic"),
  oozehollow: guardianToken("slime", "guardian-oozehollow-slime"),
  verdanthush: guardianToken("nature", "guardian-verdanthush-nature"),
  emberdeep: guardianToken("dragon", "guardian-emberdeep-dragon"),
  stonewake: guardianToken("golem", "guardian-stonewake-golem"),
  hollowvale: guardianToken("spirit", "guardian-hollowvale-spirit"),
};

/** zoneId -> the warm display title shown in the log/HUD (not the creature's
 *  own procedural name — see the note above). */
export const GUARDIAN_TITLE: Record<string, string> = {
  meadowmere: "Meadowmere's Guardian",
  skyreach: "Skyreach's Guardian",
  tidewrack: "Tidewrack's Guardian",
  oozehollow: "Ooze Hollow's Guardian",
  verdanthush: "Verdant Hush's Guardian",
  emberdeep: "Emberdeep's Guardian",
  stonewake: "Stonewake's Guardian",
  hollowvale: "The Hollow Vale's Guardian",
};

function guardianRoamer(zoneId: string, at: [number, number]): RoamerSeed {
  return { id: GUARDIAN_ROAMER_ID, token: GUARDIAN_TOKEN[zoneId]!, at, wander: "idle" };
}

// ── Meadowmere — verdant overworld hub, the starting zone ──────────────────────

// One char per tile. '#' hedge · '.' grass-floor · ',' tall grass · 'P' portal
// (to the Sanctuary) · 'Q' portal (to Emberdeep) · 'S' spawn.
const MEADOWMERE_MAP = [
  "#############",
  "#...........#",
  "#..##...,,..#",
  "#.......,,.Q#",
  "#.##....##..#",
  "#.....S.....#",
  "#..,,.......#",
  "#..,,....##.#",
  "######P######",
];

export const MEADOW_WIDTH = MEADOWMERE_MAP[0]!.length;
export const MEADOW_HEIGHT = MEADOWMERE_MAP.length;

// The visible wild goobers. `seek` ones drift toward you (DQM-style roamers);
// `random` ones wander. Their tokens ARE the monsters you fight on contact.
// Chain position 0 (see worldtree.ts's WORLD_ORDER) — the gentlest tier: the
// starter world's roamers/Guardian both sit at the bottom of the ramp.
export const MEADOWMERE: ZoneDescriptor = {
  id: "meadowmere",
  width: MEADOW_WIDTH,
  height: MEADOW_HEIGHT,
  tiles: compileTiles(MEADOWMERE_MAP),
  portals: [
    { at: [6, 8], to: "sanctuary" },
    { at: [12, 3], to: "skyreach" },
  ],
  // Tall-grass surprise encounters draw from this pool.
  encounterPool: [
    tieredRoamerToken("beast", "w9"),
    tieredRoamerToken("beast", "w25"),
    tieredRoamerToken("beast", "w3"),
  ],
  grassEncounterChance: 0.28,
  roamers: [
    { id: "roam-a", token: tieredRoamerToken("beast", "w16"), at: [2, 1], wander: "seek" },
    { id: "roam-b", token: tieredRoamerToken("beast", "w3"), at: [9, 1], wander: "random" },
    { id: "roam-c", token: tieredRoamerToken("beast", "w70"), at: [7, 6], wander: "random" },
    { id: "roam-d", token: tieredRoamerToken("beast", "w56"), at: [10, 3], wander: "seek" },
    guardianRoamer("meadowmere", [11, 6]),
  ],
};

// ── Emberdeep — ember caverns, Dragon/Golem pool ────────────────────────────────

// '#' cavern wall · '.' scorched floor · ',' ember-vent (encounter tile) ·
// 'P' portal (onward to Verdant Hush) · 'Q' portal (onward to Stonewake) · 'R'
// portal (direct to the Sanctuary) · 'S' spawn.
const EMBERDEEP_MAP = [
  "#############",
  "#..,,......R#",
  "#..,,...##..#",
  "#....S......#",
  "#.##....##.Q#",
  "#..........,#",
  "#.##....##,,#",
  "#...........#",
  "######P######",
];

export const EMBERDEEP_WIDTH = EMBERDEEP_MAP[0]!.length;
export const EMBERDEEP_HEIGHT = EMBERDEEP_MAP.length;

// Dragon/Golem family pool (verified against creature/index.ts's seedToken hash).
// Chain position 5 — mid/late ramp: a real step up from the first half.
export const EMBERDEEP: ZoneDescriptor = {
  id: "emberdeep",
  width: EMBERDEEP_WIDTH,
  height: EMBERDEEP_HEIGHT,
  tiles: compileTiles(EMBERDEEP_MAP),
  portals: [
    { at: [6, 8], to: "verdanthush" },
    { at: [11, 4], to: "stonewake" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("dragon", "w112"),
    tieredRoamerToken("dragon", "w101"),
    tieredRoamerToken("dragon", "w119"),
  ],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-e1", token: tieredRoamerToken("dragon", "w124"), at: [3, 2], wander: "seek" },
    { id: "roam-e2", token: tieredRoamerToken("dragon", "w137"), at: [10, 2], wander: "random" },
    { id: "roam-e3", token: tieredRoamerToken("dragon", "w146"), at: [2, 7], wander: "random" },
    { id: "roam-e4", token: tieredRoamerToken("dragon", "w128"), at: [10, 6], wander: "seek" },
    guardianRoamer("emberdeep", [6, 7]),
  ],
};

// ── Tidewrack — tide pools, Aquatic/Slime pool ──────────────────────────────────

// '#' rock wall · '.' wet sand · ',' tide-pool (encounter tile) · 'P' portal
// (onward to Ooze Hollow) · 'Q' portal (onward to Skyreach) · 'R' portal
// (direct to the Sanctuary) · 'S' spawn.
const TIDEWRACK_MAP = [
  "#############",
  "#..........R#",
  "#.,,....##..#",
  "#.,,....##.Q#",
  "#....S......#",
  "#..##....,,.#",
  "#..##....,,.#",
  "#...........#",
  "######P######",
];

export const TIDEWRACK_WIDTH = TIDEWRACK_MAP[0]!.length;
export const TIDEWRACK_HEIGHT = TIDEWRACK_MAP.length;

// Aquatic/Slime family pool. Chain position 2 — early-mid ramp.
export const TIDEWRACK: ZoneDescriptor = {
  id: "tidewrack",
  width: TIDEWRACK_WIDTH,
  height: TIDEWRACK_HEIGHT,
  tiles: compileTiles(TIDEWRACK_MAP),
  portals: [
    { at: [6, 8], to: "oozehollow" },
    { at: [11, 3], to: "skyreach" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("aquatic", "w100"),
    tieredRoamerToken("aquatic", "w103"),
    tieredRoamerToken("aquatic", "w111"),
  ],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-t1", token: tieredRoamerToken("aquatic", "w107"), at: [2, 2], wander: "seek" },
    { id: "roam-t2", token: tieredRoamerToken("aquatic", "w120"), at: [10, 2], wander: "random" },
    { id: "roam-t3", token: tieredRoamerToken("aquatic", "w108"), at: [2, 6], wander: "random" },
    { id: "roam-t4", token: tieredRoamerToken("aquatic", "w127"), at: [10, 5], wander: "seek" },
    guardianRoamer("tidewrack", [9, 7]),
  ],
};

// ── Skyreach — airy sky-cliffs, Bird pool (chain position 1) ────────────────

// '#' cloud-cliff wall · '.' wind-swept stone · ',' updraft (encounter tile) ·
// 'P' portal (back to Meadowmere) · 'Q' portal (onward to Tidewrack) · 'R'
// portal (direct to the Sanctuary) · 'S' spawn.
const SKYREACH_MAP = [
  "#############",
  "#..,,......R#",
  "#..,,...##..#",
  "#....S......#",
  "#.##....##.Q#",
  "#..........,#",
  "#.##....##,,#",
  "#...........#",
  "######P######",
];

export const SKYREACH_WIDTH = SKYREACH_MAP[0]!.length;
export const SKYREACH_HEIGHT = SKYREACH_MAP.length;

// Bird family pool. Chain position 1 — just past the starter tier.
export const SKYREACH: ZoneDescriptor = {
  id: "skyreach",
  width: SKYREACH_WIDTH,
  height: SKYREACH_HEIGHT,
  tiles: compileTiles(SKYREACH_MAP),
  portals: [
    { at: [6, 8], to: "meadowmere" },
    { at: [11, 4], to: "tidewrack" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("bird", "w162"),
    tieredRoamerToken("bird", "w164"),
    tieredRoamerToken("bird", "w190"),
  ],
  grassEncounterChance: 0.28,
  roamers: [
    { id: "roam-s1", token: tieredRoamerToken("bird", "w196"), at: [3, 2], wander: "seek" },
    { id: "roam-s2", token: tieredRoamerToken("bird", "w227"), at: [10, 2], wander: "random" },
    { id: "roam-s3", token: tieredRoamerToken("bird", "w269"), at: [5, 6], wander: "random" },
    { id: "roam-s4", token: tieredRoamerToken("bird", "w298"), at: [10, 6], wander: "seek" },
    guardianRoamer("skyreach", [6, 7]),
  ],
};

// ── Ooze Hollow — a soft, shifting hollow, Slime pool (chain position 3) ────

// '#' mossy wall · '.' damp hollow floor · ',' ooze-pool (encounter tile) ·
// 'P' portal (back to Tidewrack) · 'Q' portal (onward to Verdant Hush) · 'R'
// portal (direct to the Sanctuary) · 'S' spawn.
const OOZEHOLLOW_MAP = [
  "#############",
  "#...........#",
  "#..##...,,..#",
  "#.......,,.Q#",
  "#.##....##..#",
  "#.....S.....#",
  "#..,,.......#",
  "#..,,....##R#",
  "######P######",
];

export const OOZEHOLLOW_WIDTH = OOZEHOLLOW_MAP[0]!.length;
export const OOZEHOLLOW_HEIGHT = OOZEHOLLOW_MAP.length;

// Slime family pool. Chain position 3 — early-mid ramp.
export const OOZEHOLLOW: ZoneDescriptor = {
  id: "oozehollow",
  width: OOZEHOLLOW_WIDTH,
  height: OOZEHOLLOW_HEIGHT,
  tiles: compileTiles(OOZEHOLLOW_MAP),
  portals: [
    { at: [6, 8], to: "tidewrack" },
    { at: [11, 3], to: "verdanthush" },
    { at: [11, 7], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("slime", "w156"),
    tieredRoamerToken("slime", "w157"),
    tieredRoamerToken("slime", "w158"),
  ],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-o1", token: tieredRoamerToken("slime", "w167"), at: [2, 1], wander: "seek" },
    { id: "roam-o2", token: tieredRoamerToken("slime", "w169"), at: [9, 1], wander: "random" },
    { id: "roam-o3", token: tieredRoamerToken("slime", "w174"), at: [7, 6], wander: "random" },
    { id: "roam-o4", token: tieredRoamerToken("slime", "w175"), at: [10, 3], wander: "seek" },
    guardianRoamer("oozehollow", [11, 6]),
  ],
};

// ── Verdant Hush — a green, growing home, Nature pool (chain position 4) ────

// '#' hedge wall · '.' mossy floor · ',' bloom-patch (encounter tile) · 'P'
// portal (back to Ooze Hollow) · 'Q' portal (onward to Emberdeep) · 'R'
// portal (direct to the Sanctuary) · 'S' spawn.
const VERDANTHUSH_MAP = [
  "#############",
  "#..,,......R#",
  "#..,,...##..#",
  "#....S......#",
  "#.##....##.Q#",
  "#..........,#",
  "#.##....##,,#",
  "#...........#",
  "######P######",
];

export const VERDANTHUSH_WIDTH = VERDANTHUSH_MAP[0]!.length;
export const VERDANTHUSH_HEIGHT = VERDANTHUSH_MAP.length;

// Nature family pool. Chain position 4 — mid ramp.
export const VERDANTHUSH: ZoneDescriptor = {
  id: "verdanthush",
  width: VERDANTHUSH_WIDTH,
  height: VERDANTHUSH_HEIGHT,
  tiles: compileTiles(VERDANTHUSH_MAP),
  portals: [
    { at: [6, 8], to: "oozehollow" },
    { at: [11, 4], to: "emberdeep" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("nature", "w165"),
    tieredRoamerToken("nature", "w172"),
    tieredRoamerToken("nature", "w177"),
  ],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-v1", token: tieredRoamerToken("nature", "w181"), at: [3, 2], wander: "seek" },
    { id: "roam-v2", token: tieredRoamerToken("nature", "w182"), at: [10, 2], wander: "random" },
    { id: "roam-v3", token: tieredRoamerToken("nature", "w189"), at: [5, 6], wander: "random" },
    { id: "roam-v4", token: tieredRoamerToken("nature", "w191"), at: [10, 6], wander: "seek" },
    guardianRoamer("verdanthush", [6, 7]),
  ],
};

// ── Stonewake — a patient, mountainous home, Golem pool (chain position 6) ──

// '#' old stone wall · '.' worn rock floor · ',' rubble-vent (encounter tile)
// · 'P' portal (back to Emberdeep) · 'Q' portal (onward to The Hollow Vale) ·
// 'R' portal (direct to the Sanctuary) · 'S' spawn.
const STONEWAKE_MAP = [
  "#############",
  "#...........#",
  "#..##...,,..#",
  "#.......,,.Q#",
  "#.##....##..#",
  "#.....S.....#",
  "#..,,.......#",
  "#..,,....##R#",
  "######P######",
];

export const STONEWAKE_WIDTH = STONEWAKE_MAP[0]!.length;
export const STONEWAKE_HEIGHT = STONEWAKE_MAP.length;

// Golem family pool. Chain position 6 — near the top of the ramp.
export const STONEWAKE: ZoneDescriptor = {
  id: "stonewake",
  width: STONEWAKE_WIDTH,
  height: STONEWAKE_HEIGHT,
  tiles: compileTiles(STONEWAKE_MAP),
  portals: [
    { at: [6, 8], to: "emberdeep" },
    { at: [11, 3], to: "hollowvale" },
    { at: [11, 7], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("golem", "w184"),
    tieredRoamerToken("golem", "w193"),
    tieredRoamerToken("golem", "w194"),
  ],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-k1", token: tieredRoamerToken("golem", "w205"), at: [2, 1], wander: "seek" },
    { id: "roam-k2", token: tieredRoamerToken("golem", "w206"), at: [9, 1], wander: "random" },
    { id: "roam-k3", token: tieredRoamerToken("golem", "w207"), at: [7, 6], wander: "random" },
    { id: "roam-k4", token: tieredRoamerToken("golem", "w212"), at: [10, 3], wander: "seek" },
    guardianRoamer("stonewake", [11, 6]),
  ],
};

// ── The Hollow Vale — a dim twilight home, Spirit pool (chain position 7) ───

// '#' dusk-stone wall · '.' violet-shadowed floor · ',' will-o-wisp (encounter
// tile) · 'P' portal (back to Stonewake) · 'R' portal (direct to the
// Sanctuary) · 'S' spawn. The hardest pre-finale world — no onward portal, it
// is the LAST step of the chain.
const HOLLOWVALE_MAP = [
  "#############",
  "#..,,......R#",
  "#..,,...##..#",
  "#....S......#",
  "#.##....##..#",
  "#...........#",
  "#.##....##,,#",
  "#...........#",
  "######P######",
];

export const HOLLOWVALE_WIDTH = HOLLOWVALE_MAP[0]!.length;
export const HOLLOWVALE_HEIGHT = HOLLOWVALE_MAP.length;

// Spirit family pool. Chain position 7 — the hardest pre-finale world.
export const HOLLOWVALE: ZoneDescriptor = {
  id: "hollowvale",
  width: HOLLOWVALE_WIDTH,
  height: HOLLOWVALE_HEIGHT,
  tiles: compileTiles(HOLLOWVALE_MAP),
  portals: [
    { at: [6, 8], to: "stonewake" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [
    tieredRoamerToken("spirit", "w153"),
    tieredRoamerToken("spirit", "w159"),
    tieredRoamerToken("spirit", "w161"),
  ],
  grassEncounterChance: 0.32,
  roamers: [
    { id: "roam-h1", token: tieredRoamerToken("spirit", "w163"), at: [3, 2], wander: "seek" },
    { id: "roam-h2", token: tieredRoamerToken("spirit", "w168"), at: [10, 2], wander: "random" },
    { id: "roam-h3", token: tieredRoamerToken("spirit", "w195"), at: [5, 6], wander: "random" },
    { id: "roam-h4", token: tieredRoamerToken("spirit", "w204"), at: [10, 6], wander: "seek" },
    guardianRoamer("hollowvale", [6, 7]),
  ],
};

// ── the registry + travel graph ─────────────────────────────────────────────────

/** id → ZoneDescriptor. The single source of truth for "which zones exist". */
export const ZONES: Record<string, ZoneDescriptor> = {
  meadowmere: MEADOWMERE,
  skyreach: SKYREACH,
  tidewrack: TIDEWRACK,
  oozehollow: OOZEHOLLOW,
  verdanthush: VERDANTHUSH,
  emberdeep: EMBERDEEP,
  stonewake: STONEWAKE,
  hollowvale: HOLLOWVALE,
};

/** Every walkable zone id, in WORLD_ORDER's chain order (for UI listings). */
export const ZONE_IDS: readonly string[] = [
  "meadowmere",
  "skyreach",
  "tidewrack",
  "oozehollow",
  "verdanthush",
  "emberdeep",
  "stonewake",
  "hollowvale",
];

/** Human-facing label for a zone id — falls back to the id itself if unknown. */
export const ZONE_LABELS: Record<string, string> = {
  meadowmere: "Meadowmere",
  skyreach: "Skyreach",
  tidewrack: "Tidewrack",
  oozehollow: "Ooze Hollow",
  verdanthush: "Verdant Hush",
  emberdeep: "Emberdeep",
  stonewake: "Stonewake",
  hollowvale: "The Hollow Vale",
};

/** Look up a zone descriptor by id, defaulting to Meadowmere for an unknown id. */
export function zoneById(id: string): ZoneDescriptor {
  return ZONES[id] ?? MEADOWMERE;
}

/** The special routing target meaning "leave the overworld, return to the Sanctuary". */
export const SANCTUARY_TARGET = "sanctuary";
