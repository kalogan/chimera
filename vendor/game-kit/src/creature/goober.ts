/**
 * creature/goober — the token→body data the renderer consumes. Promoted from the
 * validated `chimera` spike (`src/goober.ts`): a creature body is ~a dozen numbers
 * — a list of metaballs (primitive spheres) that fuse into one seamless toon blob
 * — plus a pair of eyes. Generated DETERMINISTICALLY, now FAMILY-BIASED (a dragon
 * gets horns + wings, a golem is blockier, a spirit floats) and IDENTITY-COLOURED
 * (body/accent colours come from the token's identity palette). FREE per creature.
 *
 * PURE + THREE-FREE: emits plain numbers only; the R3F `Goober` component turns
 * `balls` into a MarchingCubes field and `eyes` into little spheres. Same token →
 * same body; breeding a new token → a new, visibly distinct body.
 */

import { createRng, hashStringToSeed, type Rng } from '../prng/index.js';
import type { Family } from './types.js';

export interface Ball {
  x: number;
  y: number;
  z: number;
  /** metaball strength (~size). */
  s: number;
  /** rgb 0..1 */
  color: [number, number, number];
}

export interface Eye {
  x: number;
  y: number;
  z: number;
  r: number;
}

export type BodyPlan = 'blob' | 'quadruped' | 'biped' | 'hopper' | 'spider';

export interface GooberSpec {
  plan: BodyPlan;
  balls: Ball[];
  eyes: Eye[];
  baseColor: [number, number, number];
  /** Overall world-scale multiplier from the creature's size (small→big). */
  scale: number;
}

/** Family → weighted body-plan preferences. First entry is the most likely. */
const FAMILY_PLANS: Record<Family, BodyPlan[]> = {
  beast: ['quadruped', 'quadruped', 'biped'],
  bird: ['biped', 'hopper'],
  dragon: ['quadruped', 'biped'],
  slime: ['blob', 'blob', 'hopper'],
  aquatic: ['blob', 'hopper'],
  nature: ['biped', 'blob'],
  golem: ['biped', 'quadruped'],
  spirit: ['blob', 'hopper'],
};

/**
 * Derive a goober body from token id + family + size + palette colours.
 * `baseColorRgb`/`accentRgb` are 0..1 rgb triples (from the identity palette).
 */
export function gooberFromToken(
  id: string,
  family: Family,
  size: number,
  baseColorRgb: [number, number, number],
  accentRgb: [number, number, number],
): GooberSpec {
  const r: Rng = createRng(hashStringToSeed(`${id}:goober:${family}`));
  const baseColor = baseColorRgb;
  const accent = accentRgb;

  const planPool = FAMILY_PLANS[family];
  const plan = r.pick(planPool);

  const balls: Ball[] = [];
  const push = (x: number, y: number, z: number, s: number, c = baseColor) =>
    balls.push({ x, y, z, s, color: c });

  // golems read chunkier; slimes/spirits softer. bodyR ~ 0.55..0.85.
  const chunk = family === 'golem' ? 1.15 : family === 'slime' ? 0.9 : 1;
  const bodyR = (0.55 + r.next() * 0.25) * chunk;
  let headY = 0;
  let headZ = 0;

  if (plan === 'blob' || plan === 'hopper') {
    push(0, bodyR, 0, bodyR * 1.15);
    push(0, bodyR * 1.7, bodyR * 0.35, bodyR * 0.75); // head merged (teardrop)
    headY = bodyR * 1.9;
    headZ = bodyR * 0.5;
    if (r.next() > 0.4) push(0, bodyR * 2.4, 0, bodyR * 0.18, accent); // sprout/antenna
  } else if (plan === 'quadruped') {
    push(-bodyR * 0.5, bodyR * 0.9, 0, bodyR);
    push(bodyR * 0.5, bodyR * 0.9, 0, bodyR * 0.9); // elongated body
    push(bodyR * 1.1, bodyR * 1.1, 0, bodyR * 0.55); // head front
    headY = bodyR * 1.2;
    headZ = bodyR * 1.5;
    for (const [dx, dz] of [
      [-0.4, 0.35],
      [0.4, 0.35],
      [-0.4, -0.35],
      [0.4, -0.35],
    ] as const)
      push(dx * bodyR * 1.7, bodyR * 0.3, dz * bodyR, bodyR * 0.42); // legs
  } else if (plan === 'biped') {
    push(0, bodyR * 1.1, 0, bodyR);
    push(0, bodyR * 2.0, bodyR * 0.2, bodyR * 0.7); // head
    headY = bodyR * 2.2;
    headZ = bodyR * 0.6;
    push(-bodyR * 0.42, bodyR * 0.28, 0, bodyR * 0.4); // legs
    push(bodyR * 0.42, bodyR * 0.28, 0, bodyR * 0.4);
    push(-bodyR * 0.9, bodyR * 1.2, 0, bodyR * 0.25); // arms
    push(bodyR * 0.9, bodyR * 1.2, 0, bodyR * 0.25);
  } else {
    // spider
    push(0, bodyR * 0.9, 0, bodyR);
    headY = bodyR * 1.1;
    headZ = bodyR * 0.9;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      push(Math.cos(a) * bodyR * 1.5, bodyR * 0.35, Math.sin(a) * bodyR * 1.5, bodyR * 0.34);
    }
  }

  // ── family features — the silhouette flavour that makes a family legible ──
  if (family === 'dragon') {
    // a pair of horns + stubby wings
    push(-bodyR * 0.25, headY + bodyR * 0.4, headZ - bodyR * 0.2, bodyR * 0.16, accent);
    push(bodyR * 0.25, headY + bodyR * 0.4, headZ - bodyR * 0.2, bodyR * 0.16, accent);
    push(-bodyR * 1.1, bodyR * 1.4, -bodyR * 0.4, bodyR * 0.34, accent);
    push(bodyR * 1.1, bodyR * 1.4, -bodyR * 0.4, bodyR * 0.34, accent);
  } else if (family === 'bird') {
    // wings out to the sides
    push(-bodyR * 1.15, bodyR * 1.1, -bodyR * 0.2, bodyR * 0.4, accent);
    push(bodyR * 1.15, bodyR * 1.1, -bodyR * 0.2, bodyR * 0.4, accent);
    push(0, headY, headZ + bodyR * 0.3, bodyR * 0.14, accent); // little beak
  } else if (family === 'golem') {
    // a shoulder/crown chunk — reads as armoured
    push(0, headY + bodyR * 0.3, 0, bodyR * 0.3, accent);
  } else if (family === 'spirit') {
    // a floaty wisp trailing below
    push(0, bodyR * 0.2, 0, bodyR * 0.5, accent);
  } else if (family === 'nature') {
    // a leaf sprout
    push(bodyR * 0.2, headY + bodyR * 0.5, 0, bodyR * 0.2, accent);
  } else if (family === 'aquatic') {
    // a dorsal fin
    push(0, bodyR * 1.6, -bodyR * 0.5, bodyR * 0.28, accent);
  } else if (family === 'beast' && r.next() > 0.5) {
    push(bodyR * 1.5, bodyR * 1.5, 0, bodyR * 0.16, accent); // horn
  }

  // eyes on the head, forward + slightly up
  const eyeR = 0.1 + r.next() * 0.05;
  const eyeSpread = 0.18 + r.next() * 0.08;
  const eyes: Eye[] = [
    { x: -eyeSpread, y: headY, z: headZ + 0.05, r: eyeR },
    { x: eyeSpread, y: headY, z: headZ + 0.05, r: eyeR },
  ];

  // size (0..1) → world scale. small ~0.8, big ~1.4.
  const scale = 0.8 + Math.max(0, Math.min(1, size)) * 0.6;

  return { plan, balls, eyes, baseColor, scale };
}
