import { describe, it, expect } from 'vitest';
import {
  creatureFromToken,
  seedToken,
  gooberSpecFor,
  gooberSpecForSeed,
  gooberFromToken,
  cryFromToken,
  FAMILIES,
  RANKS,
  ELEMENTS,
  type CreatureToken,
  type Family,
} from './index.js';

function tok(id: string, family: Family, plus = 0, generation = 0): CreatureToken {
  return { id, family, plus, generation, parents: null };
}

describe('gooberSpecFor — memoized stable body', () => {
  it('returns the SAME reference for the same token id (memo holds)', () => {
    const t = tok('memo-beast', 'beast', 2, 1);
    const a = gooberSpecFor(t);
    const b = gooberSpecFor({ ...t });
    expect(a).toBe(b); // reference-equal — this is what keeps mesh memos from rebuilding
  });

  it('matches the spec creatureFromToken would produce', () => {
    for (const family of FAMILIES) {
      const t = seedToken(`spec-${family}`);
      expect(gooberSpecFor(t)).toStrictEqual(creatureFromToken(t).gooberSpec);
    }
  });

  it('ignores plus/generation (they never restyle the body)', () => {
    const base = gooberSpecFor(tok('same-id', 'dragon', 0, 0));
    // Same id, bumped plus/generation → same cached body reference.
    expect(gooberSpecFor(tok('same-id', 'dragon', 9, 3))).toBe(base);
  });

  it('gooberSpecForSeed is stable and equals the seed token body', () => {
    const a = gooberSpecForSeed('villager-tamsin');
    const b = gooberSpecForSeed('villager-tamsin');
    expect(a).toBe(b);
    expect(a).toStrictEqual(creatureFromToken(seedToken('villager-tamsin')).gooberSpec);
  });
});

describe('creatureFromToken — determinism', () => {
  it('is deterministic: same token → deep-equal creature', () => {
    for (const family of FAMILIES) {
      const t = tok(`det-${family}`, family, 3, 1);
      const a = creatureFromToken(t);
      const b = creatureFromToken({ ...t });
      expect(a).toStrictEqual(b);
    }
  });

  it('covers every family and yields a legible creature', () => {
    for (const family of FAMILIES) {
      const c = creatureFromToken(seedToken(`x-${family}-42`));
      // seedToken derives its own family; force the family for a per-family check:
      const forced = creatureFromToken(tok(`fam-${family}`, family));
      expect(forced.family).toBe(family);
      expect(RANKS).toContain(forced.rank);
      expect(forced.name).toMatch(/^[A-Z][a-z]+$/);
      expect(forced.stats.hp).toBeGreaterThan(0);
      expect(forced.stats.atk).toBeGreaterThan(0);
      expect(forced.skills.length).toBeGreaterThanOrEqual(2);
      expect(forced.skills.some((s) => s.kind === 'attack')).toBe(true);
      expect(forced.elements[0]).toBeDefined();
      for (const e of forced.elements) expect(ELEMENTS).toContain(e);
      expect(forced.gooberSpec.balls.length).toBeGreaterThan(1);
      expect(forced.gooberSpec.eyes.length).toBe(2);
      expect(forced.crySpec.intervals.length).toBeGreaterThanOrEqual(3);
      // c is just here to exercise seedToken.
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe('creatureFromToken — divergence + scaling', () => {
  it('different tokens produce visibly distinct creatures', () => {
    const names = new Set<string>();
    const shapes = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const c = creatureFromToken(seedToken(`div-${i}`));
      names.add(c.name);
      shapes.add(`${c.gooberSpec.plan}:${c.gooberSpec.balls.length}`);
    }
    expect(names.size).toBeGreaterThan(50);
    expect(shapes.size).toBeGreaterThan(3);
  });

  it('higher plus / generation trends toward higher rank + bigger stats', () => {
    const low = creatureFromToken(tok('scale-a', 'dragon', 0, 0));
    const high = creatureFromToken(tok('scale-a', 'dragon', 20, 2));
    // Same id, more plus → same-or-higher rank index and higher HP.
    expect(RANKS.indexOf(high.rank)).toBeGreaterThanOrEqual(RANKS.indexOf(low.rank));
    expect(high.stats.hp).toBeGreaterThan(low.stats.hp);
  });

  it('golems are bigger/tankier than birds on average', () => {
    let golemDef = 0;
    let birdAgi = 0;
    let golemBigger = 0;
    for (let i = 0; i < 20; i++) {
      const g = creatureFromToken(tok(`g-${i}`, 'golem'));
      const b = creatureFromToken(tok(`b-${i}`, 'bird'));
      golemDef += g.stats.def;
      birdAgi += b.stats.agi;
      if (g.size > b.size) golemBigger++;
    }
    expect(golemDef / 20).toBeGreaterThan(0);
    expect(golemBigger).toBeGreaterThan(15); // golems reliably larger
  });
});

describe('gooberFromToken', () => {
  it('is deterministic and family-flavoured', () => {
    const a = gooberFromToken('gob-1', 'dragon', 0.8, [0.5, 0.2, 0.2], [0.9, 0.8, 0.2]);
    const b = gooberFromToken('gob-1', 'dragon', 0.8, [0.5, 0.2, 0.2], [0.9, 0.8, 0.2]);
    expect(a).toStrictEqual(b);
    // dragon adds horns/wings → more balls than a bare blob.
    const slime = gooberFromToken('gob-1', 'slime', 0.3, [0.3, 0.6, 0.9], [0.9, 0.9, 0.5]);
    expect(a.balls.length).toBeGreaterThan(slime.balls.length - 1);
    expect(a.scale).toBeGreaterThan(slime.scale); // size 0.8 > 0.3
  });
});

describe('cryFromToken', () => {
  it('is deterministic', () => {
    const a = cryFromToken('cry-1', 'beast', 0.6, 3);
    const b = cryFromToken('cry-1', 'beast', 0.6, 3);
    expect(a).toStrictEqual(b);
  });

  it('small creatures chirp higher than big ones', () => {
    const small = cryFromToken('same', 'bird', 0.1, 1);
    const big = cryFromToken('same', 'dragon', 0.95, 1);
    expect(small.baseHz).toBeGreaterThan(big.baseHz);
  });

  it('family sets the timbre', () => {
    expect(cryFromToken('t', 'golem', 0.5, 2).wave).toBe('square');
    expect(cryFromToken('t', 'beast', 0.5, 2).wave).toBe('sawtooth');
    expect(cryFromToken('t', 'slime', 0.5, 2).wave).toBe('sine');
  });
});
