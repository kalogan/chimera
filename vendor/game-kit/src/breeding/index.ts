/**
 * breeding — the CROWN JEWEL: `breed(a, b, rng)` deterministically synthesizes two
 * creatures into a NEW child GENOTYPE (a `CreatureToken`). Feed that token to
 * `creatureFromToken` and a whole new creature falls out — art, stats, skills,
 * name, voice — DISTINCT from both parents. Modeled on DQM monster-breeding:
 *   - a fixed, symmetric FAMILY-COMBINATION table (beast+bird → dragon, …),
 *   - rank-up via the "+value" and generation depth climbing each cross,
 *   - stable lineage (parents + a seed-derived id), and
 *   - SKILL inheritance + DQM skill-COMBINING (two skills fuse into one stronger).
 *
 * THREE-FREE + PURE + DETERMINISTIC: no three, no Math.random, no Date.now.
 * Randomness comes ONLY from the passed-in `Rng`, so the same `(a, b, seed)` always
 * yields a deep-equal `BreedResult`. This is the seam the Architect assembles on.
 */

import {
  creatureFromToken,
  ELEMENTS,
  type Creature,
  type CreatureToken,
  type Element,
  type Family,
  type Rank,
  type Skill,
} from '../creature/index.js';
import type { Rng } from '../prng/index.js';

// Re-export the seam type so the value `creatureFromToken` need not be re-imported
// by consumers that only want to express the produced token.
export { creatureFromToken };

/**
 * The genetic outcome of a cross. `childToken` is the money output — the genotype
 * you express with `creatureFromToken`. The skill fields describe the DQM breeding
 * ceremony: which skills carried over and which fused.
 */
export interface BreedResult {
  /** The synthesized GENOTYPE — feed to `creatureFromToken` to get the new creature. */
  childToken: CreatureToken;
  /** Skills carried from the parents (a deterministic subset of their union, dedup by id). */
  inheritedSkills: Skill[];
  /** Fused/upgraded skills — DQM skill-combining (each strictly stronger than its sources). */
  comboSkills: Skill[];
  /** Resulting child rank (expressed from the child token). */
  rank: Rank;
  /** Resulting child family (from the combination table). */
  family: Family;
}

// ── family combination — a fixed, SYMMETRIC 8×8 table ───────────────────────
//
// Same-family pairs breed true. Cross-family pairs resolve to a legible hybrid.
// The table is authored on the alphabetically-sorted pair so it is inherently
// order-independent: breedFamily(a, b) === breedFamily(b, a).
//
// Theme of the table:
//   • dragon DOMINATES most physical mixes (the apex fusion),
//   • the marquee FUSION beast+bird → dragon (a winged beast becomes a wyrm),
//   • spirit is INFECTIOUS — spirit-leaning results bleed across families,
//   • aquatic beats slime, golem is the heavy, nature roots the middle.

const FAMILY_COMBOS: Readonly<Record<string, Family>> = Object.freeze({
  // aquatic + …
  'aquatic+beast': 'aquatic',
  'aquatic+bird': 'aquatic',
  'aquatic+dragon': 'dragon',
  'aquatic+golem': 'aquatic',
  'aquatic+nature': 'nature',
  'aquatic+slime': 'aquatic',
  'aquatic+spirit': 'spirit',
  // beast + …
  'beast+bird': 'dragon', // ← the marquee fusion
  'beast+dragon': 'dragon',
  'beast+golem': 'golem',
  'beast+nature': 'beast',
  'beast+slime': 'beast',
  'beast+spirit': 'spirit',
  // bird + …
  'bird+dragon': 'dragon',
  'bird+golem': 'golem',
  'bird+nature': 'nature',
  'bird+slime': 'bird',
  'bird+spirit': 'spirit',
  // dragon + …
  'dragon+golem': 'dragon',
  'dragon+nature': 'dragon',
  'dragon+slime': 'dragon',
  'dragon+spirit': 'dragon',
  // golem + …
  'golem+nature': 'golem',
  'golem+slime': 'golem',
  'golem+spirit': 'spirit',
  // nature + …
  'nature+slime': 'nature',
  'nature+spirit': 'spirit',
  // slime + …
  'slime+spirit': 'spirit',
});

/**
 * Deterministically combine two families. Order-independent
 * (`breedFamily(a, b) === breedFamily(b, a)`): same-family pairs breed true,
 * cross-family pairs resolve via the fixed combination table.
 */
export function breedFamily(a: Family, b: Family): Family {
  if (a === b) return a;
  const key = a < b ? `${a}+${b}` : `${b}+${a}`;
  const out = FAMILY_COMBOS[key];
  if (out === undefined) {
    // Unreachable: the table covers every unordered cross-family pair.
    throw new Error(`breedFamily: no combination for ${key}`);
  }
  return out;
}

// ── skill inheritance + combining ────────────────────────────────────────────

/** Elements that FUSE even without an exact match — complementary opposites. */
const COMPATIBLE_PAIRS: ReadonlyArray<readonly [Element, Element]> = [
  ['fire', 'wind'], // wildfire
  ['water', 'earth'], // fertile silt
  ['light', 'dark'], // twilight
];

function dedupById(skills: readonly Skill[]): Skill[] {
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const s of skills) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/** Deterministic Fisher–Yates shuffle driven by the passed rng. */
function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** The strongest skill of a given element in a set, or undefined if none. */
function strongestOfElement(skills: readonly Skill[], el: Element): Skill | undefined {
  let best: Skill | undefined;
  for (const s of skills) {
    if (s.element === el && (best === undefined || s.power > best.power)) best = s;
  }
  return best;
}

function firstWord(name: string): string {
  const w = name.split(' ')[0];
  return w && w.length > 0 ? w : name;
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Fuse two parent skills into ONE stronger skill (DQM skill-combining). The fused
 * skill is STRICTLY stronger than either source (power is their sum) and carries a
 * new, legible name and a stable id derived from both sources.
 */
function fuse(sa: Skill, sb: Skill, element: Element): Skill {
  const attack = sa.kind === 'attack' || sb.kind === 'attack';
  return {
    id: `combo:${element}:${sa.id}+${sb.id}`,
    name: `${firstWord(sa.name)}-${firstWord(sb.name)} ${cap(element)}`,
    element,
    kind: attack ? 'attack' : sa.kind,
    power: sa.power + sb.power, // strictly greater than either source
    mpCost: sa.mpCost + sb.mpCost,
    target: attack ? 'all' : sa.target,
  };
}

/**
 * Build the fused skills for a cross. First, every element BOTH parents wield fuses
 * (each parent's strongest skill of that element combine). If the parents share NO
 * element outright, a single COMPATIBLE pairing (e.g. fire×wind) fuses instead. Each
 * result is strictly stronger than every parent skill of the fused element.
 */
function comboSkillsFor(a: Creature, b: Creature): Skill[] {
  const combos: Skill[] = [];
  let sharedAny = false;

  for (const el of ELEMENTS) {
    const sa = strongestOfElement(a.skills, el);
    const sb = strongestOfElement(b.skills, el);
    if (sa && sb) {
      sharedAny = true;
      combos.push(fuse(sa, sb, el));
    }
  }

  // Only reach for a compatible cross when nothing was shared outright. Because no
  // element is shared here, the assigned element is absent from the *other* parent,
  // so the fused power still dominates every parent skill of that element.
  if (!sharedAny) {
    for (const [ex, ey] of COMPATIBLE_PAIRS) {
      const ax = strongestOfElement(a.skills, ex);
      const by = strongestOfElement(b.skills, ey);
      if (ax && by) {
        combos.push(fuse(ax, by, ex));
        break;
      }
      const ay = strongestOfElement(a.skills, ey);
      const bx = strongestOfElement(b.skills, ex);
      if (ay && bx) {
        combos.push(fuse(ay, bx, ey));
        break;
      }
    }
  }

  return combos;
}

// ── the crown-jewel entry point ──────────────────────────────────────────────

/**
 * Breed two creatures into a new child. Deterministic and pure: the same
 * `(a, b, rng-seed)` always produces a deep-equal `BreedResult`.
 *
 * The child token climbs the lineage — `plus = max(parents.plus) + 1`,
 * `generation = max(parents.generation) + 1`, `family = breedFamily(...)`, and a
 * stable `id` woven from BOTH parent ids plus one rng draw (so the seed selects
 * WHICH sibling you get, while the same seed + parents always yields the same
 * child). Expressing `childToken` with `creatureFromToken` gives a creature
 * distinct from either parent.
 */
export function breed(a: Creature, b: Creature, rng: Rng): BreedResult {
  const family = breedFamily(a.token.family, b.token.family);
  const plus = Math.max(a.token.plus, b.token.plus) + 1;
  const generation = Math.max(a.token.generation, b.token.generation) + 1;
  const parents: readonly [string, string] = [a.token.id, b.token.id];

  // One rng draw picks WHICH child of this pairing we get — same seed → same draw.
  const draw = rng.int(0x7fffffff);
  const id = `bred:${a.token.id}+${b.token.id}~${draw.toString(36)}`;

  const childToken: CreatureToken = { id, family, plus, generation, parents };

  // Inheritance: a deterministic subset of the parents' de-duplicated skill union.
  const union = dedupById([...a.skills, ...b.skills]);
  const order = shuffled(union, rng.fork(0x1efaa)); // independent, seed-stable stream
  const keep = Math.max(1, Math.ceil(union.length / 2));
  const inheritedSkills = order.slice(0, keep);

  const comboSkills = comboSkillsFor(a, b);

  const child = creatureFromToken(childToken);

  return {
    childToken,
    inheritedSkills,
    comboSkills,
    rank: child.rank,
    family,
  };
}
