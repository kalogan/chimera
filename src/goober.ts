/**
 * goober — a critter is ~a dozen numbers: a list of metaballs (primitive spheres)
 * that fuse into one seamless toon body. Generated DETERMINISTICALLY from a seed
 * (stand-in for the identity token), so the same seed → the same critter, and
 * "breeding" later = mixing two seeds. This is the CHIMERA creature spike.
 */

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

export type BodyPlan = "blob" | "quadruped" | "biped" | "hopper" | "spider";

export interface CritterSpec {
  plan: BodyPlan;
  balls: Ball[];
  eyes: Eye[];
  baseColor: [number, number, number];
}

// mulberry32 seeded rng
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// pastel-ish hsl → rgb for cute palettes
function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const PLANS: BodyPlan[] = ["blob", "quadruped", "biped", "hopper", "spider"];

/** Generate a cute critter spec from a seed. Body plan + palette + features vary. */
export function critterFromSeed(seed: number): CritterSpec {
  const r = rng(seed);
  const plan = PLANS[Math.floor(r() * PLANS.length)]!;
  const hue = r();
  const baseColor = hsl(hue, 0.55, 0.55);
  const accent = hsl((hue + 0.5) % 1, 0.6, 0.6);
  const balls: Ball[] = [];
  const push = (x: number, y: number, z: number, s: number, c = baseColor) => balls.push({ x, y, z, s, color: c });

  const bodyR = 0.55 + r() * 0.25;
  let headY = 0;
  let headZ = 0;

  if (plan === "blob" || plan === "hopper") {
    push(0, bodyR, 0, bodyR * 1.15);
    push(0, bodyR * 1.7, bodyR * 0.35, bodyR * 0.75); // head merged into body (teardrop)
    headY = bodyR * 1.9;
    headZ = bodyR * 0.5;
    if (r() > 0.4) push(0, bodyR * 2.4, 0, bodyR * 0.18, accent); // little sprout/antenna
  } else if (plan === "quadruped") {
    push(-bodyR * 0.5, bodyR * 0.9, 0, bodyR);
    push(bodyR * 0.5, bodyR * 0.9, 0, bodyR * 0.9); // elongated body
    push(bodyR * 1.1, bodyR * 1.1, 0, bodyR * 0.55); // head front
    headY = bodyR * 1.2;
    headZ = bodyR * 1.5;
    for (const [dx, dz] of [[-0.4, 0.35], [0.4, 0.35], [-0.4, -0.35], [0.4, -0.35]] as const)
      push(dx * bodyR * 1.7, bodyR * 0.3, dz * bodyR, bodyR * 0.42); // legs
    if (r() > 0.5) push(bodyR * 1.5, bodyR * 1.5, 0, bodyR * 0.16, accent); // horn
  } else if (plan === "biped") {
    push(0, bodyR * 1.1, 0, bodyR);
    push(0, bodyR * 2.0, bodyR * 0.2, bodyR * 0.7); // head
    headY = bodyR * 2.2;
    headZ = bodyR * 0.6;
    push(-bodyR * 0.42, bodyR * 0.28, 0, bodyR * 0.4); // legs
    push(bodyR * 0.42, bodyR * 0.28, 0, bodyR * 0.4);
    for (const dx of [-0.55, 0.55]) push(dx * bodyR, bodyR * 2.7, 0, bodyR * 0.2, accent); // ears
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

  // eyes on the head, forward + slightly up, spaced by x
  const eyeR = 0.1 + r() * 0.05;
  const eyeSpread = 0.18 + r() * 0.08;
  const eyes: Eye[] = [
    { x: -eyeSpread, y: headY, z: headZ + 0.05, r: eyeR },
    { x: eyeSpread, y: headY, z: headZ + 0.05, r: eyeR },
  ];

  return { plan, balls, eyes, baseColor };
}
