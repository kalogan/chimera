/**
 * rival — a PURE, THREE-FREE, deterministic simulation of an AI RIVAL that
 * "plays the game" off-screen. A rival owns its own roster/dex/economy and
 * advances by a deterministic UTILITY AI whose every decision emits an
 * inspectable `DecisionTrace` — the data a dev "brain visualization" renders.
 *
 * THREE-FREE + PURE + DETERMINISTIC: no three, no DOM, no Math.random, no
 * Date.now. All randomness flows through `../prng`'s seeded `Rng`, so the same
 * (seed, ctx, action sequence) always reproduces an identical `RivalState` AND
 * an identical `DecisionTrace` stream.
 *
 * This module COMPOSES the existing kit reducers rather than reinventing them:
 * `creature` (token → creature), `breeding` (breed), `battle`
 * (createBattle/step), `roster` (createRoster/addCreature/markSeen), and
 * `economy` (createEconomy/addGold/buy). A rival's decision is a plain
 * argmax-with-seeded-tiebreak over a small set of goal-utility scores — the
 * same idiom as `behavior/utility.ts`'s `createUtilitySelector`, specialised
 * to a fixed goal enum so the trace stays legible for an inspector.
 *
 * NO LLM here. A future Grok strategy/narration layer wraps this: it can set
 * `personality` (data, see `RivalPersonality`) to steer goal weights, and it
 * can re-narrate `intent` for flavour — but it never touches the deterministic
 * scoring or the kit reducers, so the inspector's trace stays truthful.
 */

import {
  creatureFromToken,
  seedToken,
  type Creature,
  type CreatureToken,
  type Family,
} from '../creature/index.js';
import { breed } from '../breeding/index.js';
import {
  createBattle,
  step as battleStep,
  type BattleState,
  type BattleAction,
  type Combatant,
} from '../battle/index.js';
import {
  createRoster,
  addCreature,
  markSeen,
  dexCount,
  type RosterState,
} from '../roster/index.js';
import {
  createEconomy,
  addGold,
  buy,
  shopFor,
  ITEMS as ECONOMY_ITEMS,
  type EconomyState,
} from '../economy/index.js';
import { createRng, hashStringToSeed, type Rng } from '../prng/index.js';

// ── personality ──────────────────────────────────────────────────────────────

/**
 * Goal-weight biases that make rivals diverge. Each weight is a non-negative
 * multiplier applied on top of the base utility score for the goals it
 * influences (see `SCORERS` below). `favoredFamily`, when set, nudges both
 * breeding-parent choice and shop/hunt flavour toward that family.
 *
 * This is the seam a future Grok layer plugs into: personality is DATA an LLM
 * can author or adjust (e.g. from a narrated backstory) without touching any
 * of the deterministic scoring code below.
 */
export interface RivalPersonality {
  name: string;
  /** Appetite for scouting/collecting new species. */
  collect: number;
  /** Appetite for breeding owned creatures into new ones. */
  breed: number;
  /** Appetite for fighting to grow strength/gold/rank. */
  power: number;
  /** Optional family this rival favors (breeding parent choice, hunt/shop flavour). */
  favoredFamily?: Family;
}

/** A dragon-hoarder: fights and hunts hard, favors dragons, breeds rarely. */
export const HOARDER_PERSONALITY: RivalPersonality = {
  name: 'Hoarder',
  collect: 0.3,
  breed: 0.2,
  power: 1.0,
  favoredFamily: 'dragon',
};

/** A breeder: prioritizes combining owned creatures into new lineages. */
export const BREEDER_PERSONALITY: RivalPersonality = {
  name: 'Breeder',
  collect: 0.4,
  breed: 1.0,
  power: 0.3,
};

/** A completionist: scouts/collects everything, breeds and fights moderately. */
export const COMPLETIONIST_PERSONALITY: RivalPersonality = {
  name: 'Completionist',
  collect: 1.0,
  breed: 0.5,
  power: 0.5,
};

/** All named presets, in declaration order — handy for tests/UI pickers. */
export const RIVAL_PERSONALITY_PRESETS: readonly RivalPersonality[] = [
  HOARDER_PERSONALITY,
  BREEDER_PERSONALITY,
  COMPLETIONIST_PERSONALITY,
];

// ── goals ────────────────────────────────────────────────────────────────────

/** The legible goal set a rival can choose between on any given step. */
export type RivalGoal = 'explore' | 'hunt' | 'scout' | 'breed' | 'shop' | 'rank-up';

export const RIVAL_GOALS: readonly RivalGoal[] = [
  'explore',
  'hunt',
  'scout',
  'breed',
  'shop',
  'rank-up',
];

// ── decision trace (the inspector payload) ──────────────────────────────────

/** One scored candidate goal, with a short human-readable reason for its score. */
export interface RivalGoalOption {
  goal: RivalGoal;
  score: number;
  reason: string;
}

/** What a rival actually did after choosing a goal. A plain, data-only union. */
export type RivalAction =
  | { kind: 'hunt'; foe: CreatureToken; won: boolean; goldEarned: number }
  | { kind: 'scout'; foe: CreatureToken; success: boolean }
  | { kind: 'breed'; parents: [CreatureToken, CreatureToken]; child: CreatureToken }
  | { kind: 'shop'; item: string | null }
  | { kind: 'explore' }
  | { kind: 'rank-up' };

/**
 * THE INSPECTOR PAYLOAD. Every step's decision, fully self-describing: every
 * candidate goal scored with a reason, the one that won, what the rival did
 * about it, and a short "what it's trying to do" sentence a dev tool renders
 * next to the numbers.
 *
 * `source`/`provider` are OPTIONAL, back-compat fields stamped by `rival/brain.ts`'s
 * swappable-brain seam (see `RivalBrain`). The deterministic utility path
 * (`decideRival`/`stepRival`) never sets them, so every existing trace + test is
 * byte-for-byte unchanged; a brain-driven decision stamps `source` so an inspector
 * can badge "Grok chose this" vs "the utility AI chose this" vs "Grok failed, this
 * is the utility fallback" on the SAME trace shape.
 */
export interface DecisionTrace {
  step: number;
  goal: RivalGoal;
  options: RivalGoalOption[];
  chosen: RivalGoal;
  action: RivalAction;
  /** Short human-readable "what it's trying to do" sentence. */
  intent: string;
  /** Which brain produced this trace. Omitted by the plain utility path. */
  source?: 'utility' | 'grok' | 'utility-fallback';
  /** Diagnostics: the underlying provider name (e.g. 'grok', 'mock'), when a brain was used. */
  provider?: string;
}

// ── rival state ──────────────────────────────────────────────────────────────

/** How many trace entries `stepRival`/`runRival` retain in `history`. */
export const HISTORY_CAP = 20;

/** The whole rival, serializable end to end (plain data only). */
export interface RivalState {
  id: string;
  name: string;
  personality: RivalPersonality;
  roster: RosterState;
  economy: EconomyState;
  currentZone: string;
  rngSeed: number;
  step: number;
  /** Capped ring of the most recent decision traces (newest last). */
  history: DecisionTrace[];
}

/** Options for `createRival`. */
export interface CreateRivalOptions {
  id: string;
  name?: string;
  personality?: RivalPersonality;
  /** Starting zone the rival begins roaming in. */
  currentZone?: string;
  /** Numeric seed; a string is hashed via `hashStringToSeed`. */
  seed?: number | string;
  /** Starting party/roster tokens — defaults to one seeded starter. */
  starters?: CreatureToken[];
  /** Starting gold. */
  gold?: number;
}

/** The minimal, pure context a decision/step needs. */
export interface RivalCtx {
  /** Wild tokens available per zone — the rival draws from its current zone's pool. */
  zonePool: Record<string, CreatureToken[]>;
}

/** Create a fresh, seeded rival. Deterministic: same opts → deep-equal RivalState. */
export function createRival(opts: CreateRivalOptions): RivalState {
  const personality = opts.personality ?? HOARDER_PERSONALITY;
  const seed =
    typeof opts.seed === 'string'
      ? hashStringToSeed(opts.seed)
      : ((opts.seed ?? hashStringToSeed(opts.id)) >>> 0);
  const starters = opts.starters ?? [seedToken(`${opts.id}:starter`)];

  return {
    id: opts.id,
    name: opts.name ?? personality.name,
    personality,
    roster: createRoster(starters),
    economy: createEconomy({ gold: opts.gold ?? 50 }),
    currentZone: opts.currentZone ?? 'zone-0',
    rngSeed: seed,
    step: 0,
    history: [],
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Fork a fresh, deterministic rng for a given step from the rival's seed +
 * cursor. Exported so a non-utility brain (`rival/brain.ts`) can build a real,
 * seed-stable `RivalAction` via `chooseActionForGoal` for whatever goal IT
 * picked, using the exact same fork lineage `decideRival` uses internally.
 */
export function stepRng(rival: RivalState): Rng {
  return createRng(rival.rngSeed).fork(rival.step);
}

function ownedTokens(rival: RivalState): CreatureToken[] {
  return [...rival.roster.party, ...rival.roster.storage];
}

/** Pick a zone's wild pool, seed-stable draw; undefined if the zone has none. */
function drawWild(ctx: RivalCtx, zone: string, rng: Rng): CreatureToken | undefined {
  const pool = ctx.zonePool[zone];
  if (!pool || pool.length === 0) return undefined;
  return rng.pick(pool);
}

/** Two owned tokens best suited to breed, biased toward the favored family if any. */
function pickBreedingParents(
  rival: RivalState,
  rng: Rng,
): [CreatureToken, CreatureToken] | undefined {
  const owned = ownedTokens(rival);
  if (owned.length < 2) return undefined;

  const favored = rival.personality.favoredFamily;
  const sorted = owned.slice().sort((a, b) => {
    const fa = favored && a.family === favored ? 1 : 0;
    const fb = favored && b.family === favored ? 1 : 0;
    return fb - fa || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  // Deterministic pick: strongest bias picks the top two, but fork a coin so
  // ties among equally-favored tokens still vary across seeds.
  const a = sorted[0]!;
  const rest = sorted.slice(1);
  const b = rng.pick(rest);
  return [a, b];
}

/** A cheap, useful, affordable shop item — prefers a stat-seed, else a heal item. */
function pickShopItem(economy: EconomyState, zoneTier: number): string | null {
  const stock = shopFor(zoneTier);
  const affordable = stock.filter((id) => {
    const price = SHOP_PRICES[id];
    return price !== undefined && price <= economy.gold;
  });
  if (affordable.length === 0) return null;
  const preferred = affordable.find((id) => id.endsWith('-seed')) ?? affordable[0]!;
  return preferred;
}

// Local price lookup so `pickShopItem` can filter by affordability without a
// second import site.
const SHOP_PRICES: Record<string, number> = Object.fromEntries(
  Object.values(ECONOMY_ITEMS).map((d) => [d.id, d.price]),
);

/** A simple deterministic auto-battle policy: attack the first living foe. */
function autoResolveBattle(playerTeam: Creature[], enemyTeam: Creature[], seed: number): boolean {
  let state: BattleState = createBattle(playerTeam, enemyTeam, seed);
  let guard = 0;
  while (state.phase === 'choosing' && guard < 200) {
    guard += 1;
    const id = state.turnOrder[state.activeIndex];
    const actor = id ? findActor(state, id) : undefined;
    const targets = state.enemyTeam.filter((c) => c.alive && c.active);
    const action: BattleAction =
      actor && targets.length > 0
        ? { type: 'attack', targetId: targets[0]!.id }
        : { type: 'defend' };
    const result = battleStep(state, action);
    state = result.state;
  }
  return state.phase === 'won';
}

function findActor(state: BattleState, id: string): Combatant | undefined {
  return state.playerTeam.find((c) => c.id === id) ?? state.enemyTeam.find((c) => c.id === id);
}

/** Gold awarded for a won hunt — scales lightly with the foe's rank via its stats. */
function goldForVictory(foe: Creature): number {
  return 10 + Math.round(foe.stats.hp / 4);
}

// ── utility scoring ──────────────────────────────────────────────────────────

interface ScoreCtx {
  rival: RivalState;
  ctx: RivalCtx;
  ownedCount: number;
  dexTotal: number;
  hasBreedPair: boolean;
  wildAvailable: boolean;
}

/**
 * Per-goal utility scorers. Each returns a { score, reason } pair. Scores are
 * plain additive utility (no normalization) — legible numbers an inspector can
 * show directly next to the reason. Ties break by declaration order in
 * `RIVAL_GOALS` (see `decideRival`), then by a seeded coin as a last resort.
 */
const SCORERS: Record<RivalGoal, (s: ScoreCtx) => RivalGoalOption> = {
  explore: () => ({
    goal: 'explore',
    score: 0.2,
    reason: 'baseline wandering — always a little appealing, never urgent',
  }),

  hunt: (s) => {
    const base = 0.4 + s.rival.personality.power * 0.8;
    const smallParty = s.rival.roster.party.length <= 1 ? 0.3 : 0;
    const score = s.wildAvailable ? base + smallParty : 0;
    const reason = s.wildAvailable
      ? `power=${s.rival.personality.power.toFixed(2)} bias${smallParty ? ' + small party wants a fighter' : ''}`
      : 'no wild foe available in this zone';
    return { goal: 'hunt', score, reason };
  },

  scout: (s) => {
    const base = 0.3 + s.rival.personality.collect * 0.9;
    const score = s.wildAvailable ? base : 0;
    const reason = s.wildAvailable
      ? `collect=${s.rival.personality.collect.toFixed(2)} bias, dex=${s.dexTotal}`
      : 'no wild species available in this zone';
    return { goal: 'scout', score, reason };
  },

  breed: (s) => {
    const base = 0.2 + s.rival.personality.breed * 1.1;
    const score = s.hasBreedPair ? base : 0;
    const reason = s.hasBreedPair
      ? `breed=${s.rival.personality.breed.toFixed(2)} bias, ${s.ownedCount} owned tokens to pair`
      : 'fewer than two owned creatures to pair';
    return { goal: 'breed', score, reason };
  },

  shop: (s) => {
    const wantsItem = pickShopItem(s.rival.economy, 0) !== null;
    const score = wantsItem ? 0.15 + s.rival.economy.gold / 500 : 0;
    const reason = wantsItem
      ? `gold=${s.rival.economy.gold}, an affordable item is in stock`
      : 'nothing affordable/useful to buy right now';
    return { goal: 'shop', score, reason };
  },

  'rank-up': (s) => {
    const score = s.ownedCount >= 4 ? 0.1 + s.rival.personality.power * 0.15 : 0;
    const reason =
      s.ownedCount >= 4
        ? `roster is established (${s.ownedCount} owned) — worth consolidating rank`
        : 'roster too small to bother ranking up yet';
    return { goal: 'rank-up', score, reason };
  },
};

function intentFor(goal: RivalGoal, personality: RivalPersonality): string {
  switch (goal) {
    case 'hunt':
      return `${personality.name} is hunting a wild foe to grow stronger.`;
    case 'scout':
      return `${personality.name} is scouting a wild creature to add to the dex.`;
    case 'breed':
      return `${personality.name} is breeding two owned creatures into a new lineage.`;
    case 'shop':
      return `${personality.name} is shopping for a useful item.`;
    case 'rank-up':
      return `${personality.name} is consolidating rank across its roster.`;
    case 'explore':
      return `${personality.name} is exploring, nothing more urgent to do.`;
  }
}

// ── decide + step ────────────────────────────────────────────────────────────

/**
 * Score every candidate goal against `rival`'s state + personality and pick
 * the max (seeded tiebreak among equal top scores). PURE: does not apply any
 * action or mutate `rival` — this is only the deterministic decision the
 * inspector shows. `stepRival` calls this then applies the chosen action.
 */
export function decideRival(rival: RivalState, ctx: RivalCtx): DecisionTrace {
  const rng = stepRng(rival);
  const scoreCtx = buildScoreCtx(rival, ctx);

  const options = RIVAL_GOALS.map((g) => SCORERS[g](scoreCtx));

  // Argmax with a stable declaration-order tiebreak, then a seeded coin among
  // any goals still exactly tied with the best after that pass.
  let bestScore = -Infinity;
  for (const o of options) if (o.score > bestScore) bestScore = o.score;
  const tied = options.filter((o) => o.score === bestScore);
  const chosen = tied.length === 1 ? tied[0]!.goal : rng.pick(tied).goal;

  const action = chooseActionForGoal(rival, ctx, chosen, rng);

  return {
    step: rival.step,
    goal: chosen,
    options,
    chosen,
    action,
    intent: intentFor(chosen, rival.personality),
  };
}

/**
 * Build the `ScoreCtx` every goal is scored against — the single place that
 * reads `rival`/`ctx` CONTENT (zone, wild pool, owned tokens, dex, breed
 * pairs) into the inputs the scorers use. Both `decideRival`'s scoring and
 * `enumerateOptions`'s legality check call this, so they can never read the
 * state two different ways.
 */
function buildScoreCtx(rival: RivalState, ctx: RivalCtx): ScoreCtx {
  const owned = ownedTokens(rival);
  return {
    rival,
    ctx,
    ownedCount: owned.length,
    dexTotal: dexCount(rival.roster),
    hasBreedPair: owned.length >= 2,
    wildAvailable: (ctx.zonePool[rival.currentZone]?.length ?? 0) > 0,
  };
}

/**
 * THE SINGLE SOURCE OF TRUTH for "what can this rival actually do right now."
 * Scores every declared goal (`RIVAL_GOALS`) against the LIVE content in
 * `rival`/`ctx` via the exact same `SCORERS` `decideRival` uses, then returns
 * only the ones the game would actually allow (score > 0), in `RIVAL_GOALS`
 * order. `explore` is always included — it is the always-legal baseline.
 *
 * BOTH brains in `rival/brain.ts` MUST derive their option space from this
 * function and nothing else: the utility brain scores exactly these
 * candidates (it already does, via `decideRival`'s own call to this same
 * builder), and the Grok brain's prompt menu + firewall accept-set are BOTH
 * `enumerateOptions(...)` output. As content grows (new zones in `zonePool`,
 * more owned tokens, more affordable shop items, a future new goal added to
 * `RIVAL_GOALS`/`SCORERS`), this function alone decides what's legal — no
 * hardcoded list anywhere else can drift out of sync with it.
 */
export function enumerateOptions(rival: RivalState, ctx: RivalCtx): RivalGoal[] {
  const scoreCtx = buildScoreCtx(rival, ctx);
  return RIVAL_GOALS.filter((g) => SCORERS[g](scoreCtx).score > 0);
}

/**
 * @deprecated Alias for {@link enumerateOptions} kept for readability at call
 * sites that only care about "what's legal" rather than "the option menu."
 * Same function, same identity — not a second implementation.
 */
export const legalGoals = enumerateOptions;

/**
 * Decide WHAT a given goal's action will look like (still pure — no state
 * mutation). Exported so a non-utility brain (e.g. `rival/brain.ts`'s Grok
 * brain) can build a real, legal `RivalAction` for whatever goal IT chose from
 * `enumerateOptions`, without re-deriving `decideRival`'s rng-fork lineage or
 * duplicating this switch. Same `rng` fork discipline as `decideRival` itself
 * — call with `stepRng(rival)` (or a fork of it) for determinism.
 */
export function chooseActionForGoal(rival: RivalState, ctx: RivalCtx, goal: RivalGoal, rng: Rng): RivalAction {
  switch (goal) {
    case 'hunt':
    case 'scout': {
      const foe = drawWild(ctx, rival.currentZone, rng.fork(1));
      if (!foe) return { kind: 'explore' };
      if (goal === 'scout') {
        // Resolved fully in stepRival (needs roster mutation); here we only
        // describe the intended foe — success is determined in stepRival via
        // the same rng fork so decide/step stay in lockstep.
        const successRng = rng.fork(2);
        const success = successRng.next() < 0.5 + rival.personality.collect * 0.3;
        return { kind: 'scout', foe, success };
      }
      const playerParty = ownedCreaturesInParty(rival);
      const enemy = [creatureFromToken(foe)];
      const won =
        playerParty.length > 0
          ? autoResolveBattle(playerParty, enemy, rng.fork(3).int(0x7fffffff))
          : false;
      return { kind: 'hunt', foe, won, goldEarned: won ? goldForVictory(enemy[0]!) : 0 };
    }
    case 'breed': {
      const pair = pickBreedingParents(rival, rng.fork(4));
      if (!pair) return { kind: 'explore' };
      const [ta, tb] = pair;
      const a = creatureFromToken(ta);
      const b = creatureFromToken(tb);
      const result = breed(a, b, rng.fork(5));
      return { kind: 'breed', parents: [ta, tb], child: result.childToken };
    }
    case 'shop': {
      const item = pickShopItem(rival.economy, 0);
      return { kind: 'shop', item };
    }
    case 'rank-up':
      return { kind: 'rank-up' };
    case 'explore':
      return { kind: 'explore' };
  }
}

function ownedCreaturesInParty(rival: RivalState): Creature[] {
  return rival.roster.party.map(creatureFromToken);
}

/**
 * APPLY a (possibly brain-chosen) `DecisionTrace` to `rival` using the real kit
 * reducers, appending it to `history` (capped at `HISTORY_CAP`). PURE + fully
 * deterministic given the trace: same (rival, trace) → same next rival.
 *
 * This is the shared EXECUTION SPINE both the sync utility path (`stepRival`)
 * and the async swappable-brain path (`rival/brain.ts`'s `stepRivalWithBrain`)
 * call — there is exactly one place that turns a chosen goal/action into state
 * mutation, so whichever brain chose the trace, the game applies it identically
 * (the firewall: brains propose, `applyDecision` disposes).
 */
export function applyDecision(
  rival: RivalState,
  _ctx: RivalCtx,
  trace: DecisionTrace,
): RivalState {
  let roster = rival.roster;
  let economy = rival.economy;

  switch (trace.action.kind) {
    case 'hunt': {
      roster = markSeen(roster, trace.action.foe);
      if (trace.action.won && trace.action.goldEarned > 0) {
        economy = addGold(economy, trace.action.goldEarned);
      }
      break;
    }
    case 'scout': {
      roster = markSeen(roster, trace.action.foe);
      if (trace.action.success) {
        roster = addCreature(roster, trace.action.foe);
      }
      break;
    }
    case 'breed': {
      roster = addCreature(roster, trace.action.child);
      break;
    }
    case 'shop': {
      if (trace.action.item) {
        const result = buy(economy, trace.action.item);
        if (result.ok) economy = result.state;
      }
      break;
    }
    case 'explore':
    case 'rank-up':
      break;
  }

  const history = [...rival.history, trace].slice(-HISTORY_CAP);

  return {
    ...rival,
    roster,
    economy,
    step: rival.step + 1,
    history,
  };
}

/**
 * Decide THEN apply the chosen action using the real kit reducers, appending
 * the resulting trace to `history` (capped at `HISTORY_CAP`). Fully
 * deterministic: same (rival, ctx) → same next rival + same trace. UNCHANGED
 * behaviour — this is the plain deterministic utility path; it now shares its
 * apply step with `applyDecision` but the outputs are byte-for-byte identical
 * to before.
 */
export function stepRival(rival: RivalState, ctx: RivalCtx): { rival: RivalState; trace: DecisionTrace } {
  const trace = decideRival(rival, ctx);
  const next = applyDecision(rival, ctx, trace);
  return { rival: next, trace };
}

/** Convenience loop: run `nSteps` of `stepRival`, returning the final rival + all traces. */
export function runRival(
  rival: RivalState,
  ctx: RivalCtx,
  nSteps: number,
): { rival: RivalState; traces: DecisionTrace[] } {
  let current = rival;
  const traces: DecisionTrace[] = [];
  for (let i = 0; i < nSteps; i++) {
    const { rival: next, trace } = stepRival(current, ctx);
    current = next;
    traces.push(trace);
  }
  return { rival: current, traces };
}
