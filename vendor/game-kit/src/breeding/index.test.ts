import { describe, it, expect } from 'vitest';
import { breed, breedFamily } from './index.js';
import {
  creatureFromToken,
  seedToken,
  FAMILIES,
  type Creature,
  type CreatureToken,
  type Family,
} from '../creature/index.js';
import { createRng } from '../prng/index.js';

// A creature from a plain seed id.
function seedCreature(id: string): Creature {
  return creatureFromToken(seedToken(id));
}

// A creature with a forced family (a legitimate genotype override — this is exactly
// what breeding itself does to a token). Used to guarantee a shared skill element.
function familyCreature(id: string, family: Family): Creature {
  const token: CreatureToken = { ...seedToken(id), family };
  return creatureFromToken(token);
}

describe('breedFamily — the combination table', () => {
  it('is order-independent (symmetric) for every pair', () => {
    for (const a of FAMILIES) {
      for (const b of FAMILIES) {
        expect(breedFamily(a, b)).toBe(breedFamily(b, a));
      }
    }
  });

  it('breeds same-family pairs true', () => {
    for (const f of FAMILIES) {
      expect(breedFamily(f, f)).toBe(f);
    }
  });

  it('always resolves to a real family for every cross', () => {
    for (const a of FAMILIES) {
      for (const b of FAMILIES) {
        expect(FAMILIES).toContain(breedFamily(a, b));
      }
    }
  });

  it('honours the marquee fusion and a few authored crosses', () => {
    expect(breedFamily('beast', 'bird')).toBe('dragon');
    expect(breedFamily('bird', 'beast')).toBe('dragon');
    expect(breedFamily('slime', 'aquatic')).toBe('aquatic');
    expect(breedFamily('spirit', 'nature')).toBe('spirit');
    expect(breedFamily('dragon', 'golem')).toBe('dragon');
  });
});

describe('breed — determinism', () => {
  it('same (a, b, seed) → deep-equal BreedResult', () => {
    const a = seedCreature('alpha');
    const b = seedCreature('bravo');
    const r1 = breed(a, b, createRng(42));
    const r2 = breed(a, b, createRng(42));
    expect(r1).toEqual(r2);
  });

  it('different seeds → different child (the seed picks which sibling)', () => {
    const a = seedCreature('alpha');
    const b = seedCreature('bravo');
    const r1 = breed(a, b, createRng(1));
    const r2 = breed(a, b, createRng(2));
    expect(r1.childToken.id).not.toBe(r2.childToken.id);
  });
});

describe('breed — rank-up / lineage', () => {
  it('climbs plus and generation and records both parents', () => {
    const a = seedCreature('alpha');
    const b = seedCreature('bravo');
    const r = breed(a, b, createRng(7));
    expect(r.childToken.plus).toBe(Math.max(a.token.plus, b.token.plus) + 1);
    expect(r.childToken.generation).toBe(Math.max(a.token.generation, b.token.generation) + 1);
    expect(r.childToken.parents).toEqual([a.token.id, b.token.id]);
    expect(r.family).toBe(breedFamily(a.token.family, b.token.family));
    expect(r.childToken.family).toBe(r.family);
  });

  it('lineage climbs across successive generations', () => {
    const a = seedCreature('alpha');
    const b = seedCreature('bravo');
    const g1 = breed(a, b, createRng(7));
    const child = creatureFromToken(g1.childToken);
    const g2 = breed(child, a, createRng(9));
    expect(g2.childToken.generation).toBe(child.token.generation + 1);
    expect(g2.childToken.plus).toBe(child.token.plus + 1); // child.plus is the max here
  });
});

describe('breed — skill inheritance', () => {
  it('inheritedSkills ⊆ the de-duplicated union of parent skills', () => {
    const a = seedCreature('alpha');
    const b = seedCreature('bravo');
    const r = breed(a, b, createRng(11));
    const unionIds = new Set([...a.skills, ...b.skills].map((s) => s.id));
    expect(r.inheritedSkills.length).toBeGreaterThan(0);
    for (const s of r.inheritedSkills) {
      expect(unionIds.has(s.id)).toBe(true);
    }
  });
});

describe('breed — skill combining (DQM fusion)', () => {
  it('same-family parents fuse a shared element into a strictly stronger skill', () => {
    // Both dragons share the family primary element ('fire') via their guaranteed
    // attack skill, so a fusion is certain.
    const a = familyCreature('drake-one', 'dragon');
    const b = familyCreature('drake-two', 'dragon');
    const r = breed(a, b, createRng(5));

    expect(r.comboSkills.length).toBeGreaterThan(0);

    const union = [...a.skills, ...b.skills];
    for (const combo of r.comboSkills) {
      // A fused skill is strictly stronger than EVERY parent skill of its element.
      const sameElementParent = union.filter((s) => s.element === combo.element);
      const maxParent = Math.max(...sameElementParent.map((s) => s.power));
      expect(combo.power).toBeGreaterThan(maxParent);
      // …and its name is genuinely new.
      expect(union.some((s) => s.name === combo.name)).toBe(false);
    }
  });
});

describe('breed — the DISTINCTNESS property (the money output)', () => {
  it('the child creature differs from BOTH parents in name AND gooberSpec', () => {
    const a = seedCreature('alpha');
    const b = seedCreature('bravo');
    const r = breed(a, b, createRng(123));
    const child = creatureFromToken(r.childToken);

    expect(child.name).not.toBe(a.name);
    expect(child.name).not.toBe(b.name);
    expect(child.gooberSpec).not.toEqual(a.gooberSpec);
    expect(child.gooberSpec).not.toEqual(b.gooberSpec);
    // The child token is its own identity, not a copy of either parent's.
    expect(child.token.id).not.toBe(a.token.id);
    expect(child.token.id).not.toBe(b.token.id);
  });

  it('holds across many seed pairs', () => {
    for (let i = 0; i < 25; i++) {
      const a = seedCreature(`p-${i}`);
      const b = seedCreature(`q-${i}`);
      const child = creatureFromToken(breed(a, b, createRng(1000 + i)).childToken);
      expect(child.name).not.toBe(a.name);
      expect(child.name).not.toBe(b.name);
      expect(child.gooberSpec).not.toEqual(a.gooberSpec);
      expect(child.gooberSpec).not.toEqual(b.gooberSpec);
    }
  });
});
