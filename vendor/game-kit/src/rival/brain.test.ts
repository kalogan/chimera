import { describe, it, expect } from 'vitest';
import { type CreatureToken, type Family } from '../creature/index.js';
import type { ReasoningProvider } from '../npc/provider.js';
import {
  createRival,
  decideRival,
  enumerateOptions,
  RIVAL_GOALS,
  HOARDER_PERSONALITY,
  BREEDER_PERSONALITY,
  type RivalCtx,
  type RivalState,
} from './index.js';
import {
  utilityBrain,
  createGrokRivalBrain,
  stepRivalWithBrain,
  parseRivalGoalChoice,
  type RivalBrain,
} from './brain.js';

function tok(id: string, family: Family = 'slime', plus = 0, generation = 0): CreatureToken {
  return { id, family, plus, generation, parents: null };
}

function makeZonePool(zone: string, n: number, family: Family = 'beast'): Record<string, CreatureToken[]> {
  const tokens: CreatureToken[] = [];
  for (let i = 0; i < n; i++) tokens.push(tok(`${zone}-wild-${i}`, family));
  return { [zone]: tokens };
}

const basicCtx: RivalCtx = { zonePool: makeZonePool('zone-0', 5) };

/** A stub `ReasoningProvider` whose `complete` returns a fixed raw string (or throws). */
function stubProvider(
  opts: {
    complete?: (systemPrompt: string, userPrompt: string, signal?: AbortSignal) => Promise<string>;
    name?: string;
  } = {},
): ReasoningProvider {
  return {
    name: opts.name ?? 'stub',
    async respond() {
      return { intents: [] };
    },
    complete: opts.complete ?? (async () => ''),
  };
}

/**
 * A stub whose `complete` never resolves on its own but, like a real
 * fetch-backed provider, rejects when the caller's `AbortSignal` fires — this
 * is what lets the budget wrapper's timeout actually settle the call.
 */
function neverResolvingProvider(): ReasoningProvider {
  return {
    name: 'stub-hangs',
    async respond() {
      return { intents: [] };
    },
    complete(_system, _user, signal) {
      return new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
  };
}

// ── utilityBrain: determinism vs the sync path ───────────────────────────────

describe('utilityBrain', () => {
  it('via the async path yields the SAME trace as sync decideRival', async () => {
    const r = createRival({ id: 'r1', seed: 'brain-seed' });
    const syncTrace = decideRival(r, basicCtx);
    const asyncTrace = await utilityBrain.decide(r, basicCtx);
    expect(asyncTrace).toEqual(syncTrace);
  });

  it('has a stable id/label', () => {
    expect(utilityBrain.id).toBe('utility');
    expect(utilityBrain.label).toBe('Utility AI');
  });

  it('never stamps a source (plain utility trace shape)', async () => {
    const r = createRival({ id: 'r1', seed: 'no-source' });
    const trace = await utilityBrain.decide(r, basicCtx);
    expect(trace.source).toBeUndefined();
  });
});

// ── enumerateOptions: the single source of truth for the option space ───────

describe('enumerateOptions', () => {
  it('only returns goals whose utility score is > 0', () => {
    const r = createRival({ id: 'r1', currentZone: 'empty-zone' });
    const legal = enumerateOptions(r, { zonePool: {} });
    // No wild pool -> hunt/scout illegal. Only one starter -> breed illegal.
    expect(legal).not.toContain('hunt');
    expect(legal).not.toContain('scout');
    expect(legal).not.toContain('breed');
    expect(legal).toContain('explore');
  });

  it('grows the legal set as ctx content grows (new zone/wild pool) with no brain-code changes', () => {
    const r = createRival({ id: 'r1', currentZone: 'new-zone' });
    const before = enumerateOptions(r, { zonePool: {} });
    const after = enumerateOptions(r, { zonePool: { 'new-zone': [tok('newcomer', 'dragon')] } });
    expect(before).not.toContain('hunt');
    expect(after).toContain('hunt');
  });

  it('is a subset of RIVAL_GOALS, in RIVAL_GOALS order', () => {
    const r = createRival({ id: 'r1' });
    const legal = enumerateOptions(r, basicCtx);
    const order = RIVAL_GOALS.filter((g) => legal.includes(g));
    expect(legal).toEqual(order);
  });
});

// ── SYNC GUARD: both brains see EXACTLY the same option space ────────────────

describe('sync guard — utility brain, Grok prompt, and the firewall all agree on the option space', () => {
  const scenarios: Array<{ label: string; rival: () => RivalState; ctx: RivalCtx }> = [
    {
      label: 'fresh hoarder, empty zone',
      rival: () => createRival({ id: 'r1', personality: HOARDER_PERSONALITY, currentZone: 'empty' }),
      ctx: { zonePool: {} },
    },
    {
      label: 'fresh rival, populated zone',
      rival: () => createRival({ id: 'r2', seed: 'sg-2' }),
      ctx: basicCtx,
    },
    {
      label: 'breeder with two starters, no wilds',
      rival: () =>
        createRival({
          id: 'r3',
          personality: BREEDER_PERSONALITY,
          starters: [tok('a', 'beast'), tok('b', 'bird')],
          gold: 0,
        }),
      ctx: { zonePool: {} },
    },
    {
      label: 'wealthy rival, no wilds, no breed pair',
      rival: () => createRival({ id: 'r4', gold: 1000 }),
      ctx: { zonePool: {} },
    },
  ];

  for (const scenario of scenarios) {
    it(`identical option set across enumerator / utility scoring / firewall accept-set — ${scenario.label}`, () => {
      const rival = scenario.rival();
      const canonical = enumerateOptions(rival, scenario.ctx);

      // (a) the option set the utility brain SCORES as legal (score > 0).
      const utilityTrace = decideRival(rival, scenario.ctx);
      const utilityLegal = RIVAL_GOALS.filter(
        (g) => (utilityTrace.options.find((o) => o.goal === g)?.score ?? 0) > 0,
      );
      expect(utilityLegal).toEqual(canonical);

      // (b) the set a Grok-style firewall accepts — every canonical goal is
      // accepted, and every non-canonical goal is rejected, using the SAME
      // `legal` array a real createGrokRivalBrain call would pass in.
      for (const goal of RIVAL_GOALS) {
        const choice = parseRivalGoalChoice(JSON.stringify({ goal, why: 'because' }), canonical);
        if (canonical.includes(goal)) {
          expect(choice).not.toBeNull();
          expect(choice!.goal).toBe(goal);
        } else {
          expect(choice).toBeNull();
        }
      }
    });
  }

  it('adding a new candidate (a new zone in ctx) appears for BOTH brains without touching brain code', async () => {
    const rival = createRival({ id: 'r-new-zone', currentZone: 'frontier' });
    const before = enumerateOptions(rival, { zonePool: {} });
    const after = enumerateOptions(rival, { zonePool: { frontier: [tok('scout-me', 'spirit')] } });
    expect(after).toContain('scout');
    expect(after).toContain('hunt');
    expect(before).not.toContain('scout');

    // utilityBrain reflects the new legal set immediately (same decideRival scoring).
    const utilityTraceAfter = await utilityBrain.decide(rival, { zonePool: { frontier: [tok('scout-me', 'spirit')] } });
    const utilityLegalAfter = RIVAL_GOALS.filter(
      (g) => (utilityTraceAfter.options.find((o) => o.goal === g)?.score ?? 0) > 0,
    );
    expect(utilityLegalAfter).toEqual(after);

    // A Grok brain choosing the newly-legal 'scout' is now accepted (was previously impossible).
    const provider = stubProvider({ complete: async () => JSON.stringify({ goal: 'scout', why: 'new wilds!' }) });
    const brain = createGrokRivalBrain(provider);
    const grokTrace = await brain.decide(rival, { zonePool: { frontier: [tok('scout-me', 'spirit')] } });
    expect(grokTrace.chosen).toBe('scout');
    expect(grokTrace.source).toBe('grok');
  });
});

// ── the Grok brain: happy path ────────────────────────────────────────────────

describe('createGrokRivalBrain — happy path', () => {
  it('a stub returning {"goal":"hunt","why":"..."} produces a trace with chosen=hunt, source=grok', async () => {
    const r = createRival({ id: 'r1', seed: 'grok-1' });
    const provider = stubProvider({
      complete: async () => JSON.stringify({ goal: 'hunt', why: 'plenty of wild foes here' }),
    });
    const brain = createGrokRivalBrain(provider);
    const trace = await brain.decide(r, basicCtx);

    expect(trace.chosen).toBe('hunt');
    expect(trace.goal).toBe('hunt');
    expect(trace.source).toBe('grok');
    expect(trace.intent).toBe('plenty of wild foes here');
    expect(trace.provider).toContain('stub');
    // options is the full utility scoring, same shape as the sync path.
    expect(trace.options.length).toBe(RIVAL_GOALS.length);
  });

  it('produces a well-formed action for the chosen goal (hunt draws a real foe)', async () => {
    const r = createRival({ id: 'r1', seed: 'grok-action' });
    const provider = stubProvider({
      complete: async () => JSON.stringify({ goal: 'hunt', why: 'attack' }),
    });
    const brain = createGrokRivalBrain(provider);
    const trace = await brain.decide(r, basicCtx);
    expect(trace.action.kind === 'hunt' || trace.action.kind === 'explore').toBe(true);
  });

  it('has a stable id and a default label', () => {
    const brain = createGrokRivalBrain(stubProvider());
    expect(brain.id).toBe('grok');
    expect(brain.label).toBe('Grok');
  });
});

// ── the firewall: rejects illegal goals ──────────────────────────────────────

describe('createGrokRivalBrain — firewall rejects illegal goals', () => {
  it('rejects a nonexistent goal ("fly") -> degrades to utility with source=utility-fallback', async () => {
    const r = createRival({ id: 'r1', seed: 'illegal-1' });
    const provider = stubProvider({ complete: async () => JSON.stringify({ goal: 'fly', why: 'why not' }) });
    const brain = createGrokRivalBrain(provider);

    const utility = decideRival(r, basicCtx);
    const trace = await brain.decide(r, basicCtx);

    expect(trace.source).toBe('utility-fallback');
    expect(trace.chosen).toBe(utility.chosen);
    expect(trace.action).toEqual(utility.action);
  });

  it('rejects a real-but-currently-illegal goal (breed with <2 owned) -> utility-fallback', async () => {
    const r = createRival({ id: 'r1', starters: [tok('only-one')], seed: 'illegal-2' });
    const provider = stubProvider({ complete: async () => JSON.stringify({ goal: 'breed', why: 'combine!' }) });
    const brain = createGrokRivalBrain(provider);

    const trace = await brain.decide(r, basicCtx);
    expect(trace.source).toBe('utility-fallback');
    expect(trace.chosen).not.toBe('breed');
  });

  it('rejects malformed JSON -> utility-fallback', async () => {
    const r = createRival({ id: 'r1', seed: 'illegal-3' });
    const provider = stubProvider({ complete: async () => 'not json at all {' });
    const brain = createGrokRivalBrain(provider);
    const trace = await brain.decide(r, basicCtx);
    expect(trace.source).toBe('utility-fallback');
  });

  it('rejects an empty reply -> utility-fallback', async () => {
    const r = createRival({ id: 'r1', seed: 'illegal-4' });
    const provider = stubProvider({ complete: async () => '' });
    const brain = createGrokRivalBrain(provider);
    const trace = await brain.decide(r, basicCtx);
    expect(trace.source).toBe('utility-fallback');
  });

  it('a stub that throws -> utility-fallback (never rejects the promise)', async () => {
    const r = createRival({ id: 'r1', seed: 'illegal-5' });
    const provider = stubProvider({
      complete: async () => {
        throw new Error('network exploded');
      },
    });
    const brain = createGrokRivalBrain(provider);
    await expect(brain.decide(r, basicCtx)).resolves.toBeDefined();
    const trace = await brain.decide(r, basicCtx);
    expect(trace.source).toBe('utility-fallback');
  });

  it('a stub that times out (never resolves within the budget timeout) -> utility-fallback', async () => {
    const r = createRival({ id: 'r1', seed: 'timeout-1' });
    const brain = createGrokRivalBrain(neverResolvingProvider(), { budget: { timeoutMs: 20 } });
    const trace = await brain.decide(r, basicCtx);
    expect(trace.source).toBe('utility-fallback');
  }, 10_000);

  it('parseRivalGoalChoice directly: drops a goal not in the supplied legal set', () => {
    const choice = parseRivalGoalChoice(JSON.stringify({ goal: 'hunt', why: 'x' }), ['explore', 'shop']);
    expect(choice).toBeNull();
  });

  it('parseRivalGoalChoice directly: accepts a goal that IS in the supplied legal set', () => {
    const choice = parseRivalGoalChoice(JSON.stringify({ goal: 'shop', why: 'buy stuff' }), ['explore', 'shop']);
    expect(choice).toEqual({ goal: 'shop', why: 'buy stuff' });
  });

  it('parseRivalGoalChoice tolerates a fenced ```json block', () => {
    const raw = '```json\n{"goal":"explore","why":"nothing else to do"}\n```';
    const choice = parseRivalGoalChoice(raw, ['explore']);
    expect(choice).toEqual({ goal: 'explore', why: 'nothing else to do' });
  });
});

// ── applyDecision executes identically regardless of which brain chose ──────

describe('applyDecision executes the chosen goal identically whichever brain chose it', () => {
  it('stepRivalWithBrain(utilityBrain) matches stepRival for the same rival/ctx', async () => {
    const r = createRival({ id: 'r1', seed: 'apply-compare' });
    const { rival: syncRival, trace: syncTrace } = await import('./index.js').then((m) => m.stepRival(r, basicCtx));
    const { rival: asyncRival, trace: asyncTrace } = await stepRivalWithBrain(r, basicCtx, utilityBrain);
    expect(asyncTrace).toEqual(syncTrace);
    expect(asyncRival).toEqual(syncRival);
  });

  it('a Grok-chosen hunt applies via the real battle/roster/economy reducers, same as a utility-chosen hunt', async () => {
    const starters = [tok('champion', 'dragon', 20, 3)];
    const ctx: RivalCtx = { zonePool: { 'zone-0': [tok('weakling', 'slime', 0, 0)] } };
    const r = createRival({ id: 'r1', starters, gold: 0, currentZone: 'zone-0', seed: 'apply-hunt' });

    const provider = stubProvider({ complete: async () => JSON.stringify({ goal: 'hunt', why: 'attack!' }) });
    const brain = createGrokRivalBrain(provider);

    const { rival: after, trace } = await stepRivalWithBrain(r, ctx, brain);
    expect(trace.source).toBe('grok');
    expect(trace.action.kind).toBe('hunt');
    // markSeen always runs for a hunt action, regardless of which brain chose it.
    expect(after.roster.dex['weakling']).toBeDefined();
    expect(after.step).toBe(r.step + 1);
  });

  it('a custom RivalBrain that always picks a fixed legal goal applies through the same reducers', async () => {
    const r = createRival({ id: 'r1', gold: 500, starters: [tok('a')], seed: 'custom-brain' });
    const fixedBrain: RivalBrain = {
      id: 'fixed-shop',
      label: 'Always Shop',
      async decide(rival, ctx) {
        const utility = decideRival(rival, ctx);
        // Force 'shop' if legal, else fall back to whatever utility chose.
        const legal = enumerateOptions(rival, ctx);
        if (legal.includes('shop') && utility.chosen !== 'shop') {
          const { chooseActionForGoal, stepRng } = await import('./index.js');
          const action = chooseActionForGoal(rival, ctx, 'shop', stepRng(rival));
          return { ...utility, chosen: 'shop', goal: 'shop', action, source: 'utility' as const };
        }
        return utility;
      },
    };

    const { rival: after, trace } = await stepRivalWithBrain(r, { zonePool: {} }, fixedBrain);
    expect(trace.chosen).toBe('shop');
    if (trace.action.kind === 'shop' && trace.action.item) {
      expect(after.economy.gold).toBeLessThan(500);
    }
  });
});

// ── existing utility tests stay green (spot-check a few invariants here too) ─

describe('back-compat: DecisionTrace shape unaffected for the plain utility path', () => {
  it('decideRival output has no source/provider fields set', () => {
    const r = createRival({ id: 'r1', seed: 'compat-1' });
    const trace = decideRival(r, basicCtx);
    expect('source' in trace ? trace.source : undefined).toBeUndefined();
    expect('provider' in trace ? trace.provider : undefined).toBeUndefined();
  });

  it('a JSON round trip of a Grok-sourced trace still deep-equals itself', async () => {
    const r = createRival({ id: 'r1', seed: 'compat-2' });
    const provider = stubProvider({ complete: async () => JSON.stringify({ goal: 'explore', why: 'chill' }) });
    const brain = createGrokRivalBrain(provider);
    const trace = await brain.decide(r, basicCtx);
    const roundTripped = JSON.parse(JSON.stringify(trace));
    expect(roundTripped).toEqual(trace);
  });
});
