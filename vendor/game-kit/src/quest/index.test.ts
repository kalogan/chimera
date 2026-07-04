import { describe, it, expect } from 'vitest';
import {
  createQuestLog,
  offerable,
  acceptQuest,
  abandonQuest,
  recordEvent,
  isComplete,
  progressOf,
  claimReward,
  SAMPLE_QUESTS,
  type QuestDef,
  type QuestState,
} from './index.js';

// A small, self-contained test catalog independent of SAMPLE_QUESTS so tests
// don't rely on the sample set's exact shape (except where testing it directly).
const DEFS: readonly QuestDef[] = [
  {
    id: 'scout-3-beasts',
    title: 'Scout 3 Beasts',
    description: 'Scout 3 beast-family creatures.',
    objective: { kind: 'scout-family', family: 'beast', count: 3 },
    reward: { gold: 50 },
  },
  {
    id: 'scout-2-birds',
    title: 'Scout 2 Birds',
    description: 'Scout 2 bird-family creatures.',
    objective: { kind: 'scout-family', family: 'bird', count: 2 },
    reward: { gold: 30 },
  },
  {
    id: 'scout-any-1',
    title: 'Scout Anything',
    description: 'Scout 1 creature of any family.',
    objective: { kind: 'scout-any', count: 1 },
    reward: { itemId: 'healing-herb', itemCount: 1 },
  },
  {
    id: 'reach-mill',
    title: 'Reach the Mill',
    description: 'Enter the old-mill zone.',
    objective: { kind: 'reach-zone', zone: 'old-mill' },
    reward: { gold: 20 },
  },
  {
    id: 'breed-1',
    title: 'Breed Once',
    description: 'Breed any creature.',
    objective: { kind: 'breed', count: 1 },
    reward: { gold: 10 },
  },
  {
    id: 'breed-2-dragons',
    title: 'Breed 2 Dragons',
    description: 'Breed 2 dragon-family creatures.',
    objective: { kind: 'breed-family', family: 'dragon', count: 2 },
    reward: { gold: 200 },
  },
  {
    id: 'dex-5',
    title: 'Fill the Dex',
    description: 'Discover 5 species.',
    objective: { kind: 'dex', count: 5 },
    reward: { unlockZone: 'sunken-archive' },
  },
  {
    id: 'defeat-rival-tam',
    title: 'Defeat Tam',
    description: 'Defeat rival Tam.',
    objective: { kind: 'defeat-rival', rivalId: 'rival-tam' },
    reward: { gold: 500 },
  },
  {
    id: 'needs-mill',
    title: 'Beyond the Mill',
    description: 'Requires reach-mill first.',
    objective: { kind: 'scout-any', count: 1 },
    reward: { gold: 5 },
    prereq: 'reach-mill',
  },
];

const byId = (id: string) => DEFS.find((d) => d.id === id)!;

describe('createQuestLog', () => {
  it('starts empty', () => {
    const q = createQuestLog();
    expect(q.active).toEqual({});
    expect(q.completed).toEqual([]);
  });
});

describe('offerable', () => {
  it('lists all defs with no prereq when the log is empty', () => {
    const q = createQuestLog();
    const ids = offerable(DEFS, q).map((d) => d.id);
    expect(ids).toContain('scout-3-beasts');
    expect(ids).not.toContain('needs-mill'); // prereq not met
  });

  it('excludes an already-active quest', () => {
    let q = createQuestLog();
    q = acceptQuest(q, 'scout-3-beasts');
    const ids = offerable(DEFS, q).map((d) => d.id);
    expect(ids).not.toContain('scout-3-beasts');
  });

  it('excludes an already-completed quest', () => {
    let q = createQuestLog();
    q = acceptQuest(q, 'reach-mill');
    const res = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' });
    q = res.state;
    const ids = offerable(DEFS, q).map((d) => d.id);
    expect(ids).not.toContain('reach-mill');
  });

  it('gates a quest behind its prereq until the prereq completes', () => {
    let q = createQuestLog();
    expect(offerable(DEFS, q).map((d) => d.id)).not.toContain('needs-mill');

    q = acceptQuest(q, 'reach-mill');
    q = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' }).state;
    expect(offerable(DEFS, q).map((d) => d.id)).toContain('needs-mill');
  });
});

describe('acceptQuest / abandonQuest', () => {
  it('accept starts a quest at zero progress', () => {
    const q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    expect(q.active['scout-3-beasts']).toEqual({ progress: 0 });
  });

  it('accept is a no-op (same state) if already active', () => {
    const q0 = acceptQuest(createQuestLog(), 'scout-3-beasts');
    const q1 = acceptQuest(q0, 'scout-3-beasts');
    expect(q1).toBe(q0);
  });

  it('accept is a no-op if already completed', () => {
    let q = acceptQuest(createQuestLog(), 'reach-mill');
    q = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' }).state;
    const q2 = acceptQuest(q, 'reach-mill');
    expect(q2).toBe(q);
  });

  it('accept does not mutate the input state', () => {
    const q0 = createQuestLog();
    const frozen = JSON.stringify(q0);
    acceptQuest(q0, 'scout-3-beasts');
    expect(JSON.stringify(q0)).toBe(frozen);
  });

  it('abandon drops an active quest entirely', () => {
    let q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    q = abandonQuest(q, 'scout-3-beasts');
    expect('scout-3-beasts' in q.active).toBe(false);
  });

  it('abandon is a no-op (same state) if not active', () => {
    const q0 = createQuestLog();
    const q1 = abandonQuest(q0, 'scout-3-beasts');
    expect(q1).toBe(q0);
  });
});

describe('recordEvent — scout objectives', () => {
  it('advances progress via matching events and completes at target', () => {
    let q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    let res = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    q = res.state;
    expect(q.active['scout-3-beasts']!.progress).toBe(1);
    expect(res.completed).toEqual([]);

    res = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    q = res.state;
    expect(q.active['scout-3-beasts']!.progress).toBe(2);

    res = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    q = res.state;
    expect(q.active['scout-3-beasts']).toBeUndefined();
    expect(q.completed).toEqual(['scout-3-beasts']);
    expect(res.completed).toEqual(['scout-3-beasts']);
  });

  it('non-matching events do not advance progress', () => {
    let q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    const res = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' });
    expect(res.state).toBe(q); // no change at all
    expect(res.completed).toEqual([]);
  });

  it('family-specific objective ignores a different family', () => {
    let q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    q = recordEvent(DEFS, q, { type: 'scouted', family: 'bird' }).state;
    expect(q.active['scout-3-beasts']!.progress).toBe(0);
  });

  it('scout-any advances on any family', () => {
    let q = acceptQuest(createQuestLog(), 'scout-any-1');
    const res = recordEvent(DEFS, q, { type: 'scouted', family: 'dragon' });
    expect(res.completed).toEqual(['scout-any-1']);
  });

  it('progress never exceeds the target', () => {
    let q = acceptQuest(createQuestLog(), 'scout-any-1');
    q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
    expect(q.completed).toEqual(['scout-any-1']);
    // Feeding more matching events post-completion is a no-op — id no longer active.
    const res = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    expect(res.state).toBe(q);
    expect(res.completed).toEqual([]);
  });
});

describe('recordEvent — multiple active quests', () => {
  it('advances several active quests independently', () => {
    let q = createQuestLog();
    q = acceptQuest(q, 'scout-3-beasts');
    q = acceptQuest(q, 'scout-2-birds');
    q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
    expect(q.active['scout-3-beasts']!.progress).toBe(1);
    expect(q.active['scout-2-birds']!.progress).toBe(0);

    q = recordEvent(DEFS, q, { type: 'scouted', family: 'bird' }).state;
    expect(q.active['scout-3-beasts']!.progress).toBe(1);
    expect(q.active['scout-2-birds']!.progress).toBe(1);
  });

  it('a single event can complete more than one quest at once', () => {
    // Two independent count-1 objectives that both match the same event.
    const twoAny: readonly QuestDef[] = [
      { ...byId('scout-any-1'), id: 'any-a' },
      { ...byId('scout-any-1'), id: 'any-b' },
    ];
    let q = createQuestLog();
    q = acceptQuest(q, 'any-a');
    q = acceptQuest(q, 'any-b');
    const res = recordEvent(twoAny, q, { type: 'scouted', family: 'slime' });
    expect(res.completed.sort()).toEqual(['any-a', 'any-b']);
    expect(res.state.completed.sort()).toEqual(['any-a', 'any-b']);
  });

  it('completing one quest leaves an unrelated active quest untouched', () => {
    let q = createQuestLog();
    q = acceptQuest(q, 'scout-any-1');
    q = acceptQuest(q, 'reach-mill');
    const res = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    expect(res.completed).toEqual(['scout-any-1']);
    expect(res.state.active['reach-mill']).toEqual({ progress: 0 });
  });
});

describe('recordEvent — other objective kinds', () => {
  it('reach-zone completes on matching zone entry, ignores others', () => {
    let q = acceptQuest(createQuestLog(), 'reach-mill');
    let res = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'somewhere-else' });
    expect(res.completed).toEqual([]);
    res = recordEvent(DEFS, res.state, { type: 'enteredZone', zone: 'old-mill' });
    expect(res.completed).toEqual(['reach-mill']);
  });

  it('breed (any family) advances on any bred event', () => {
    let q = acceptQuest(createQuestLog(), 'breed-1');
    const res = recordEvent(DEFS, q, { type: 'bred', family: 'slime' });
    expect(res.completed).toEqual(['breed-1']);
  });

  it('breed-family only advances for the matching family, and needs count', () => {
    let q = acceptQuest(createQuestLog(), 'breed-2-dragons');
    let res = recordEvent(DEFS, q, { type: 'bred', family: 'slime' });
    expect(res.state.active['breed-2-dragons']!.progress).toBe(0);
    res = recordEvent(DEFS, res.state, { type: 'bred', family: 'dragon' });
    expect(res.state.active['breed-2-dragons']!.progress).toBe(1);
    expect(res.completed).toEqual([]);
    res = recordEvent(DEFS, res.state, { type: 'bred', family: 'dragon' });
    expect(res.completed).toEqual(['breed-2-dragons']);
  });

  it('dex objective sets progress to the event total (absolute, not additive)', () => {
    let q = acceptQuest(createQuestLog(), 'dex-5');
    let res = recordEvent(DEFS, q, { type: 'dexCount', total: 3 });
    expect(res.state.active['dex-5']!.progress).toBe(3);
    res = recordEvent(DEFS, res.state, { type: 'dexCount', total: 4 });
    expect(res.state.active['dex-5']!.progress).toBe(4);
    res = recordEvent(DEFS, res.state, { type: 'dexCount', total: 5 });
    expect(res.completed).toEqual(['dex-5']);
  });

  it('dex objective progress never regresses on a lower total', () => {
    let q = acceptQuest(createQuestLog(), 'dex-5');
    q = recordEvent(DEFS, q, { type: 'dexCount', total: 4 }).state;
    q = recordEvent(DEFS, q, { type: 'dexCount', total: 2 }).state;
    expect(q.active['dex-5']!.progress).toBe(4);
  });

  it('defeat-rival matches only the named rival id', () => {
    let q = acceptQuest(createQuestLog(), 'defeat-rival-tam');
    let res = recordEvent(DEFS, q, { type: 'defeatedRival', rivalId: 'rival-someone-else' });
    expect(res.completed).toEqual([]);
    res = recordEvent(DEFS, res.state, { type: 'defeatedRival', rivalId: 'rival-tam' });
    expect(res.completed).toEqual(['defeat-rival-tam']);
  });
});

describe('recordEvent — idempotence + purity', () => {
  it('double-completion via repeated events is idempotent (id appears once)', () => {
    let q = acceptQuest(createQuestLog(), 'reach-mill');
    q = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' }).state;
    expect(q.completed).toEqual(['reach-mill']);
    // Re-accepting after completion is a no-op, and firing the event again
    // (with the quest no longer active) changes nothing further.
    const q2 = acceptQuest(q, 'reach-mill');
    expect(q2).toBe(q);
    const res = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' });
    expect(res.state).toBe(q);
    expect(q.completed.filter((id) => id === 'reach-mill')).toHaveLength(1);
  });

  it('does not mutate the input state', () => {
    let q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    const frozen = JSON.stringify(q);
    recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    expect(JSON.stringify(q)).toBe(frozen);
  });

  it('an event matching no active quest returns the SAME state reference', () => {
    const q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    const res = recordEvent(DEFS, q, { type: 'defeatedRival', rivalId: 'nobody' });
    expect(res.state).toBe(q);
  });

  it('an event with no active quests at all is a safe no-op', () => {
    const q = createQuestLog();
    const res = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' });
    expect(res.state).toBe(q);
    expect(res.completed).toEqual([]);
  });
});

describe('isComplete / progressOf', () => {
  it('isComplete is false while active, true once completed', () => {
    let q = acceptQuest(createQuestLog(), 'reach-mill');
    expect(isComplete(byId('reach-mill'), q)).toBe(false);
    q = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' }).state;
    expect(isComplete(byId('reach-mill'), q)).toBe(true);
  });

  it('progressOf reports done/target for an active quest', () => {
    let q = acceptQuest(createQuestLog(), 'scout-3-beasts');
    q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
    expect(progressOf(byId('scout-3-beasts'), q)).toEqual({ done: 1, target: 3 });
  });

  it('progressOf reports zero for a never-started quest', () => {
    const q = createQuestLog();
    expect(progressOf(byId('scout-3-beasts'), q)).toEqual({ done: 0, target: 3 });
  });

  it('progressOf reports done === target for a completed quest', () => {
    let q = acceptQuest(createQuestLog(), 'reach-mill');
    q = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' }).state;
    expect(progressOf(byId('reach-mill'), q)).toEqual({ done: 1, target: 1 });
  });
});

describe('claimReward', () => {
  it('returns the def reward data', () => {
    expect(claimReward(byId('scout-3-beasts'))).toEqual({ gold: 50 });
  });

  it('returns a fresh copy, not the def\'s own reward object', () => {
    const def = byId('reach-mill');
    const reward = claimReward(def);
    expect(reward).toEqual(def.reward);
    expect(reward).not.toBe(def.reward);
  });

  it('is idempotent — claiming twice returns the same data', () => {
    const def = byId('defeat-rival-tam');
    expect(claimReward(def)).toEqual(claimReward(def));
  });
});

describe('SAMPLE_QUESTS', () => {
  it('is a small, well-formed catalog', () => {
    expect(SAMPLE_QUESTS.length).toBeGreaterThanOrEqual(3);
    expect(SAMPLE_QUESTS.length).toBeLessThanOrEqual(6);
    const ids = new Set(SAMPLE_QUESTS.map((d) => d.id));
    expect(ids.size).toBe(SAMPLE_QUESTS.length); // unique ids
    for (const d of SAMPLE_QUESTS) {
      expect(typeof d.title).toBe('string');
      expect(d.title.length).toBeGreaterThan(0);
      expect(typeof d.description).toBe('string');
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.objective).toBeDefined();
      expect(d.reward).toBeDefined();
    }
  });

  it('every prereq named in SAMPLE_QUESTS points at a real quest id in the set', () => {
    const ids = new Set(SAMPLE_QUESTS.map((d) => d.id));
    for (const d of SAMPLE_QUESTS) {
      if (d.prereq) expect(ids.has(d.prereq)).toBe(true);
    }
  });

  it('can be driven end-to-end through offerable -> accept -> recordEvent -> claimReward', () => {
    let q = createQuestLog();
    const first = offerable(SAMPLE_QUESTS, q);
    expect(first.length).toBeGreaterThan(0);

    const scoutQuest = SAMPLE_QUESTS.find((d) => d.id === 'q-scout-beasts')!;
    q = acceptQuest(q, scoutQuest.id);
    for (let i = 0; i < 3; i++) {
      q = recordEvent(SAMPLE_QUESTS, q, { type: 'scouted', family: 'beast' }).state;
    }
    expect(isComplete(scoutQuest, q)).toBe(true);
    expect(claimReward(scoutQuest)).toEqual({ gold: 100 });
  });
});

describe('determinism + serialization', () => {
  it('JSON round-trips to a deep-equal state', () => {
    let q = createQuestLog();
    q = acceptQuest(q, 'scout-3-beasts');
    q = acceptQuest(q, 'reach-mill');
    q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
    q = recordEvent(DEFS, q, { type: 'enteredZone', zone: 'old-mill' }).state;
    const round: QuestState = JSON.parse(JSON.stringify(q));
    expect(round).toEqual(q);
  });

  it('is deterministic — same ops yield deep-equal states', () => {
    const build = (): QuestState => {
      let q = createQuestLog();
      q = acceptQuest(q, 'scout-3-beasts');
      q = acceptQuest(q, 'breed-2-dragons');
      q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
      q = recordEvent(DEFS, q, { type: 'bred', family: 'dragon' }).state;
      q = recordEvent(DEFS, q, { type: 'bred', family: 'dragon' }).state;
      q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
      q = recordEvent(DEFS, q, { type: 'scouted', family: 'beast' }).state;
      return q;
    };
    expect(build()).toEqual(build());
  });

  it('progress is always >= 0 and completed ids are never duplicated across a long sequence', () => {
    let q = createQuestLog();
    q = acceptQuest(q, 'scout-3-beasts');
    q = acceptQuest(q, 'scout-any-1');
    q = acceptQuest(q, 'dex-5');
    const events: import('./index.js').QuestEvent[] = [
      { type: 'scouted', family: 'bird' },
      { type: 'scouted', family: 'beast' },
      { type: 'dexCount', total: 1 },
      { type: 'scouted', family: 'beast' },
      { type: 'dexCount', total: 5 },
      { type: 'scouted', family: 'beast' },
      { type: 'dexCount', total: 5 },
    ];
    for (const e of events) {
      q = recordEvent(DEFS, q, e).state;
    }
    for (const prog of Object.values(q.active)) {
      expect(prog.progress).toBeGreaterThanOrEqual(0);
    }
    const seen = new Set<string>();
    for (const id of q.completed) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
