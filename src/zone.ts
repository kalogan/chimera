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
import type { RoamerSeed, TileKind, ZoneDescriptor } from "game-kit/world-runtime";

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

function guardianToken(family: Family, seedId: string): CreatureToken {
  return { id: seedId, family, plus: 20, generation: 5, parents: null };
}

/** zoneId -> the Guardian's token. */
export const GUARDIAN_TOKEN: Record<string, CreatureToken> = {
  meadowmere: guardianToken("beast", "guardian-meadowmere-beast"),
  emberdeep: guardianToken("dragon", "guardian-emberdeep-dragon"),
  tidewrack: guardianToken("aquatic", "guardian-tidewrack-aquatic"),
};

/** zoneId -> the warm display title shown in the log/HUD (not the creature's
 *  own procedural name — see the note above). */
export const GUARDIAN_TITLE: Record<string, string> = {
  meadowmere: "Meadowmere's Guardian",
  emberdeep: "Emberdeep's Guardian",
  tidewrack: "Tidewrack's Guardian",
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
export const MEADOWMERE: ZoneDescriptor = {
  id: "meadowmere",
  width: MEADOW_WIDTH,
  height: MEADOW_HEIGHT,
  tiles: compileTiles(MEADOWMERE_MAP),
  portals: [
    { at: [6, 8], to: "sanctuary" },
    { at: [12, 3], to: "emberdeep" },
  ],
  // Tall-grass surprise encounters draw from this pool.
  encounterPool: [seedToken("w9"), seedToken("w25"), seedToken("w3")],
  grassEncounterChance: 0.28,
  roamers: [
    { id: "roam-a", token: seedToken("w16"), at: [2, 1], wander: "seek" },
    { id: "roam-b", token: seedToken("w3"), at: [9, 1], wander: "random" },
    { id: "roam-c", token: seedToken("w70"), at: [7, 6], wander: "random" },
    { id: "roam-d", token: seedToken("w56"), at: [10, 3], wander: "seek" },
    guardianRoamer("meadowmere", [11, 6]),
  ],
};

// ── Emberdeep — ember caverns, Dragon/Golem pool ────────────────────────────────

// '#' cavern wall · '.' scorched floor · ',' ember-vent (encounter tile) ·
// 'P' portal (onward to Meadowmere) · 'Q' portal (onward to Tidewrack) · 'R'
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
export const EMBERDEEP: ZoneDescriptor = {
  id: "emberdeep",
  width: EMBERDEEP_WIDTH,
  height: EMBERDEEP_HEIGHT,
  tiles: compileTiles(EMBERDEEP_MAP),
  portals: [
    { at: [6, 8], to: "meadowmere" },
    { at: [11, 4], to: "tidewrack" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [seedToken("w112"), seedToken("w101"), seedToken("w119")],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-e1", token: seedToken("w124"), at: [3, 2], wander: "seek" },
    { id: "roam-e2", token: seedToken("w137"), at: [9, 2], wander: "random" },
    { id: "roam-e3", token: seedToken("w146"), at: [2, 6], wander: "random" },
    { id: "roam-e4", token: seedToken("w128"), at: [10, 6], wander: "seek" },
    guardianRoamer("emberdeep", [6, 7]),
  ],
};

// ── Tidewrack — tide pools, Aquatic/Slime pool ──────────────────────────────────

// '#' rock wall · '.' wet sand · ',' tide-pool (encounter tile) · 'P' portal
// (onward to Emberdeep) · 'Q' portal (onward to Meadowmere) · 'R' portal
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

// Aquatic/Slime family pool.
export const TIDEWRACK: ZoneDescriptor = {
  id: "tidewrack",
  width: TIDEWRACK_WIDTH,
  height: TIDEWRACK_HEIGHT,
  tiles: compileTiles(TIDEWRACK_MAP),
  portals: [
    { at: [6, 8], to: "emberdeep" },
    { at: [11, 3], to: "meadowmere" },
    { at: [11, 1], to: "sanctuary" },
  ],
  encounterPool: [seedToken("w100"), seedToken("w103"), seedToken("w111")],
  grassEncounterChance: 0.3,
  roamers: [
    { id: "roam-t1", token: seedToken("w107"), at: [2, 2], wander: "seek" },
    { id: "roam-t2", token: seedToken("w120"), at: [9, 2], wander: "random" },
    { id: "roam-t3", token: seedToken("w108"), at: [2, 6], wander: "random" },
    { id: "roam-t4", token: seedToken("w127"), at: [10, 5], wander: "seek" },
    guardianRoamer("tidewrack", [9, 7]),
  ],
};

// ── the registry + travel graph ─────────────────────────────────────────────────

/** id → ZoneDescriptor. The single source of truth for "which zones exist". */
export const ZONES: Record<string, ZoneDescriptor> = {
  meadowmere: MEADOWMERE,
  emberdeep: EMBERDEEP,
  tidewrack: TIDEWRACK,
};

/** Every walkable zone id, in a stable declaration order (for UI listings). */
export const ZONE_IDS: readonly string[] = ["meadowmere", "emberdeep", "tidewrack"];

/** Human-facing label for a zone id — falls back to the id itself if unknown. */
export const ZONE_LABELS: Record<string, string> = {
  meadowmere: "Meadowmere",
  emberdeep: "Emberdeep",
  tidewrack: "Tidewrack",
};

/** Look up a zone descriptor by id, defaulting to Meadowmere for an unknown id. */
export function zoneById(id: string): ZoneDescriptor {
  return ZONES[id] ?? MEADOWMERE;
}

/** The special routing target meaning "leave the overworld, return to the Sanctuary". */
export const SANCTUARY_TARGET = "sanctuary";
