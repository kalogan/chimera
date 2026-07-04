/**
 * creature — token → creature. The pure, deterministic expression of a creature
 * from its identity token: family archetype → stats/elements/skills, plus the
 * `gooberSpec` (body) and `crySpec` (voice) that make each one look AND sound
 * distinct. Mirrors `theme.themeFromIdentity` / `createIdentity`: one token in,
 * a whole coherent creature out, FREE and instant, no paid generation.
 *
 * THREE-FREE + PURE: no three, no Math.random, no Date.now. Same token → a
 * deep-equal creature. This is the foundational seam `breeding`, `battle`, and
 * `roster` all build on.
 */

import { createRng, hashStringToSeed, type Rng } from '../prng/index.js';
import { createIdentity } from '../identity/index.js';
import { nameFromToken } from '../naming/index.js';
import { gooberFromToken, type GooberSpec } from './goober.js';
import { cryFromToken } from './cry.js';
import {
  type Creature,
  type CreatureToken,
  type Element,
  type Family,
  type Rank,
  type Skill,
  type SkillKind,
  type StatBlock,
  FAMILIES,
  RANKS,
} from './types.js';

export * from './types.js';
export type { GooberSpec, Ball, Eye, BodyPlan } from './goober.js';
export type { CrySpec } from './cry.js';
export { gooberFromToken } from './goober.js';
export { cryFromToken } from './cry.js';

// ── family archetypes — the coherent bundle per family ──────────────────────

interface FamilyArchetype {
  /** Primary element (a secondary is drawn per-token). */
  element: Element;
  /** Base F-rank stat block; rank + plus scale it up. */
  base: StatBlock;
  /** Size band (0..1) — dragons/golems big, birds/slimes small. */
  size: [number, number];
  /** Skill-name flavour root, e.g. "Ember" → "Ember Fang". */
  skillRoots: readonly string[];
}

const ARCHETYPES: Record<Family, FamilyArchetype> = {
  beast: {
    element: 'earth',
    base: { hp: 34, mp: 8, atk: 14, def: 10, agi: 12, wis: 6 },
    size: [0.35, 0.7],
    skillRoots: ['Fang', 'Maul', 'Rend', 'Pounce'],
  },
  bird: {
    element: 'wind',
    base: { hp: 26, mp: 12, atk: 11, def: 7, agi: 18, wis: 10 },
    size: [0.15, 0.45],
    skillRoots: ['Gust', 'Talon', 'Dive', 'Feather'],
  },
  dragon: {
    element: 'fire',
    base: { hp: 40, mp: 16, atk: 16, def: 13, agi: 9, wis: 12 },
    size: [0.6, 1.0],
    skillRoots: ['Flame', 'Scorch', 'Roar', 'Wyrm'],
  },
  slime: {
    element: 'water',
    base: { hp: 30, mp: 14, atk: 9, def: 12, agi: 8, wis: 11 },
    size: [0.15, 0.45],
    skillRoots: ['Splash', 'Bubble', 'Ooze', 'Wobble'],
  },
  aquatic: {
    element: 'water',
    base: { hp: 32, mp: 15, atk: 12, def: 11, agi: 11, wis: 13 },
    size: [0.3, 0.65],
    skillRoots: ['Tide', 'Surge', 'Brine', 'Whirl'],
  },
  nature: {
    element: 'earth',
    base: { hp: 33, mp: 16, atk: 10, def: 12, agi: 9, wis: 15 },
    size: [0.3, 0.65],
    skillRoots: ['Thorn', 'Bloom', 'Root', 'Spore'],
  },
  golem: {
    element: 'earth',
    base: { hp: 46, mp: 6, atk: 15, def: 18, agi: 5, wis: 5 },
    size: [0.6, 1.0],
    skillRoots: ['Slam', 'Boulder', 'Quake', 'Crush'],
  },
  spirit: {
    element: 'dark',
    base: { hp: 28, mp: 20, atk: 10, def: 8, agi: 13, wis: 18 },
    size: [0.25, 0.55],
    skillRoots: ['Wail', 'Hex', 'Drain', 'Shade'],
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Derive rank: a base draw (F..C) bumped up by the "+value" (every +5 = a rank). */
function rankFor(token: CreatureToken): { rank: Rank; index: number } {
  const rng = createRng(hashStringToSeed(`${token.id}:rank`));
  let idx = rng.int(4); // 0..3 → F..C for a fresh seed
  idx += Math.floor(token.plus / 5) + Math.min(token.generation, 3);
  idx = Math.max(0, Math.min(RANKS.length - 1, idx));
  return { rank: RANKS[idx]!, index: idx };
}

/** Scale a base stat block by rank + plus, with a little per-token jitter. */
function scaleStats(base: StatBlock, rankIdx: number, plus: number, rng: Rng): StatBlock {
  const rankMult = 1 + rankIdx * 0.32;
  const plusMult = 1 + plus * 0.05;
  const j = () => 0.9 + rng.next() * 0.2; // ±10% per stat
  const s = (v: number) => Math.round(v * rankMult * plusMult * j());
  return {
    hp: s(base.hp),
    mp: s(base.mp),
    atk: s(base.atk),
    def: s(base.def),
    agi: s(base.agi),
    wis: s(base.wis),
  };
}

/** Draw a creature's skills — count scales with rank; elements from its affinities. */
function skillsFor(
  token: CreatureToken,
  family: Family,
  elements: Element[],
  rankIdx: number,
): Skill[] {
  const rng = createRng(hashStringToSeed(`${token.id}:skills`));
  const roots = ARCHETYPES[family].skillRoots;
  const count = 2 + Math.floor(rankIdx / 2); // 2..5 skills
  const skills: Skill[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const root = rng.pick(roots);
    const element = rng.pick(elements);
    const kindRoll = rng.next();
    const kind: SkillKind =
      kindRoll < 0.7 ? 'attack' : kindRoll < 0.85 ? 'heal' : kindRoll < 0.93 ? 'buff' : 'debuff';
    const power = kind === 'attack' ? 8 + rankIdx * 4 + rng.int(6) : 6 + rankIdx * 3 + rng.int(5);
    const id = `${family}:${root}:${element}:${kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    skills.push({
      id,
      name: kind === 'heal' ? `${root} Mend` : kind === 'buff' ? `${root} Ward` : `${root} ${cap(element)}`,
      element,
      kind,
      power,
      mpCost: kind === 'attack' ? 2 + rankIdx : 3 + rankIdx,
      target: kind === 'heal' || kind === 'buff' ? 'self' : kind === 'debuff' ? 'one' : 'one',
    });
  }
  // Guarantee at least one attack skill.
  if (!skills.some((s) => s.kind === 'attack')) {
    const element = elements[0]!;
    skills.unshift({
      id: `${family}:${roots[0]}:${element}:attack`,
      name: `${roots[0]} ${cap(element)}`,
      element,
      kind: 'attack',
      power: 8 + rankIdx * 4,
      mpCost: 2 + rankIdx,
      target: 'one',
    });
  }
  return skills;
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Make an authored-seed token from an id string: family is derived from the id
 * hash, plus/generation = 0, no parents. Bred tokens come from `breeding.breed`.
 */
export function seedToken(id: string): CreatureToken {
  const rng = createRng(hashStringToSeed(`${id}:seedfamily`));
  return { id, family: rng.pick(FAMILIES), plus: 0, generation: 0, parents: null };
}

/**
 * Express a creature from its token. Deterministic and pure: same token → a
 * deep-equal creature. Ties body + voice to the token's `identity` (the heart),
 * so two creatures diverge across name, stats, skills, colour, shape, and sound.
 */
export function creatureFromToken(token: CreatureToken): Creature {
  const family = token.family;
  const arche = ARCHETYPES[family];
  const identity = createIdentity(token.id);

  const { rank, index: rankIdx } = rankFor(token);

  // size within the family band, per-token jitter.
  const sizeRng = createRng(hashStringToSeed(`${token.id}:size`));
  const size = arche.size[0] + sizeRng.next() * (arche.size[1] - arche.size[0]);

  // elements: family primary + a secondary drawn from the token.
  const elemRng = createRng(hashStringToSeed(`${token.id}:elements`));
  const elements: Element[] = [arche.element];
  const secondary = elemRng.pick(['fire', 'water', 'earth', 'wind', 'light', 'dark'] as Element[]);
  if (secondary !== arche.element) elements.push(secondary);

  const statRng = createRng(hashStringToSeed(`${token.id}:stats`));
  const stats = scaleStats(arche.base, rankIdx, token.plus, statRng);

  const skills = skillsFor(token, family, elements, rankIdx);

  const baseColor = hexToRgb01(identity.palette.colors.primary);
  const accent = hexToRgb01(identity.palette.colors.accent);
  const gooberSpec = gooberFromToken(token.id, family, size, baseColor, accent);

  const crySpec = cryFromToken(token.id, family, size, rankIdx);

  const name = nameFromToken(token.id, family);

  return { token, name, family, rank, size, elements, stats, skills, gooberSpec, crySpec };
}

// ── memoized body accessor (render-perf) ─────────────────────────────────────
// A goober's body is a pure function of its token's IMMUTABLE identity: id +
// family + an id-seeded size. `plus`/`generation` scale stats and rank but NEVER
// restyle the body, so a spec is safe to build once per token id and reuse for
// the life of the process.
//
// WHY IT MATTERS: consumers that render many goobers per frame (a walkable
// overworld, a party lineup) mesh-memoize on the GooberSpec *reference*. Deriving
// the spec inline in render (`creatureFromToken(token).gooberSpec`) mints a fresh
// object every frame, busting that memo and rebuilding the metaball field solve
// each step — the classic mobile "laggy while walking" symptom. `gooberSpecFor`
// hands back a STABLE reference so the mesh builds once and merely animates after.
const _gooberSpecById = new Map<string, GooberSpec>();

/** The stable, memoized `GooberSpec` for a creature token — built once per id. */
export function gooberSpecFor(token: CreatureToken): GooberSpec {
  const hit = _gooberSpecById.get(token.id);
  if (hit) return hit;
  const spec = creatureFromToken(token).gooberSpec;
  _gooberSpecById.set(token.id, spec);
  return spec;
}

/** The stable, memoized `GooberSpec` for a string-seeded body (ambient/NPC
 *  goobers built from a seed rather than a roster token — e.g. town villagers). */
export function gooberSpecForSeed(seed: string): GooberSpec {
  return gooberSpecFor(seedToken(seed));
}
