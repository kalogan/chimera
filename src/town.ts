/**
 * town — CHIMERA's walkable plaza (the TOWN feature): a small square where
 * villagers narrate the story, sell wares, help you breed/mate, catalogue the
 * dex, hand out quests, and broker trades. Mirrors `zone.ts`'s hand-drawn
 * tile-map format so `town-scene.tsx` can reuse the same rendering shape the
 * overworld already uses — but the town is its OWN place (a plaza, not a
 * wild zone): no encounters, no roamers, just villagers you can walk up to
 * and talk to.
 *
 * DECOUPLED BY DESIGN: this module imports nothing from `game.ts`/`App.tsx`
 * and exports plain data + a small `TownAction` union describing what a
 * villager interaction ASKS FOR (open the shop, open the cradle, ...) — the
 * Architect wires those requests into the real systems. Nothing here owns
 * state; `town-scene.tsx`/`town-dialogue.tsx` take this data as props.
 */

// ── the tile map (mirrors zone.ts's compileTiles shape) ─────────────────────

export type TownTileKind = "wall" | "floor" | "plaza" | "spawn";

const CHAR_TO_TOWN_TILE: Record<string, TownTileKind> = {
  "#": "wall",
  ".": "floor",
  ",": "plaza", // a paved plaza tile (cosmetic dressing, e.g. a fountain ring)
  S: "spawn",
};

function compileTownTiles(map: readonly string[]): TownTileKind[] {
  return map.flatMap((row) => [...row].map((ch) => CHAR_TO_TOWN_TILE[ch] ?? "floor"));
}

// One char per tile. '#' building wall · '.' plaza floor · ',' paved ring
// (fountain plaza) · 'S' spawn (the road in from the overworld). A small,
// warm square — six doorways ringing a fountain at its heart.
const TOWN_MAP = [
  "#############",
  "#...........#",
  "#..#.....#..#",
  "#..#.....#..#",
  "#....,,,....#",
  "#...,,,,,...#",
  "#....,,,....#",
  "#..#.....#..#",
  "#..#..S..#..#",
  "#...........#",
  "#############",
] as const;

export const TOWN_TILES: TownTileKind[] = compileTownTiles(TOWN_MAP);
export const TOWN_WIDTH = TOWN_MAP[0].length;
export const TOWN_HEIGHT = TOWN_MAP.length;

/** The tile the player starts on when they walk into town (the road-in spawn). */
export const TOWN_SPAWN: [number, number] = [6, 8];

/** True when `[x, y]` is inside the map and not a wall (villagers + the player both check this). */
export function isTownWalkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= TOWN_WIDTH || y >= TOWN_HEIGHT) return false;
  const kind = TOWN_TILES[y * TOWN_WIDTH + x];
  return kind !== "wall";
}

// ── the villager roster ──────────────────────────────────────────────────────

export type VillagerRole =
  | "keeper"
  | "shopkeeper"
  | "loremaster"
  | "quartermaster"
  | "questgiver"
  | "storyteller";

export interface TownVillager {
  id: string;
  name: string;
  role: VillagerRole;
  /** Fed to the NPC conversation brain's persona (role/knowledgeScope/goals/voice). */
  persona: string;
  /** Warm/wistful authored lines — the scripted-fallback + opening beat. */
  fallbackLines: string[];
  /** Where they stand in the plaza. */
  tile: [number, number];
  /** What talking to them can open, beyond free chat (undefined = pure banter/lore). */
  opens?: "shop" | "cradle" | "dex" | "quests" | "trade";
  /** A soft tint for their nameplate/marker (falls back to a neutral warm tone). */
  tint?: string;
}

export const TOWN_VILLAGERS: TownVillager[] = [
  {
    id: "cradle-keeper",
    name: "Mother Wren",
    role: "keeper",
    persona:
      "the Cradle-Keeper — an old, gentle warden of the breeding cradle who has watched a " +
      "hundred pairings take and a hundred small lives begin; she narrates The Fading (the " +
      "slow dimming of the wild goober lines) with a grief she has made peace with, and " +
      "believes every new hatchling is a quiet act of defiance against it",
    fallbackLines: [
      "Oh — a new face by the cradle. Come to see if two hearts might make a third?",
      "The wild lines dim a little more each season, dear. I call it the Fading. But every " +
        "egg that warms in my hands says the world isn't done yet.",
      "I've rocked so many small shapes to sleep in here. None of them ever felt the same " +
        "as the last. That's the whole of the mercy, I think.",
      "Bring me a pair who trust each other, and I'll show you what tenderness can still make.",
      "Sit a while, if you like. The cradle keeps its own quiet, and it's a good quiet to sit in.",
    ],
    tile: [4, 1],
    opens: "cradle",
    tint: "#c9a4d9",
  },
  {
    id: "shopkeeper",
    name: "Bramble Tuck",
    role: "shopkeeper",
    persona:
      "the Shopkeeper — a stout, cheerful peddler who has stocked every stall from the coast " +
      "to the ember caverns and talks about tonics and lures the way other people talk about " +
      "old friends; brisk but warm, always closing with a wink and a discount that isn't real",
    fallbackLines: [
      "Well met! Freshest stock this side of Meadowmere, I promise you that.",
      "Tonics, lures, the odd curious trinket — if it fits in a pack, I've probably sold one.",
      "Careful with that shelf, it wobbles. Everything on it is still for sale, mind.",
      "Come rain or Fading, folk still need their supplies. Business as usual, more or less.",
      "Browse as long as you like. I'll just be here, pretending not to watch your coin purse.",
    ],
    tile: [9, 1],
    opens: "shop",
    tint: "#e8a84c",
  },
  {
    id: "loremaster",
    name: "Sable Quill",
    role: "loremaster",
    persona:
      "the Loremaster — a quiet, precise scholar who has spent decades cataloguing every " +
      "creature family and its lineage into the dex; speaks slowly, savours a good detail, " +
      "and treats a newly-scouted species like a small miracle worth writing down properly",
    fallbackLines: [
      "Ah — a scout, or merely curious? Either way, the dex is always glad of new eyes.",
      "Every entry in here was once a creature no one had thought to write down. I find " +
        "that rather moving, if I'm honest.",
      "Families, ranks, lineages — it all sounds dry until you realize it's a record of " +
        "every small life that crossed someone's path.",
      "I could talk about the Golem line for an hour and not notice the time. Consider " +
        "yourself warned.",
      "Bring me something the dex has never seen, and I promise you'll make my whole week.",
    ],
    tile: [2, 5],
    opens: "dex",
    tint: "#7fb0c9",
  },
  {
    id: "quartermaster",
    name: "Ferro Vantt",
    role: "quartermaster",
    persona:
      "the Quartermaster — a blunt, efficient broker who runs the trade post; keeps meticulous " +
      "ledgers of who's offered what, has a soft spot for a fair deal, and gets genuinely " +
      "delighted when two travelers' creatures end up better-matched to new homes",
    fallbackLines: [
      "Looking to trade? I keep an honest ledger — no one leaves this post shortchanged.",
      "A goober that's a poor fit for you might be exactly what someone else is missing. " +
        "That's the whole art of it.",
      "I've brokered stranger trades than you'd think. Never once regretted a fair one.",
      "Bring your roster over and let's see what matches itself up. I do love a good match.",
      "Slow day, but a slow day just means the next trade is coming. Patience, and all that.",
    ],
    tile: [4, 9],
    opens: "trade",
    tint: "#8a9a6b",
  },
  {
    id: "questgiver",
    name: "Old Tamsin",
    role: "questgiver",
    persona:
      "the Questgiver — a weathered, kindly elder who remembers when the town was smaller and " +
      "the Fading hadn't yet started; hands out small errands and larger favors with the air " +
      "of someone who trusts you specifically to see them through, never barking orders",
    fallbackLines: [
      "There you are. I've a few things that want doing, if you've the time for an old woman's errands.",
      "Nothing here is urgent enough to demand — just things I can't manage myself anymore, " +
        "and would rather trust to someone who cares.",
      "Every little task you finish for this town adds up to more than you'd think, dear.",
      "I've watched enough travelers pass through to know a good one when I see them. Go on, then.",
      "Come back whenever. The list only ever grows a little shorter, never quite empty.",
    ],
    tile: [9, 9],
    opens: "quests",
    tint: "#c97e6b",
  },
  {
    id: "storyteller",
    name: "Pip Lantern",
    role: "storyteller",
    persona:
      "the Storyteller — a wandering, wide-eyed rambler who collects rumors and half-true tales " +
      "from every zone and recites them like they're the most wonderful thing they've ever heard; " +
      "pure banter and lore, no errands or wares, just warmth and wonder",
    fallbackLines: [
      "Psst — have you heard the one about the goober who followed the tide all the way to Tidewrack?",
      "I collect stories the way some folk collect coin. Richer for it, if you ask me.",
      "They say Emberdeep's oldest golem remembers the caverns before they were ever scorched. " +
        "I like to believe it.",
      "Every traveler carries at least one good story without knowing it. What's yours, hm?",
      "Stay a moment — the best tales always sound better with someone new to tell them to.",
    ],
    tile: [10, 5],
    tint: "#d9c48a",
  },
];

/** Look up a villager by id, or undefined if the id doesn't match the roster. */
export function villagerById(id: string): TownVillager | undefined {
  return TOWN_VILLAGERS.find((v) => v.id === id);
}

/** The four cardinal step directions `town-scene.tsx`'s `onMove` accepts. */
export type TownDirection = "up" | "down" | "left" | "right";

/** `[dx, dy]` for a step direction (grid space: +x right, +y down). */
export const TOWN_DIRECTION_DELTA: Record<TownDirection, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/**
 * What a villager interaction ASKS FOR. `talk` is the default (open the
 * dialogue and just converse); `open` requests the Architect route to one of
 * the real subsystems (shop/cradle/dex/quests/trade) — this module never
 * performs that routing itself, it only describes the request.
 */
export type TownAction = { kind: "open"; target: "shop" | "cradle" | "dex" | "quests" | "trade" } | { kind: "talk" };

/** Build the `TownAction` a villager's role button should fire, or undefined
 *  if this villager has nothing to open (pure banter, e.g. the Storyteller). */
export function actionForVillager(villager: TownVillager): TownAction | undefined {
  if (!villager.opens) return undefined;
  return { kind: "open", target: villager.opens };
}

/** A quest offered through the Questgiver's dialogue (shape only — the
 *  Architect supplies real instances + owns acceptance/progress). */
export interface TownQuest {
  id: string;
  title: string;
  description: string;
}
