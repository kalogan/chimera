/**
 * Meadowmere — CHIMERA's first walkable zone (Wave 2). A hand-drawn tile map
 * compiled into a `world-runtime` ZoneDescriptor: hedges (walls), tall grass
 * (random encounters), a portal back to the Sanctuary, and a few wild goobers
 * that roam the meadow — bump one to battle it. Wild tokens are drawn from the
 * game's WILD_POOL so the goober you SEE is the one you fight.
 */
import { seedToken } from "game-kit/creature";
import type { TileKind, ZoneDescriptor } from "game-kit/world-runtime";

// One char per tile. '#' hedge · '.' grass-floor · ',' tall grass · 'P' portal
// (back to the Sanctuary) · 'S' spawn. Every row is exactly WIDTH chars.
const MAP = [
  "#############",
  "#...........#",
  "#..##...,,..#",
  "#.......,,..#",
  "#.##....##..#",
  "#.....S.....#",
  "#..,,.......#",
  "#..,,....##.#",
  "######P######",
];

const CHAR_TO_TILE: Record<string, TileKind> = {
  "#": "wall",
  ".": "floor",
  ",": "grass",
  P: "portal",
  S: "spawn",
};

export const MEADOW_WIDTH = MAP[0]!.length;
export const MEADOW_HEIGHT = MAP.length;

const tiles: TileKind[] = MAP.flatMap((row) =>
  [...row].map((ch) => CHAR_TO_TILE[ch] ?? "floor"),
);

// The visible wild goobers. `seek` ones drift toward you (DQM-style roamers);
// `random` ones wander. Their tokens ARE the monsters you fight on contact.
export const MEADOWMERE: ZoneDescriptor = {
  id: "meadowmere",
  width: MEADOW_WIDTH,
  height: MEADOW_HEIGHT,
  tiles,
  portals: [{ at: [6, 8], to: "sanctuary" }],
  // Tall-grass surprise encounters draw from this pool.
  encounterPool: [seedToken("w9"), seedToken("w25"), seedToken("w3")],
  grassEncounterChance: 0.28,
  roamers: [
    { id: "roam-a", token: seedToken("w16"), at: [2, 1], wander: "seek" },
    { id: "roam-b", token: seedToken("w3"), at: [9, 1], wander: "random" },
    { id: "roam-c", token: seedToken("w70"), at: [7, 6], wander: "random" },
    { id: "roam-d", token: seedToken("w56"), at: [10, 3], wander: "seek" },
  ],
};
