import { describe, it, expect } from 'vitest';
import { nameFromToken, type NameFamily } from './index.js';

const FAMILIES: NameFamily[] = [
  'beast',
  'bird',
  'dragon',
  'slime',
  'aquatic',
  'nature',
  'golem',
  'spirit',
];

describe('nameFromToken', () => {
  it('is deterministic — same (id, family) yields the same name', () => {
    for (const fam of FAMILIES) {
      const a = nameFromToken('seed-alpha', fam);
      const b = nameFromToken('seed-alpha', fam);
      expect(a).toBe(b);
    }
  });

  it('produces a capitalized, non-empty, alpha name', () => {
    for (let i = 0; i < 200; i++) {
      const fam = FAMILIES[i % FAMILIES.length]!;
      const name = nameFromToken(`tok-${i}`, fam);
      expect(name.length).toBeGreaterThan(2);
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it('diverges across ids and across families', () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) names.add(nameFromToken(`id-${i}`, 'dragon'));
    // Expect broad variety, not all collisions.
    expect(names.size).toBeGreaterThan(60);

    // The same id across families should usually differ (family salts the rng).
    let differ = 0;
    for (let i = 0; i < 50; i++) {
      if (nameFromToken(`x-${i}`, 'beast') !== nameFromToken(`x-${i}`, 'spirit')) differ++;
    }
    expect(differ).toBeGreaterThan(40);
  });
});
