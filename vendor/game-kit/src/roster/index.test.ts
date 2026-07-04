import { describe, it, expect } from 'vitest';
import { seedToken, type CreatureToken, type Family } from '../creature/index.js';
import {
  createRoster,
  addCreature,
  markSeen,
  markScouted,
  setParty,
  swapToParty,
  release,
  dexCount,
  lineageOf,
  type RosterState,
} from './index.js';

function tok(id: string, family: Family = 'slime', plus = 0, generation = 0): CreatureToken {
  return { id, family, plus, generation, parents: null };
}

function bred(
  id: string,
  parents: [string, string],
  family: Family = 'dragon',
  generation = 1,
): CreatureToken {
  return { id, family, plus: 0, generation, parents };
}

function ids(tokens: CreatureToken[]): string[] {
  return tokens.map((t) => t.id);
}

describe('createRoster', () => {
  it('is empty by default', () => {
    const r = createRoster();
    expect(r.party).toEqual([]);
    expect(r.storage).toEqual([]);
    expect(r.dex).toEqual({});
    expect(r.maxParty).toBe(3);
  });

  it('routes starters to party then storage and marks them owned', () => {
    const starters = [tok('a'), tok('b'), tok('c'), tok('d')];
    const r = createRoster(starters);
    expect(ids(r.party)).toEqual(['a', 'b', 'c']);
    expect(ids(r.storage)).toEqual(['d']);
    expect(dexCount(r, 'owned')).toBe(4);
  });
});

describe('addCreature — party cap + routing', () => {
  it('fills the party first, then overflows to storage', () => {
    let r = createRoster();
    for (const id of ['a', 'b', 'c', 'd', 'e']) r = addCreature(r, tok(id));
    expect(ids(r.party)).toEqual(['a', 'b', 'c']);
    expect(ids(r.storage)).toEqual(['d', 'e']);
    expect(r.party.length).toBeLessThanOrEqual(r.maxParty);
  });

  it('never exceeds maxParty', () => {
    let r = createRoster([], 2);
    for (const id of ['a', 'b', 'c']) r = addCreature(r, tok(id));
    expect(r.party.length).toBe(2);
    expect(ids(r.storage)).toEqual(['c']);
  });

  it('honours opts.toStorage', () => {
    let r = createRoster();
    r = addCreature(r, tok('a'), { toStorage: true });
    expect(r.party).toEqual([]);
    expect(ids(r.storage)).toEqual(['a']);
  });

  it('does not physically duplicate an existing id, but still upgrades the dex', () => {
    let r = createRoster();
    r = markSeen(r, tok('a'));
    expect(dexCount(r, 'seen')).toBe(1);
    r = addCreature(r, tok('a'));
    r = addCreature(r, tok('a')); // duplicate
    expect(ids(r.party)).toEqual(['a']);
    expect(r.storage).toEqual([]);
    expect(dexCount(r, 'owned')).toBe(1);
  });

  it('is pure — does not mutate the input state', () => {
    const r0 = createRoster();
    const r1 = addCreature(r0, tok('a'));
    expect(r0.party).toEqual([]);
    expect(r0.dex).toEqual({});
    expect(r1).not.toBe(r0);
  });
});

describe('dex status upgrades', () => {
  it('walks seen → scouted → owned without downgrading', () => {
    let r = createRoster();
    const t = tok('mon');
    r = markSeen(r, t);
    expect(r.dex['mon']!.status).toBe('seen');
    r = markScouted(r, t);
    expect(r.dex['mon']!.status).toBe('scouted');
    r = addCreature(r, t);
    expect(r.dex['mon']!.status).toBe('owned');
    // Re-seeing does not downgrade.
    r = markSeen(r, t);
    expect(r.dex['mon']!.status).toBe('owned');
  });

  it('records bred when a token carries parents', () => {
    let r = createRoster([tok('mom'), tok('dad')]);
    const child = bred('kid', ['mom', 'dad']);
    r = addCreature(r, child);
    expect(r.dex['kid']!.status).toBe('bred');
    expect(r.dex['kid']!.parents).toEqual(['mom', 'dad']);
  });

  it('preserves firstSeenGen from first discovery', () => {
    let r = createRoster();
    r = markSeen(r, tok('g', 'slime', 0, 5));
    expect(r.dex['g']!.firstSeenGen).toBe(5);
    r = addCreature(r, tok('g', 'slime', 0, 9));
    expect(r.dex['g']!.firstSeenGen).toBe(5); // unchanged
  });
});

describe('setParty', () => {
  it('selects and orders the party, sending the rest to storage', () => {
    let r = createRoster([tok('a'), tok('b'), tok('c'), tok('d')]);
    r = setParty(r, ['d', 'a']);
    expect(ids(r.party)).toEqual(['d', 'a']);
    expect(ids(r.storage).sort()).toEqual(['b', 'c']);
  });

  it('rejects exceeding maxParty', () => {
    const r = createRoster([tok('a'), tok('b'), tok('c'), tok('d')]);
    expect(() => setParty(r, ['a', 'b', 'c', 'd'])).toThrow();
  });

  it('rejects unknown ids and duplicates', () => {
    const r = createRoster([tok('a'), tok('b')]);
    expect(() => setParty(r, ['a', 'zzz'])).toThrow();
    expect(() => setParty(r, ['a', 'a'])).toThrow();
  });
});

describe('swapToParty', () => {
  it('fills an open party slot from storage', () => {
    let r = createRoster([tok('a')]);
    r = addCreature(r, tok('b'), { toStorage: true });
    r = swapToParty(r, 'b');
    expect(ids(r.party)).toEqual(['a', 'b']);
    expect(r.storage).toEqual([]);
  });

  it('swaps a party member out when the party is full', () => {
    let r = createRoster([tok('a'), tok('b'), tok('c')]);
    r = addCreature(r, tok('d'), { toStorage: true });
    r = swapToParty(r, 'd', 'b');
    expect(ids(r.party)).toEqual(['a', 'd', 'c']);
    expect(ids(r.storage)).toEqual(['b']);
    // Invariant: no id in both party and storage.
    expect(ids(r.party).filter((id) => ids(r.storage).includes(id))).toEqual([]);
  });

  it('throws when the party is full and no swap target is given', () => {
    let r = createRoster([tok('a'), tok('b'), tok('c')]);
    r = addCreature(r, tok('d'), { toStorage: true });
    expect(() => swapToParty(r, 'd')).toThrow();
  });

  it('throws on missing ids', () => {
    const r = createRoster([tok('a')]);
    expect(() => swapToParty(r, 'nope')).toThrow();
  });
});

describe('release', () => {
  it('removes a token from storage but keeps its dex record', () => {
    let r = createRoster([tok('a')]);
    r = addCreature(r, tok('b'), { toStorage: true });
    r = release(r, 'b');
    expect(r.storage).toEqual([]);
    expect(r.dex['b']!.status).toBe('owned'); // dex stays
  });

  it('refuses to release a party member', () => {
    const r = createRoster([tok('a')]);
    expect(() => release(r, 'a')).toThrow();
  });

  it('is a no-op for an unknown id', () => {
    const r = createRoster([tok('a')]);
    expect(release(r, 'ghost')).toBe(r);
  });
});

describe('lineageOf', () => {
  it('walks parents through the dex, depth-first and deduped', () => {
    let r = createRoster();
    r = addCreature(r, tok('gm1'));
    r = addCreature(r, tok('gm2'), { toStorage: true });
    r = addCreature(r, bred('mom', ['gm1', 'gm2'], 'beast', 1), { toStorage: true });
    r = addCreature(r, tok('dad'), { toStorage: true });
    r = addCreature(r, bred('kid', ['mom', 'dad'], 'dragon', 2), { toStorage: true });
    const line = lineageOf(r, 'kid');
    expect(line).toContain('mom');
    expect(line).toContain('dad');
    expect(line).toContain('gm1');
    expect(line).toContain('gm2');
    // No duplicates.
    expect(new Set(line).size).toBe(line.length);
  });

  it('returns [] for a parentless token', () => {
    const r = createRoster([tok('lonely')]);
    expect(lineageOf(r, 'lonely')).toEqual([]);
  });
});

describe('serialization + determinism', () => {
  it('JSON round-trips to a deep-equal state', () => {
    let r = createRoster([seedToken('s1'), seedToken('s2'), seedToken('s3'), seedToken('s4')]);
    r = addCreature(r, bred('kid', ['s1', 's2']));
    r = markScouted(r, tok('wild'));
    const round: RosterState = JSON.parse(JSON.stringify(r));
    expect(round).toEqual(r);
  });

  it('is deterministic — same ops yield deep-equal states', () => {
    const build = (): RosterState => {
      let r = createRoster([tok('a'), tok('b')]);
      r = addCreature(r, tok('c'));
      r = addCreature(r, tok('d'), { toStorage: true });
      r = setParty(r, ['c', 'a']);
      return r;
    };
    expect(build()).toEqual(build());
  });

  it('holds the core invariants across a sequence of ops', () => {
    let r = createRoster([tok('a'), tok('b'), tok('c'), tok('d'), tok('e')], 3);
    r = swapToParty(r, 'd', 'a');
    r = release(r, 'a');
    // party <= maxParty
    expect(r.party.length).toBeLessThanOrEqual(r.maxParty);
    // disjoint party/storage
    const partyIds = new Set(ids(r.party));
    expect(ids(r.storage).some((id) => partyIds.has(id))).toBe(false);
    // ids unique overall
    const all = [...ids(r.party), ...ids(r.storage)];
    expect(new Set(all).size).toBe(all.length);
  });
});
