/**
 * creature-dex — a pure DERIVATION layer that turns a `Creature` (already
 * expressed from its token by `creatureFromToken`) into the extra bestiary
 * fields the Polymatrix-style Dex wants: rarity, a lore title, a flavor
 * blurb, a habitat, a small drop list, and REAL elemental matchups.
 *
 * Nothing here is authored per-creature. Every field is derived from the
 * token's family/rank/elements (plus the token id as a deterministic seed),
 * so every bred/generated creature — not just hand-picked ones — gets a full
 * Dex entry for free. THREE-FREE + PURE: no three, no Math.random, no
 * Date.now; same creature in → deep-equal derivation out.
 *
 * `matchups` is NOT invented — it replicates `game-kit/battle`'s real
 * ELEMENT_CHART (fire↔wind↔earth↔water cycle + light↔dark opposition) so the
 * Dex tells the truth about what a creature is weak to / resists. See the
 * note above `ELEMENT_CHART` below for why this is a copy rather than an
 * import.
 */
import { createRng, hashStringToSeed } from "game-kit/prng";
import type { Creature, Element, Family, Rank } from "game-kit/creature";

// ── rarity ────────────────────────────────────────────────────────────────

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** F/E → common, D/C → uncommon, B → rare, A → epic, S → legendary. */
export const RANK_RARITY: Record<Rank, Rarity> = {
  F: "common",
  E: "common",
  D: "uncommon",
  C: "uncommon",
  B: "rare",
  A: "epic",
  S: "legendary",
};

/** Warm-toned rarity accents — cohesive with CHIMERA's parchment/warm HUD
 *  rather than Polymatrix's cyber palette, but keeping a legible common→
 *  legendary ramp (grey → green → blue → violet → gold). */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#9a9186",
  uncommon: "#5f9d6f",
  rare: "#5b8fc7",
  epic: "#9a5fc9",
  legendary: "#e0a83a",
};

export function rarityFor(rank: Rank): Rarity {
  return RANK_RARITY[rank];
}

// ── family color (element-flavoured, not literal element color) ───────────

/** One accent per family — used for badges/strokes so a card reads at a
 *  glance even before you know its element. Chosen to riff on each family's
 *  primary element (see ARCHETYPES in game-kit/creature) without clashing
 *  with the warm/parchment chrome. */
export const FAMILY_COLOR: Record<Family, string> = {
  beast: "#a9713f",
  bird: "#8fb8d8",
  dragon: "#d1663a",
  slime: "#6aa6d8",
  aquatic: "#4d8fae",
  nature: "#6fa85a",
  golem: "#8a8272",
  spirit: "#8768b0",
};

/** Vivid per-element accents — used for matchup pills, kept saturated so
 *  weak/resist tags stay legible over the warm parchment background. */
export const ELEMENT_COLOR: Record<Element, string> = {
  fire: "#d9622f",
  water: "#3f8fd1",
  earth: "#8a6a3a",
  wind: "#5fb894",
  light: "#e8c85a",
  dark: "#6a5a8a",
};

// ── the real element chart (mirrors game-kit/battle/element.ts) ───────────
//
// game-kit's `battle/element.ts` does not export `ELEMENT_CHART` through the
// package's public subpath map that this app's alias resolves (`game-kit/battle`
// re-exports it, but only alongside the whole battle reducer — pulling that
// module in here would drag turn-loop/combatant code into a Dex-only bundle
// for no reason). We DELIBERATELY replicate the exact same table rather than
// invent a new one — this MUST stay byte-for-byte in sync with
// `vendor/game-kit/src/battle/element.ts`'s `ELEMENT_CHART`. The Dex's
// "Weak to / Resists" section is worthless if it lies about combat.
const ELEMENT_CHART: Readonly<Record<Element, readonly Element[]>> = {
  fire: ["wind"],
  wind: ["earth"],
  earth: ["water"],
  water: ["fire"],
  light: ["dark"],
  dark: ["light"],
};

export interface Matchups {
  /** Elements THIS creature is weak to (an attacker using this element deals
   *  super-effective damage to it) — real chart, not invented. */
  weakTo: Element[];
  /** Elements THIS creature resists (an attacker using this element deals
   *  reduced damage to it) — real chart, not invented. */
  resists: Element[];
}

/**
 * A creature is weak to element `a` when `a` beats one of the creature's own
 * elements (mirrors `battle/element.ts`'s `effectiveness()` from the
 * DEFENDER's point of view). It resists `a` when one of its own elements
 * beats `a`. Matches `effectiveness(attack, defenderElements)` exactly.
 */
export function matchupsFor(elements: readonly Element[]): Matchups {
  const weakTo = new Set<Element>();
  const resists = new Set<Element>();
  const all = Object.keys(ELEMENT_CHART) as Element[];
  for (const attack of all) {
    const beats = ELEMENT_CHART[attack];
    const isWeak = elements.some((d) => beats.includes(d));
    if (isWeak) {
      weakTo.add(attack);
      continue; // weak wins ties, same as battle/element.ts's effectiveness()
    }
    const isResisted = elements.some((d) => ELEMENT_CHART[d].includes(attack));
    if (isResisted) resists.add(attack);
  }
  return { weakTo: [...weakTo], resists: [...resists] };
}

// ── habitat ─────────────────────────────────────────────────────────────

const HABITAT_BY_FAMILY: Record<Family, string> = {
  beast: "Meadowmere",
  bird: "Meadowmere",
  nature: "Meadowmere",
  dragon: "Emberdeep",
  golem: "Emberdeep",
  aquatic: "Tidewrack",
  slime: "Tidewrack",
  spirit: "the wilds",
};

export function habitatFor(family: Family): string {
  return HABITAT_BY_FAMILY[family];
}

// ── seeded lore templates ──────────────────────────────────────────────
//
// All templates below are picked deterministically from the token id (via
// `hashStringToSeed` + `createRng`, the same primitives `creatureFromToken`
// itself uses) — never `Math.random()` — so a given creature always gets the
// same title/flavor/drops across renders and sessions.

const TITLE_TEMPLATES: Record<Family, readonly string[]> = {
  beast: ["The Wildfang", "The Trail-Runner", "The Thicket Prowler", "The Old Claw"],
  bird: ["The Windcaller", "The High Wanderer", "Sky's Own", "The Gale-Feather"],
  dragon: ["The Cinder-Born", "The Ember Wyrm", "The Scorch Sovereign", "The Last Flame"],
  slime: ["The Wobbling Thing", "The Puddle-Kin", "The Ooze Wanderer", "The Soft One"],
  aquatic: ["Tide's Whisper", "The Deep Current", "The Brine Wanderer", "The Undertow"],
  nature: ["The Root-Bound", "The Bloomkeeper", "The Quiet Grower", "The Green Warden"],
  golem: ["The Stonebound", "The Old Foundation", "The Quarryborn", "The Standing Stone"],
  spirit: ["The Hollow Sigh", "The Half-Remembered", "The Dusk Wanderer", "The Fading Voice"],
};

const FLAVOR_TEMPLATES: Record<Family, readonly string[]> = {
  beast: [
    "Runs the Meadowmere trails at dusk, more shadow than shape until it wants to be seen.",
    "Marks its territory in claw-scratches on old fence posts and does not apologize for it.",
  ],
  bird: [
    "Rides the thermals over Meadowmere for hours at a stretch, singing to no one in particular.",
    "Nests high and low alike — it has never once been caught by surprise from above.",
  ],
  dragon: [
    "Sleeps curled around banked embers in Emberdeep, and wakes cross about being disturbed.",
    "Its breath still smells faintly of the forge that first shaped its kind.",
  ],
  slime: [
    "Squelches through Tidewrack's shallows, absorbing whatever the tide leaves behind.",
    "Keeps no fixed shape and no fixed opinions — it agrees with whoever fed it last.",
  ],
  aquatic: [
    "Surfaces in Tidewrack only at slack tide, when the water holds still long enough to watch.",
    "Old sailors swear it can be heard humming just under the waterline.",
  ],
  nature: [
    "Grows a little more of Meadowmere into itself with every passing season.",
    "Blooms even in the deep of winter, stubborn as anything rooted ever was.",
  ],
  golem: [
    "Quarried from Emberdeep's oldest stone, it moves like the mountain remembers how to walk.",
    "Stood so still for so long that moss mistook it for a boulder — some still hasn't left.",
  ],
  spirit: [
    "Drifts at the edge of the wilds, more felt than seen, never quite all the way here.",
    "Remembers a name it no longer answers to, and hums it sometimes when it thinks no one's near.",
  ],
};

const DROP_POOL_BY_FAMILY: Record<Family, readonly string[]> = {
  beast: ["Tuft of Fur", "Cracked Claw", "Sunworn Hide", "Trail Dust"],
  bird: ["Downy Feather", "Hollow Bone", "Windswept Plume", "Cloudglass Shard"],
  dragon: ["Ember Scale", "Cinder Fang", "Molten Core Sliver", "Scorched Talon"],
  slime: ["Sticky Residue", "Ooze Core", "Pigment Gel", "Wobbling Jelly"],
  aquatic: ["Brine Pearl", "Tide-Worn Shell", "Kelp Strand", "Driftglass"],
  nature: ["Bloomseed", "Bark Shaving", "Root Tendril", "Petal Dust"],
  golem: ["Chipped Stone", "Ore Fragment", "Quarry Dust", "Ancient Rivet"],
  spirit: ["Faded Wisp", "Hollow Echo", "Grey Ash", "Forgotten Charm"],
};

/** Deterministic per-token rng, forked off the same seed space
 *  `creatureFromToken` uses (`hashStringToSeed`) but salted for this module
 *  so it never collides with the kit's own per-token rng streams. */
function dexRng(tokenId: string) {
  return createRng(hashStringToSeed(`${tokenId}:dex`));
}

export function titleFor(tokenId: string, family: Family): string {
  return dexRng(tokenId).fork(1).pick(TITLE_TEMPLATES[family]);
}

export function flavorFor(tokenId: string, family: Family): string {
  return dexRng(tokenId).fork(2).pick(FLAVOR_TEMPLATES[family]);
}

/** A small (2-item) seeded loot list, drawn without repeats from the
 *  family's drop pool. */
export function dropsFor(tokenId: string, family: Family): string[] {
  const pool = DROP_POOL_BY_FAMILY[family];
  const rng = dexRng(tokenId).fork(3);
  const first = rng.pick(pool);
  let second = rng.pick(pool);
  // Every pool has >= 4 entries, so a bounded retry always terminates.
  for (let guard = 0; second === first && guard < 8; guard++) {
    second = rng.pick(pool);
  }
  return [first, second];
}

// ── the whole derived bundle ────────────────────────────────────────────

export interface DerivedDex {
  rarity: Rarity;
  rarityColor: string;
  familyColor: string;
  title: string;
  flavorText: string;
  habitat: string;
  drops: string[];
  matchups: Matchups;
}

/** Derive every bestiary field for a creature. Pure: same creature in →
 *  deep-equal `DerivedDex` out. */
export function deriveDex(creature: Creature): DerivedDex {
  const { token, family, rank, elements } = creature;
  return {
    rarity: rarityFor(rank),
    rarityColor: RARITY_COLOR[rarityFor(rank)],
    familyColor: FAMILY_COLOR[family],
    title: titleFor(token.id, family),
    flavorText: flavorFor(token.id, family),
    habitat: habitatFor(family),
    drops: dropsFor(token.id, family),
    matchups: matchupsFor(elements),
  };
}
