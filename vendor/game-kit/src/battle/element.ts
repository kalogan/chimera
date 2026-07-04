/**
 * battle/element — the elemental weakness ring.
 *
 * THREE-FREE / PURE: no `three`, no DOM, no randomness. Pure lookup tables so the
 * render/juice/audio layers can read the SAME chart the reducer uses (e.g. scale
 * a hit sound by effectiveness) without re-deriving combat.
 *
 * The ring is a legible 4-cycle for the classical elements plus a mutual
 * "opposition" for light/dark:
 *
 *   water  →  fire  →  wind  →  earth  →  water   (each beats the next)
 *   light  ↔  dark                                (each beats the OTHER)
 *
 * `ELEMENT_CHART[a]` lists the elements `a` is SUPER-EFFECTIVE against (a "weak"
 * hit, ×1.5). An attack is RESISTED (×0.5) when the defender is instead strong
 * against the attacker. Light vs dark is mutually super-effective (both weak,
 * never resist) — they annihilate, which keeps the pair high-stakes.
 */

import type { Element } from '../creature/types.js';

/** Effectiveness of an attack against a defender. */
export type Effectiveness = 'weak' | 'normal' | 'resist';

/**
 * For each element, the elements it deals SUPER-EFFECTIVE ("weak") damage to.
 * Read-only so consumers can't mutate the shared ring.
 */
export const ELEMENT_CHART: Readonly<Record<Element, readonly Element[]>> = {
  fire: ['wind'],
  wind: ['earth'],
  earth: ['water'],
  water: ['fire'],
  light: ['dark'],
  dark: ['light'],
};

/** Damage multiplier applied per effectiveness tier. */
export const EFFECTIVENESS_MULTIPLIER: Readonly<Record<Effectiveness, number>> = {
  weak: 1.5,
  normal: 1,
  resist: 0.5,
};

/**
 * Resolve how an `attack` element fares against a defender's element list.
 *
 *   - 'weak'   — the attack is super-effective against ANY defender element.
 *   - 'resist' — no super-effective match, but SOME defender element is strong
 *                against the attack (it resists).
 *   - 'normal' — neither.
 *
 * `weak` wins ties (so light→dark, whose pair is mutually strong, reads as weak).
 */
export function effectiveness(
  attack: Element,
  defenderElements: readonly Element[],
): Effectiveness {
  const beats = ELEMENT_CHART[attack];
  for (const d of defenderElements) {
    if (beats.includes(d)) return 'weak';
  }
  for (const d of defenderElements) {
    if (ELEMENT_CHART[d].includes(attack)) return 'resist';
  }
  return 'normal';
}
