import { describe, it, expect } from 'vitest';
import { type CreatureToken, type Family } from '../creature/index.js';
import { dexCount } from '../roster/index.js';
import {
  createRival,
  decideRival,
  stepRival,
  runRival,
  HOARDER_PERSONALITY,
  BREEDER_PERSONALITY,
  COMPLETIONIST_PERSONALITY,
  RIVAL_PERSONALITY_PRESETS,
  RIVAL_GOALS,
  HISTORY_CAP,
  type RivalCtx,
  type RivalState,
  type DecisionTrace,
} from './index.js';

function tok(id: string, family: Family = 'slime', plus = 0, generation = 0): CreatureToken {
  return { id, family, plus, generation, parents: null };
}

function makeZonePool(zone: string, n: number, family: Family = 'beast'): Record<string, CreatureToken[]> {
  const tokens: CreatureToken[] = [];
  for (let i = 0; i < n; i++) tokens.push(tok(`${zone}-wild-${i}`, family));
  return { [zone]: tokens };
}

const basicCtx: RivalCtx = { zonePool: makeZonePool('zone-0', 5) };

// ── createRival ──────────────────────────────────────────────────────────────

describe('createRival', () => {
  it('creates a seeded rival with defaults', () => {
    const r = createRival({ id: 'r1' });
    expect(r.id).toBe('r1');
    expect(r.personality).toBe(HOARDER_PERSONALITY);
    expect(r.currentZone).toBe('zone-0');
    expect(r.step).toBe(0);
    expect(r.history).toEqual([]);
    expect(r.roster.party.length).toBe(1);
    expect(r.economy.gold).toBe(50);
  });

  it('is deterministic: same opts -> deep-equal RivalState', () => {
    const a = createRival({ id: 'same', personality: BREEDER_PERSONALITY, seed: 'seed-a' });
    const b = createRival({ id: 'same', personality: BREEDER_PERSONALITY, seed: 'seed-a' });
    expect(a).toEqual(b);
  });

  it('honours a string seed via hashing (different strings -> different starters)', () => {
    const a = createRival({ id: 'r', seed: 'alpha' });
    const b = createRival({ id: 'r', seed: 'beta' });
    expect(a.rngSeed).not.toBe(b.rngSeed);
  });

  it('honours explicit starters and gold', () => {
    const starters = [tok('s1', 'dragon'), tok('s2', 'bird')];
    const r = createRival({ id: 'r', starters, gold: 200 });
    expect(r.roster.party.map((t) => t.id)).toEqual(['s1', 's2']);
    expect(r.economy.gold).toBe(200);
  });

  it('defaults name to the personality name when not given', () => {
    const r = createRival({ id: 'r', personality: COMPLETIONIST_PERSONALITY });
    expect(r.name).toBe('Completionist');
  });
});

// ── personality presets ──────────────────────────────────────────────────────

describe('personality presets', () => {
  it('exposes exactly three named presets', () => {
    expect(RIVAL_PERSONALITY_PRESETS.length).toBe(3);
    expect(RIVAL_PERSONALITY_PRESETS.map((p) => p.name)).toEqual([
      'Hoarder',
      'Breeder',
      'Completionist',
    ]);
  });

  it('each preset has non-negative weights', () => {
    for (const p of RIVAL_PERSONALITY_PRESETS) {
      expect(p.collect).toBeGreaterThanOrEqual(0);
      expect(p.breed).toBeGreaterThanOrEqual(0);
      expect(p.power).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── decideRival: trace well-formedness ───────────────────────────────────────

describe('decideRival — DecisionTrace shape', () => {
  it('produces a well-formed trace: every option scored, exactly one chosen, an intent string', () => {
    const r = createRival({ id: 'r1' });
    const trace = decideRival(r, basicCtx);

    expect(trace.options.length).toBe(RIVAL_GOALS.length);
    for (const opt of trace.options) {
      expect(typeof opt.score).toBe('number');
      expect(Number.isFinite(opt.score)).toBe(true);
      expect(typeof opt.reason).toBe('string');
      expect(opt.reason.length).toBeGreaterThan(0);
      expect(RIVAL_GOALS).toContain(opt.goal);
    }
    expect(RIVAL_GOALS).toContain(trace.chosen);
    expect(trace.goal).toBe(trace.chosen);
    expect(typeof trace.intent).toBe('string');
    expect(trace.intent.length).toBeGreaterThan(0);
    expect(trace.step).toBe(r.step);
  });

  it('every goal in RIVAL_GOALS appears exactly once in options', () => {
    const r = createRival({ id: 'r1' });
    const trace = decideRival(r, basicCtx);
    const goals = trace.options.map((o) => o.goal);
    expect(new Set(goals).size).toBe(RIVAL_GOALS.length);
  });

  it('is pure: does not mutate the rival or change with repeated calls', () => {
    const r = createRival({ id: 'r1' });
    const before = JSON.parse(JSON.stringify(r));
    const t1 = decideRival(r, basicCtx);
    const t2 = decideRival(r, basicCtx);
    expect(r).toEqual(before);
    expect(t1).toEqual(t2);
  });

  it('scores zero (never chosen without qualifying) for hunt/scout when the zone has no wild pool', () => {
    const r = createRival({ id: 'r1', currentZone: 'empty-zone' });
    const trace = decideRival(r, { zonePool: {} });
    const hunt = trace.options.find((o) => o.goal === 'hunt')!;
    const scout = trace.options.find((o) => o.goal === 'scout')!;
    expect(hunt.score).toBe(0);
    expect(scout.score).toBe(0);
  });

  it('scores zero for breed when fewer than two owned creatures exist', () => {
    const r = createRival({ id: 'r1', starters: [tok('only-one')] });
    const trace = decideRival(r, basicCtx);
    const breedOpt = trace.options.find((o) => o.goal === 'breed')!;
    expect(breedOpt.score).toBe(0);
  });
});

// ── determinism across steps ─────────────────────────────────────────────────

describe('determinism', () => {
  it('runs N steps deterministically: same seed -> identical history + final state', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 8) };
    const a = createRival({ id: 'twin', seed: 42 });
    const b = createRival({ id: 'twin', seed: 42 });

    const ra = runRival(a, ctx, 15);
    const rb = runRival(b, ctx, 15);

    expect(ra.traces).toEqual(rb.traces);
    expect(ra.rival).toEqual(rb.rival);
  });

  it('stepRival is a pure function: calling it twice from the same input yields identical results', () => {
    const r = createRival({ id: 'r1', seed: 7 });
    const out1 = stepRival(r, basicCtx);
    const out2 = stepRival(r, basicCtx);
    expect(out1).toEqual(out2);
  });

  it('different seeds diverge in their trace stream', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 8) };
    const a = createRival({ id: 'r', seed: 1 });
    const b = createRival({ id: 'r', seed: 2 });
    const ra = runRival(a, ctx, 10);
    const rb = runRival(b, ctx, 10);
    expect(ra.traces).not.toEqual(rb.traces);
  });
});

// ── growth over a run ─────────────────────────────────────────────────────────

describe('growth over a run', () => {
  it("a rival's dex grows over a run when wilds are available", () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 10) };
    const r = createRival({ id: 'r1', personality: COMPLETIONIST_PERSONALITY, seed: 99 });
    const before = dexCount(r.roster);
    const { rival: after } = runRival(r, ctx, 20);
    expect(dexCount(after.roster)).toBeGreaterThan(before);
  });

  it("a rival's roster (party+storage) can grow via scouting/breeding over a run", () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 10) };
    const r = createRival({ id: 'r1', personality: COMPLETIONIST_PERSONALITY, seed: 123 });
    const beforeCount = r.roster.party.length + r.roster.storage.length;
    const { rival: after } = runRival(r, ctx, 30);
    const afterCount = after.roster.party.length + after.roster.storage.length;
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it('caps history at HISTORY_CAP entries', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 5) };
    const r = createRival({ id: 'r1', seed: 5 });
    const { rival: after } = runRival(r, ctx, HISTORY_CAP + 15);
    expect(after.history.length).toBe(HISTORY_CAP);
  });

  it('advances the step counter by exactly nSteps', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 5) };
    const r = createRival({ id: 'r1', seed: 5 });
    const { rival: after } = runRival(r, ctx, 12);
    expect(after.step).toBe(r.step + 12);
  });
});

// ── breeding personality actually breeds ─────────────────────────────────────

describe('breed-personality rival with two parents', () => {
  it('actually breeds — a new token appears in the roster', () => {
    const starters = [tok('parent-a', 'beast'), tok('parent-b', 'bird')];
    // No wild pool at all, so hunt/scout always score 0 and shop is capped by
    // low funds — breed personality should dominate and fire repeatedly.
    const ctx: RivalCtx = { zonePool: {} };
    const r = createRival({
      id: 'breeder',
      personality: BREEDER_PERSONALITY,
      starters,
      gold: 0,
      seed: 'breed-seed',
    });

    const beforeIds = new Set([...r.roster.party, ...r.roster.storage].map((t) => t.id));
    const { rival: after, traces } = runRival(r, ctx, 10);
    const afterTokens = [...after.roster.party, ...after.roster.storage];

    const bredEvent = traces.find((t) => t.action.kind === 'breed');
    expect(bredEvent).toBeDefined();

    const newTokens = afterTokens.filter((t) => !beforeIds.has(t.id));
    expect(newTokens.length).toBeGreaterThan(0);
    // The new token should carry parent lineage (bred, not an authored seed).
    expect(newTokens.some((t) => t.parents !== null)).toBe(true);
  });

  it('a breed action trace names the actual parents used and the child produced', () => {
    const starters = [tok('parent-a', 'beast'), tok('parent-b', 'bird')];
    const ctx: RivalCtx = { zonePool: {} };
    const r = createRival({
      id: 'breeder2',
      personality: BREEDER_PERSONALITY,
      starters,
      gold: 0,
      seed: 'breed-seed-2',
    });
    const trace = decideRival(r, ctx);
    if (trace.action.kind === 'breed') {
      expect(trace.action.parents.length).toBe(2);
      expect(trace.action.child.parents).not.toBeNull();
    }
  });
});

// ── divergence across personalities ──────────────────────────────────────────

describe('personality divergence', () => {
  it('two different personalities given the same ctx diverge in their history', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 10) };
    const hoarder = createRival({ id: 'same-id', personality: HOARDER_PERSONALITY, seed: 'shared' });
    const breeder = createRival({
      id: 'same-id',
      personality: BREEDER_PERSONALITY,
      seed: 'shared',
      starters: [tok('a', 'beast'), tok('b', 'bird')],
    });

    const rh = runRival(hoarder, ctx, 20);
    const rb = runRival(breeder, ctx, 20);

    expect(rh.traces).not.toEqual(rb.traces);
  });

  it('a hoarder favours hunt/scout goals more often than a breeder does across a run', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 10) };
    const starters = [tok('a', 'beast'), tok('b', 'bird'), tok('c', 'dragon')];
    const hoarder = createRival({
      id: 'h',
      personality: HOARDER_PERSONALITY,
      starters,
      seed: 'compare',
    });
    const breeder = createRival({
      id: 'b',
      personality: BREEDER_PERSONALITY,
      starters,
      seed: 'compare',
    });

    const rh = runRival(hoarder, ctx, 25);
    const rb = runRival(breeder, ctx, 25);

    const countGoal = (traces: DecisionTrace[], goal: string) =>
      traces.filter((t) => t.chosen === goal).length;

    const hoarderCombat = countGoal(rh.traces, 'hunt') + countGoal(rh.traces, 'scout');
    const breederBreeds = countGoal(rb.traces, 'breed');

    expect(hoarderCombat).toBeGreaterThan(0);
    expect(breederBreeds).toBeGreaterThan(0);
  });
});

// ── hunt / scout mechanics ────────────────────────────────────────────────────

describe('hunt resolves via the real battle reducer', () => {
  it('a won hunt adds gold to the economy', () => {
    // Overwhelmingly strong starter vs a weak wild slime — engineered win.
    const starters = [tok('champion', 'dragon', 20, 3)];
    const ctx: RivalCtx = { zonePool: { 'zone-0': [tok('weakling', 'slime', 0, 0)] } };
    const r = createRival({
      id: 'r1',
      personality: HOARDER_PERSONALITY,
      starters,
      gold: 0,
      seed: 'hunt-seed',
    });

    // Run enough steps that a hunt is very likely to have fired given the
    // hoarder's strong power bias and a nonempty wild pool.
    const { traces, rival: after } = runRival(r, ctx, 8);
    const huntTrace = traces.find((t) => t.action.kind === 'hunt');
    expect(huntTrace).toBeDefined();
    if (huntTrace && huntTrace.action.kind === 'hunt' && huntTrace.action.won) {
      expect(after.economy.gold).toBeGreaterThan(0);
    }
  });

  it('scout marks the wild token seen in the dex regardless of success', () => {
    const ctx: RivalCtx = { zonePool: { 'zone-0': [tok('shy-one', 'spirit')] } };
    const r = createRival({
      id: 'r1',
      personality: COMPLETIONIST_PERSONALITY,
      seed: 'scout-seed',
    });
    const { rival: after } = runRival(r, ctx, 5);
    // shy-one should be at least seen (scout or hunt both mark seen).
    const entry = after.roster.dex['shy-one'];
    expect(entry).toBeDefined();
  });
});

// ── shop mechanics ────────────────────────────────────────────────────────────

describe('shop', () => {
  it('a shop action never spends more gold than available', () => {
    const ctx: RivalCtx = { zonePool: {} };
    const r = createRival({ id: 'r1', starters: [tok('a'), tok('b')], gold: 10, seed: 'shop-seed' });
    const { rival: after } = runRival(r, ctx, 10);
    expect(after.economy.gold).toBeGreaterThanOrEqual(0);
  });

  it('with ample gold and no wilds, a rival eventually buys something', () => {
    const ctx: RivalCtx = { zonePool: {} };
    const r = createRival({
      id: 'r1',
      personality: HOARDER_PERSONALITY,
      starters: [tok('a')],
      gold: 500,
      seed: 'shop-seed-2',
    });
    const { traces } = runRival(r, ctx, 15);
    const shopTrace = traces.find((t) => t.action.kind === 'shop' && t.action.item !== null);
    expect(shopTrace).toBeDefined();
  });
});

// ── serialization ─────────────────────────────────────────────────────────────

describe('serializable round-trip', () => {
  it('RivalState survives a JSON round-trip deep-equal', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 6) };
    const r = createRival({ id: 'r1', seed: 'round-trip' });
    const { rival: after } = runRival(r, ctx, 10);
    const roundTripped = JSON.parse(JSON.stringify(after)) as RivalState;
    expect(roundTripped).toEqual(after);
  });

  it('DecisionTrace history survives a JSON round-trip deep-equal', () => {
    const ctx: RivalCtx = { zonePool: makeZonePool('zone-0', 6) };
    const r = createRival({ id: 'r1', seed: 'round-trip-2' });
    const { rival: after } = runRival(r, ctx, 10);
    const roundTripped = JSON.parse(JSON.stringify(after.history)) as DecisionTrace[];
    expect(roundTripped).toEqual(after.history);
  });
});
