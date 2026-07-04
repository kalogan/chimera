/**
 * creature/types — the LOAD-BEARING SEAM every pure module shares.
 *
 * These are the disjoint-Builder contract: `breeding` produces a `CreatureToken`,
 * `battle` and `roster` operate on `Creature`, and the renderer consumes
 * `GooberSpec`/`CrySpec`. Keeping them in one THREE-FREE file means every module
 * codes against a fixed shape. Do not add three imports here.
 */

import type { GooberSpec } from './goober.js';
import type { CrySpec } from './cry.js';

/** The eight monster families (DQM-style). */
export type Family =
  | 'beast'
  | 'bird'
  | 'dragon'
  | 'slime'
  | 'aquatic'
  | 'nature'
  | 'golem'
  | 'spirit';

export const FAMILIES: readonly Family[] = [
  'beast',
  'bird',
  'dragon',
  'slime',
  'aquatic',
  'nature',
  'golem',
  'spirit',
];

/** The six elements. Weakness/resistance is applied by `battle`. */
export type Element = 'fire' | 'water' | 'earth' | 'wind' | 'light' | 'dark';

export const ELEMENTS: readonly Element[] = ['fire', 'water', 'earth', 'wind', 'light', 'dark'];

/** Ranks F (weakest) → S (strongest), the DQM arena spine. */
export type Rank = 'F' | 'E' | 'D' | 'C' | 'B' | 'A' | 'S';

export const RANKS: readonly Rank[] = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

/** The six battle stats. */
export interface StatBlock {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
  wis: number;
}

export type SkillKind = 'attack' | 'heal' | 'buff' | 'debuff';

/** A learnable/usable skill. `battle` consumes these; `breeding` inherits them. */
export interface Skill {
  /** Stable id (used for inheritance/combining and de-dup). */
  id: string;
  name: string;
  element: Element;
  kind: SkillKind;
  /** Base potency (damage for attack, heal amount, buff/debuff magnitude). */
  power: number;
  mpCost: number;
  target: 'one' | 'all' | 'self' | 'ally';
}

/**
 * The GENOTYPE — a creature's identity token. Authored seeds use `seedToken`;
 * bred creatures get a token synthesized by `breeding.breed`. `creatureFromToken`
 * expresses this into a full `Creature` (the phenotype). Fully serializable.
 */
export interface CreatureToken {
  /** Primary identity seed string — hashes to everything derived. */
  id: string;
  /** Resolved family (seeds derive it from `id`; bred tokens get it from the combo table). */
  family: Family;
  /** Rank-up "+value" accumulated through breeding (DQM "+N"). >= 0. */
  plus: number;
  /** Generation depth: 0 = authored seed, 1 = first bred, … */
  generation: number;
  /** Lineage: parent token ids, or null for authored seeds. */
  parents: readonly [string, string] | null;
}

/**
 * The PHENOTYPE — everything a creature IS, expressed from its token. Deterministic:
 * `creatureFromToken(token)` is a pure function, so the same token always yields
 * a deep-equal creature (body, voice, stats, skills, name).
 */
export interface Creature {
  token: CreatureToken;
  /** Procedural species name (from `naming`). */
  name: string;
  family: Family;
  rank: Rank;
  /** 0..1 size (drives goober scale + cry register). */
  size: number;
  /** Elemental affinities (primary first) — used for STAB + resistances. */
  elements: Element[];
  /** Base/max stats. */
  stats: StatBlock;
  skills: Skill[];
  /** The token→body data the renderer consumes. */
  gooberSpec: GooberSpec;
  /** The token→voice data the audio layer synthesizes. */
  crySpec: CrySpec;
}
