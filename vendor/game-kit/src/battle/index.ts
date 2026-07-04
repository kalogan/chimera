/**
 * battle — turn-based N-vs-N (3v3) combat as a PURE, DETERMINISTIC reducer that
 * emits an ordered `BattleEvent[]` STREAM.
 *
 * THREE-FREE / DOM-FREE: no `three` import, no DOM access, no `Math.random()`,
 * no `Date.now()`. All randomness flows through a seeded `Rng` (see
 * `../prng/index.js`) derived from the battle `seed` + a per-turn cursor, so the
 * same seed + the same action sequence always reproduces an identical
 * `BattleState` AND an identical `BattleEvent[]` stream.
 *
 * The event stream is THE LOAD-BEARING SEAM: render / juice / audio layers
 * CONSUME it and must never re-derive combat. Same shape as `board.resolve()`.
 *
 *   - `createBattle` sets up combatants (current hp/mp from stats, alive flag,
 *     stable id) and speed-orders the field by `agi`.
 *   - `step` resolves the player's chosen action for the current actor, then
 *     auto-runs enemy AI turns until it's the player's turn again (or the battle
 *     ends), returning the FULL ordered event stream and a NEW state (never
 *     mutating the input).
 *
 * Creatures FAINT (hp floored at 0, `alive=false`) — never die. Keep it tender.
 */

import type { Creature, CreatureToken, Element, Skill } from '../creature/types.js';
import { RANKS } from '../creature/types.js';
import { createRng, type Rng } from '../prng/index.js';
import {
  ELEMENT_CHART,
  EFFECTIVENESS_MULTIPLIER,
  effectiveness,
  type Effectiveness,
} from './element.js';

export { ELEMENT_CHART, EFFECTIVENESS_MULTIPLIER, effectiveness };
export type { Effectiveness };

// ── tunables ─────────────────────────────────────────────────────────────────
// Kept legible + together so combat can be re-balanced without hunting.

/** How many combatants stand on the field per side; the rest are bench. */
export const FIELD_SIZE = 3;
/** Baseline power of a plain (non-skill) attack. */
export const BASIC_ATTACK_POWER = 6;
/** How much the attacker's atk contributes to raw damage. */
const ATK_WEIGHT = 1;
/** How much the defender's def subtracts from raw damage. */
const DEF_WEIGHT = 0.5;
/** ± seeded variance band applied to every damage roll (0.15 → ×0.85..×1.15). */
const VARIANCE = 0.15;
/** Same-element-as-attacker bonus (STAB). */
const STAB_MULT = 1.25;
/** Incoming-damage multiplier while `defending`. */
const DEFEND_MULT = 0.5;
/** Magnitude of a single buff/debuff stack (fraction of the stat). */
const BUFF_MAGNITUDE = 0.25;
/** How many of the target's OWN turns a buff/debuff lasts. */
const BUFF_TURNS = 3;
/** wis contribution to heal amount. */
const HEAL_WIS_WEIGHT = 0.5;

/** Scout chance model: base + hp-missing weight + rank-gap weight, then clamped. */
const SCOUT_BASE = 0.15;
const SCOUT_HP_WEIGHT = 0.5;
const SCOUT_RANK_WEIGHT = 0.06;
const SCOUT_MIN = 0.02;
const SCOUT_MAX = 0.95;

/** Flee chance model: base nudged by the actor's agi vs the enemy field's agi. */
const FLEE_BASE = 0.5;
const FLEE_AGI_WEIGHT = 0.4;
const FLEE_MIN = 0.05;
const FLEE_MAX = 0.95;

/** XP awarded per fainted enemy, and the threshold that reads as a level-up. */
const XP_PER_ENEMY = 25;
const LEVEL_XP = 100;

/** Enemy AI thresholds. */
const AI_HEAL_HP_THRESHOLD = 0.35;
const AI_ALLY_INJURED_THRESHOLD = 0.5;
const AI_SKILL_CHANCE = 0.5;

/** Safety cap so a pathological loop can never run forever. */
const MAX_TURNS = 2000;

// ── public types ─────────────────────────────────────────────────────────────

/** Which side a combatant fights for. */
export type Side = 'player' | 'enemy';

/** A transient stat modifier or the `defending` guard, ticked on the owner's turn. */
export interface Status {
  kind: 'atk-up' | 'atk-down' | 'def-up' | 'def-down' | 'defending';
  /** Fraction magnitude (e.g. 0.25). Unused (0) for `defending`. */
  magnitude: number;
  /** Remaining turns (in the owner's OWN turns); removed at 0. */
  turns: number;
}

/**
 * A single fighter. Fully serializable: it carries the identity `token` (a ref
 * the assembly can re-express with `creatureFromToken`) plus the live battle
 * numbers, so no functions or class instances leak into `BattleState`.
 */
export interface Combatant {
  /** Stable id within this battle (e.g. `P0`, `E1`). */
  id: string;
  side: Side;
  name: string;
  /** Identity ref — lets the assembly rebuild the full creature on scout/xp. */
  token: CreatureToken;
  elements: Element[];
  maxHp: number;
  maxMp: number;
  currentHp: number;
  currentMp: number;
  atk: number;
  def: number;
  agi: number;
  wis: number;
  /** RANKS index (0=F .. 6=S) — feeds the scout gap. */
  rankIndex: number;
  skills: Skill[];
  /** false once fainted (hp reached 0). Never negative hp, never "dead". */
  alive: boolean;
  /** On the field (true) vs bench (false). */
  active: boolean;
  statuses: Status[];
}

/** The whole battle, serializable end to end (plain data only). */
export interface BattleState {
  /** Battle seed — same seed + same actions → identical state + stream. */
  seed: number;
  /** RNG cursor: number of turns taken. Forks a fresh stream per turn. */
  turnCount: number;
  /** Full round counter (increments each time the field wraps). */
  round: number;
  playerTeam: Combatant[];
  enemyTeam: Combatant[];
  /** Combatant ids in speed order (agi desc, id asc tie-break). */
  turnOrder: string[];
  /** Index into `turnOrder` of the actor whose turn it is. */
  activeIndex: number;
  phase: 'choosing' | 'won' | 'lost';
}

/** What kind of thing an actor did — mirrors `BattleAction` for the juice layer. */
export type ActionKind = 'attack' | 'skill' | 'defend' | 'scout' | 'swap' | 'flee' | 'item';

/**
 * A plain-data effect payload for the `item` action. DECOUPLED from the economy
 * module on purpose: battle never resolves an item id or looks up a recipe —
 * the game/assembly resolves its economy item to this shape and hands it in.
 */
export interface BattleItemEffect {
  /** HP to restore (pre-clamp; clamped to maxHp). Ignored on a fainted target unless `revive`. */
  heal?: number;
  /** MP to restore (pre-clamp; clamped to maxMp). */
  mp?: number;
  /** Un-faint a fainted target. See `resolveItem` for the exact hp-on-revive rule. */
  revive?: boolean;
}

/** The player's chosen action for the current actor. */
export type BattleAction =
  | { type: 'attack'; targetId: string }
  | { type: 'skill'; skillId: string; targetId?: string }
  | { type: 'defend' }
  | { type: 'scout'; targetId: string }
  | { type: 'swap'; benchId: string }
  | { type: 'flee' }
  | { type: 'item'; targetId: string; effect: BattleItemEffect };

/**
 * The event stream. Each variant carries enough for an audio/juice layer to
 * react without touching combat math (e.g. `damage` gives amount + element +
 * effectiveness to scale the impact sound).
 */
export type BattleEvent =
  | { type: 'turn-start'; actorId: string; round: number; turn: number }
  | { type: 'action'; actorId: string; kind: ActionKind }
  | {
      type: 'damage';
      sourceId: string;
      targetId: string;
      amount: number;
      element: Element;
      effectiveness: Effectiveness;
    }
  | { type: 'heal'; sourceId: string; targetId: string; amount: number }
  | { type: 'item'; actorId: string; targetId: string; effect: BattleItemEffect }
  | { type: 'buff'; sourceId: string; targetId: string; stat: 'atk' | 'def'; magnitude: number }
  | { type: 'debuff'; sourceId: string; targetId: string; stat: 'atk' | 'def'; magnitude: number }
  | { type: 'faint'; targetId: string }
  | { type: 'scout'; actorId: string; targetId: string; success: boolean; chance: number }
  | { type: 'miss'; actorId: string; targetId?: string }
  | { type: 'defend'; actorId: string }
  | { type: 'swap'; outId: string | null; inId: string }
  | { type: 'flee'; actorId: string; success: boolean; chance: number }
  | { type: 'victory' }
  | { type: 'defeat' }
  | { type: 'xp'; actorId: string; amount: number }
  | { type: 'level-up'; actorId: string; level: number };

// ── setup ────────────────────────────────────────────────────────────────────

function combatantFromCreature(c: Creature, side: Side, index: number): Combatant {
  const id = `${side === 'player' ? 'P' : 'E'}${index}`;
  const rankIndex = Math.max(0, RANKS.indexOf(c.rank));
  return {
    id,
    side,
    name: c.name,
    token: { ...c.token, parents: c.token.parents ? [...c.token.parents] : null },
    elements: [...c.elements],
    maxHp: c.stats.hp,
    maxMp: c.stats.mp,
    currentHp: c.stats.hp,
    currentMp: c.stats.mp,
    atk: c.stats.atk,
    def: c.stats.def,
    agi: c.stats.agi,
    wis: c.stats.wis,
    rankIndex,
    skills: c.skills.map((s) => ({ ...s })),
    alive: true,
    // First FIELD_SIZE creatures start on the field; the rest are bench.
    active: index < FIELD_SIZE,
    statuses: [],
  };
}

/**
 * Speed order over EVERY combatant (field + bench) so a bench member can be
 * pulled in later without rebuilding the order. Sorted by agi desc, id asc.
 * Only `active && alive` combatants actually take a turn (others are skipped).
 */
function buildTurnOrder(all: readonly Combatant[]): string[] {
  return all
    .slice()
    .sort((a, b) => b.agi - a.agi || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => c.id);
}

/**
 * Create a fresh battle. Combatants get live hp/mp from their stats, an alive
 * flag, and a stable id; the field is speed-ordered by agi. The pointer starts
 * on the fastest player so `step` always resolves a player action first
 * (faster enemies simply act later in the round — a friendly, consistent
 * opening rather than a lost pre-emptive strike).
 */
export function createBattle(
  playerTeam: readonly Creature[],
  enemyTeam: readonly Creature[],
  seed: number,
): BattleState {
  const players = playerTeam.map((c, i) => combatantFromCreature(c, 'player', i));
  const enemies = enemyTeam.map((c, i) => combatantFromCreature(c, 'enemy', i));
  const turnOrder = buildTurnOrder([...players, ...enemies]);

  const state: BattleState = {
    seed: seed >>> 0,
    turnCount: 0,
    round: 0,
    playerTeam: players,
    enemyTeam: enemies,
    turnOrder,
    activeIndex: 0,
    phase: 'choosing',
  };

  // Position on the fastest player that can actually act.
  const firstPlayer = turnOrder.findIndex((id) => {
    const c = findCombatant(state, id);
    return !!c && c.side === 'player' && c.active && c.alive;
  });
  state.activeIndex = firstPlayer >= 0 ? firstPlayer : 0;
  if (firstPlayer < 0) state.phase = 'lost';
  return state;
}

// ── lookups & clone ──────────────────────────────────────────────────────────

/** Find a combatant by id across both teams (undefined if unknown). */
export function findCombatant(state: BattleState, id: string): Combatant | undefined {
  return (
    state.playerTeam.find((c) => c.id === id) ?? state.enemyTeam.find((c) => c.id === id)
  );
}

function teamFor(state: BattleState, side: Side): Combatant[] {
  return side === 'player' ? state.playerTeam : state.enemyTeam;
}

function livingFieldTargets(state: BattleState, side: Side): Combatant[] {
  return teamFor(state, side).filter((c) => c.alive && c.active);
}

function anyAlive(team: readonly Combatant[]): boolean {
  return team.some((c) => c.alive);
}

function cloneCombatant(c: Combatant): Combatant {
  return {
    ...c,
    token: { ...c.token, parents: c.token.parents ? [...c.token.parents] : null },
    elements: [...c.elements],
    skills: c.skills.map((s) => ({ ...s })),
    statuses: c.statuses.map((s) => ({ ...s })),
  };
}

function cloneState(s: BattleState): BattleState {
  return {
    ...s,
    playerTeam: s.playerTeam.map(cloneCombatant),
    enemyTeam: s.enemyTeam.map(cloneCombatant),
    turnOrder: [...s.turnOrder],
  };
}

// ── status math ──────────────────────────────────────────────────────────────

function statMod(c: Combatant, up: Status['kind'], down: Status['kind']): number {
  let m = 0;
  for (const s of c.statuses) {
    if (s.kind === up) m += s.magnitude;
    else if (s.kind === down) m -= s.magnitude;
  }
  return m;
}

function effectiveAtk(c: Combatant): number {
  return c.atk * (1 + statMod(c, 'atk-up', 'atk-down'));
}

function effectiveDef(c: Combatant): number {
  return c.def * (1 + statMod(c, 'def-up', 'def-down'));
}

function isDefending(c: Combatant): boolean {
  return c.statuses.some((s) => s.kind === 'defending');
}

/** Tick the actor's OWN statuses at the start of its turn; drop expired ones. */
function tickStatuses(c: Combatant): void {
  c.statuses = c.statuses
    .map((s) => ({ ...s, turns: s.turns - 1 }))
    .filter((s) => s.turns > 0);
}

// ── field management (faint / bench pull-in) ─────────────────────────────────

/**
 * Keep a side's field full: while it has fewer than FIELD_SIZE living fighters
 * on the field and a living bench member exists, pull in the fastest reserve.
 * Deterministic (agi desc, id asc) — no rng. Emits a `swap` per pull-in.
 */
function autoFill(state: BattleState, side: Side, outId: string | null, events: BattleEvent[]): void {
  const team = teamFor(state, side);
  while (livingFieldTargets(state, side).length < FIELD_SIZE) {
    const bench = team
      .filter((c) => c.alive && !c.active)
      .sort((a, b) => b.agi - a.agi || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const next = bench[0];
    if (!next) break;
    next.active = true;
    events.push({ type: 'swap', outId, inId: next.id });
    outId = null; // subsequent pulls aren't tied to the fainted slot
  }
}

// ── damage / heal / effects ──────────────────────────────────────────────────

function applyDamage(
  state: BattleState,
  attacker: Combatant,
  target: Combatant,
  element: Element,
  power: number,
  rng: Rng,
  events: BattleEvent[],
): void {
  const eff = effectiveness(element, target.elements);
  const mult = EFFECTIVENESS_MULTIPLIER[eff];
  const stab = attacker.elements.includes(element) ? STAB_MULT : 1;

  let base = power + effectiveAtk(attacker) * ATK_WEIGHT - effectiveDef(target) * DEF_WEIGHT;
  if (base < 1) base = 1;
  const varf = 1 - VARIANCE + rng.next() * (2 * VARIANCE);
  let raw = base * mult * stab * varf;
  if (isDefending(target)) raw *= DEFEND_MULT;

  const dmg = Math.max(1, Math.floor(raw));
  target.currentHp = Math.max(0, target.currentHp - dmg);
  events.push({
    type: 'damage',
    sourceId: attacker.id,
    targetId: target.id,
    amount: dmg,
    element,
    effectiveness: eff,
  });

  if (target.currentHp === 0 && target.alive) {
    target.alive = false;
    events.push({ type: 'faint', targetId: target.id });
    autoFill(state, target.side, target.id, events);
  }
}

function applyHeal(source: Combatant, target: Combatant, amount: number, events: BattleEvent[]): void {
  const healed = Math.max(0, Math.min(amount, target.maxHp - target.currentHp));
  target.currentHp += healed;
  events.push({ type: 'heal', sourceId: source.id, targetId: target.id, amount: healed });
}

/** Fraction of maxHp a bare `revive: true` (no explicit `heal`) restores. */
const REVIVE_HP_FRACTION = 0.5;

// ── action resolution (shared by player + enemy AI) ──────────────────────────

function actionKind(action: BattleAction): ActionKind {
  return action.type;
}

/**
 * Resolve ONE actor's action, mutating `state` and appending events. Shared by
 * the player and the enemy AI, so both drive the exact same combat math.
 */
function resolveAction(
  state: BattleState,
  actor: Combatant,
  action: BattleAction,
  rng: Rng,
  events: BattleEvent[],
): void {
  events.push({ type: 'action', actorId: actor.id, kind: actionKind(action) });

  switch (action.type) {
    case 'attack': {
      const target = findCombatant(state, action.targetId);
      if (!target || !target.alive || target.side === actor.side) {
        events.push({ type: 'miss', actorId: actor.id, targetId: action.targetId });
        return;
      }
      const element = actor.elements[0] ?? 'fire';
      applyDamage(state, actor, target, element, BASIC_ATTACK_POWER, rng, events);
      return;
    }

    case 'skill': {
      const skill = actor.skills.find((s) => s.id === action.skillId);
      if (!skill) {
        events.push({ type: 'miss', actorId: actor.id });
        return;
      }
      // MP gate: an unaffordable skill fizzles — no cost, no effect, a miss.
      if (actor.currentMp < skill.mpCost) {
        events.push({ type: 'miss', actorId: actor.id, targetId: action.targetId });
        return;
      }
      actor.currentMp -= skill.mpCost;
      resolveSkill(state, actor, skill, action.targetId, rng, events);
      return;
    }

    case 'defend': {
      actor.statuses.push({ kind: 'defending', magnitude: 0, turns: 1 });
      events.push({ type: 'defend', actorId: actor.id });
      return;
    }

    case 'scout': {
      resolveScout(state, actor, action.targetId, rng, events);
      return;
    }

    case 'swap': {
      resolveSwap(state, actor, action.benchId, events);
      return;
    }

    case 'flee': {
      resolveFlee(state, actor, rng, events);
      return;
    }

    case 'item': {
      resolveItem(state, actor, action.targetId, action.effect, events);
      return;
    }
  }
}

function resolveSkill(
  state: BattleState,
  actor: Combatant,
  skill: Skill,
  targetId: string | undefined,
  rng: Rng,
  events: BattleEvent[],
): void {
  const enemySide: Side = actor.side === 'player' ? 'enemy' : 'player';

  switch (skill.kind) {
    case 'attack': {
      const targets =
        skill.target === 'all'
          ? livingFieldTargets(state, enemySide)
          : pickSingle(state, enemySide, targetId);
      if (targets.length === 0) {
        events.push({ type: 'miss', actorId: actor.id, targetId });
        return;
      }
      for (const t of targets) {
        applyDamage(state, actor, t, skill.element, skill.power, rng, events);
      }
      return;
    }

    case 'heal': {
      const targets =
        skill.target === 'self'
          ? [actor]
          : skill.target === 'all'
            ? livingFieldTargets(state, actor.side)
            : pickHealTarget(state, actor, targetId);
      const amount = Math.floor(skill.power + actor.wis * HEAL_WIS_WEIGHT);
      for (const t of targets) applyHeal(actor, t, amount, events);
      return;
    }

    case 'buff': {
      const target =
        skill.target === 'self'
          ? actor
          : pickSingle(state, actor.side, targetId)[0] ?? actor;
      target.statuses.push({ kind: 'atk-up', magnitude: BUFF_MAGNITUDE, turns: BUFF_TURNS });
      events.push({
        type: 'buff',
        sourceId: actor.id,
        targetId: target.id,
        stat: 'atk',
        magnitude: BUFF_MAGNITUDE,
      });
      return;
    }

    case 'debuff': {
      const target = pickSingle(state, enemySide, targetId)[0];
      if (!target) {
        events.push({ type: 'miss', actorId: actor.id, targetId });
        return;
      }
      target.statuses.push({ kind: 'def-down', magnitude: BUFF_MAGNITUDE, turns: BUFF_TURNS });
      events.push({
        type: 'debuff',
        sourceId: actor.id,
        targetId: target.id,
        stat: 'def',
        magnitude: BUFF_MAGNITUDE,
      });
      return;
    }
  }
}

/** Resolve a single-target selection to a 0- or 1-element list of living targets. */
function pickSingle(state: BattleState, side: Side, targetId: string | undefined): Combatant[] {
  if (targetId) {
    const t = findCombatant(state, targetId);
    if (t && t.alive && t.active && t.side === side) return [t];
  }
  const living = livingFieldTargets(state, side);
  return living.length > 0 && living[0] ? [living[0]] : [];
}

function pickHealTarget(state: BattleState, actor: Combatant, targetId: string | undefined): Combatant[] {
  if (targetId) {
    const t = findCombatant(state, targetId);
    if (t && t.alive && t.side === actor.side) return [t];
  }
  // Default: the most-injured living ally on the field.
  const allies = livingFieldTargets(state, actor.side).slice().sort((a, b) => {
    const fa = a.currentHp / a.maxHp;
    const fb = b.currentHp / b.maxHp;
    return fa - fb || (a.id < b.id ? -1 : 1);
  });
  return allies[0] ? [allies[0]] : [actor];
}

function resolveScout(
  state: BattleState,
  actor: Combatant,
  targetId: string,
  rng: Rng,
  events: BattleEvent[],
): void {
  const target = findCombatant(state, targetId);
  if (!target || !target.alive || target.side === actor.side) {
    events.push({ type: 'scout', actorId: actor.id, targetId, success: false, chance: 0 });
    return;
  }
  const hpFrac = target.currentHp / target.maxHp;
  const rankGap = actor.rankIndex - target.rankIndex;
  const chance = clamp(
    SCOUT_BASE + (1 - hpFrac) * SCOUT_HP_WEIGHT + rankGap * SCOUT_RANK_WEIGHT,
    SCOUT_MIN,
    SCOUT_MAX,
  );
  const success = rng.next() < chance;
  events.push({ type: 'scout', actorId: actor.id, targetId, success, chance });
}

function resolveSwap(
  state: BattleState,
  actor: Combatant,
  benchId: string,
  events: BattleEvent[],
): void {
  const bench = findCombatant(state, benchId);
  if (!bench || !bench.alive || bench.active || bench.side !== actor.side) {
    events.push({ type: 'miss', actorId: actor.id, targetId: benchId });
    return;
  }
  actor.active = false;
  bench.active = true;
  events.push({ type: 'swap', outId: actor.id, inId: bench.id });
}

function resolveFlee(state: BattleState, actor: Combatant, rng: Rng, events: BattleEvent[]): void {
  const enemySide: Side = actor.side === 'player' ? 'enemy' : 'player';
  const foes = livingFieldTargets(state, enemySide);
  const foeAgi = foes.length > 0 ? foes.reduce((s, c) => s + c.agi, 0) / foes.length : 1;
  const ratio = actor.agi / Math.max(1, foeAgi);
  const chance = clamp(FLEE_BASE + (ratio - 1) * FLEE_AGI_WEIGHT, FLEE_MIN, FLEE_MAX);
  const success = rng.next() < chance;
  events.push({ type: 'flee', actorId: actor.id, success, chance });
  // A successful flee ENDS the battle without a victory/defeat. We reuse `lost`
  // for the phase (the run is over) but emit NO `defeat` event — the assembly
  // reads the `flee` event to tell a flight apart from a wipe.
  if (success) state.phase = 'lost';
}

/**
 * Apply a plain `BattleItemEffect` to a target combatant. The action still
 * CONSUMES the actor's turn even on a guarded/no-op use (same pattern as an
 * unaffordable skill fizzling to a `miss` — invalid uses don't crash and don't
 * get a free re-try, they just spend the turn with minimal/no effect).
 *
 * Rules:
 *  - `heal` restores hp, clamped to maxHp. Ignored on a fainted target UNLESS
 *    `revive` is also set (a plain heal cannot raise the dead — that's what
 *    `revive` is for).
 *  - `mp` restores mp, clamped to maxMp. Applies regardless of alive/fainted
 *    (a fainted target still "holds" unspent mp in this model) but is a no-op
 *    if the target is missing.
 *  - `revive` un-faints a FAINTED target only (reviving a living target is a
 *    guarded no-op — no double-heal side channel). On revive, currentHp is set
 *    to `max(1, heal ?? round(maxHp * REVIVE_HP_FRACTION))` — an explicit
 *    `heal` amount doubles as the post-revive hp when given, else half maxHp.
 *
 * Always emits the `item` event (so juice/audio can react to "an item was
 * used" even when the mechanical effect was a no-op), plus a `heal` event for
 * whatever hp/mp actually moved, reusing the existing heal event shape.
 */
function resolveItem(
  state: BattleState,
  actor: Combatant,
  targetId: string,
  effect: BattleItemEffect,
  events: BattleEvent[],
): void {
  const target = findCombatant(state, targetId);
  events.push({ type: 'item', actorId: actor.id, targetId, effect });
  if (!target) return;

  if (effect.revive) {
    if (target.alive) return; // guarded: reviving a living target is a no-op
    const hp = Math.max(1, effect.heal ?? Math.round(target.maxHp * REVIVE_HP_FRACTION));
    target.alive = true;
    target.currentHp = Math.min(target.maxHp, hp);
    // `active` was never cleared on faint (a fainted combatant keeps its field
    // slot, just excluded from `livingFieldTargets`), so revive needs no field
    // bookkeeping — it simply becomes eligible to act/target again in place.
    events.push({ type: 'heal', sourceId: actor.id, targetId: target.id, amount: target.currentHp });
  } else if (typeof effect.heal === 'number' && target.alive) {
    applyHeal(actor, target, effect.heal, events);
  }
  // else: healing a fainted target without `revive` is guarded — no effect.

  if (typeof effect.mp === 'number') {
    const restored = Math.max(0, Math.min(effect.mp, target.maxMp - target.currentMp));
    target.currentMp += restored;
  }
}

// ── enemy AI ─────────────────────────────────────────────────────────────────

/**
 * Decide an enemy actor's action. Deterministic from the per-turn rng: mostly
 * attacks/skills, heals when low with an injured ally, and prefers
 * super-effective / low-hp targets.
 */
function enemyAction(state: BattleState, actor: Combatant, rng: Rng): BattleAction {
  const targets = livingFieldTargets(state, 'player');
  if (targets.length === 0) return { type: 'defend' };

  const allies = livingFieldTargets(state, 'enemy');
  const injuredAlly = allies
    .filter((a) => a.currentHp < a.maxHp * AI_ALLY_INJURED_THRESHOLD)
    .sort((a, b) => a.currentHp / a.maxHp - b.currentHp / b.maxHp || (a.id < b.id ? -1 : 1))[0];
  const healSkill = actor.skills.find((s) => s.kind === 'heal' && s.mpCost <= actor.currentMp);
  if (healSkill && injuredAlly && actor.currentHp < actor.maxHp * AI_HEAL_HP_THRESHOLD) {
    return { type: 'skill', skillId: healSkill.id, targetId: injuredAlly.id };
  }

  const offSkills = actor.skills.filter((s) => s.kind === 'attack' && s.mpCost <= actor.currentMp);
  if (offSkills.length > 0 && rng.next() < AI_SKILL_CHANCE) {
    const skill = rng.pick(offSkills);
    const target = bestTarget(targets, skill.element);
    return { type: 'skill', skillId: skill.id, targetId: target.id };
  }

  const target = bestTarget(targets, actor.elements[0] ?? 'fire');
  return { type: 'attack', targetId: target.id };
}

/** Prefer super-effective, then lowest current hp, then id — fully deterministic. */
function bestTarget(candidates: readonly Combatant[], element: Element): Combatant {
  const rank = (c: Combatant): number => {
    const eff = effectiveness(element, c.elements);
    return eff === 'weak' ? 2 : eff === 'normal' ? 1 : 0;
  };
  return candidates
    .slice()
    .sort(
      (a, b) => rank(b) - rank(a) || a.currentHp - b.currentHp || (a.id < b.id ? -1 : 1),
    )[0] as Combatant;
}

// ── turn loop ────────────────────────────────────────────────────────────────

/** Fork a fresh, deterministic rng for a given turn from seed + cursor. */
function turnRng(state: BattleState): Rng {
  return createRng(state.seed).fork(state.turnCount);
}

/** Begin an actor's turn: advance the cursor, tick its statuses, announce it. */
function beginTurn(state: BattleState, actor: Combatant, events: BattleEvent[]): Rng {
  state.turnCount += 1;
  tickStatuses(actor);
  events.push({ type: 'turn-start', actorId: actor.id, round: state.round, turn: state.turnCount });
  return turnRng(state);
}

/** Move the pointer to the next slot, bumping the round on wrap. */
function advance(state: BattleState): void {
  const n = state.turnOrder.length;
  if (n === 0) return;
  const ni = (state.activeIndex + 1) % n;
  if (ni <= state.activeIndex) state.round += 1;
  state.activeIndex = ni;
}

/**
 * Detect a finished battle. Sets phase + emits `victory`/`defeat` (and, on
 * victory, xp/level-up) exactly once. Returns true when the battle is over.
 */
function checkEnd(state: BattleState, events: BattleEvent[]): boolean {
  if (state.phase !== 'choosing') return true;
  const playersAlive = anyAlive(state.playerTeam);
  const enemiesAlive = anyAlive(state.enemyTeam);
  if (!enemiesAlive) {
    state.phase = 'won';
    onVictory(state, events);
    return true;
  }
  if (!playersAlive) {
    state.phase = 'lost';
    events.push({ type: 'defeat' });
    return true;
  }
  return false;
}

function onVictory(state: BattleState, events: BattleEvent[]): void {
  events.push({ type: 'victory' });
  const survivors = state.playerTeam.filter((c) => c.alive);
  if (survivors.length === 0) return;
  const pool = XP_PER_ENEMY * state.enemyTeam.length;
  const each = Math.floor(pool / survivors.length);
  for (const s of survivors) {
    events.push({ type: 'xp', actorId: s.id, amount: each });
    if (each >= LEVEL_XP) {
      events.push({ type: 'level-up', actorId: s.id, level: Math.floor(each / LEVEL_XP) + 1 });
    }
  }
}

/**
 * Run auto (enemy) turns until a living player is up, the battle ends, or the
 * safety cap trips. Skips fainted/bench slots. Player slots stop the loop.
 */
function runUntilPlayerTurn(state: BattleState, events: BattleEvent[]): void {
  for (let guard = 0; guard <= state.turnOrder.length * MAX_TURNS; guard++) {
    if (checkEnd(state, events)) return;
    if (state.turnCount > MAX_TURNS) {
      forceResolve(state, events);
      return;
    }
    const id = state.turnOrder[state.activeIndex];
    const actor = id ? findCombatant(state, id) : undefined;
    if (!actor || !actor.alive || !actor.active) {
      advance(state);
      continue;
    }
    if (actor.side === 'player') {
      state.phase = 'choosing';
      return;
    }
    const rng = beginTurn(state, actor, events);
    const action = enemyAction(state, actor, rng);
    resolveAction(state, actor, action, rng, events);
    advance(state);
  }
  // Guard exhausted (shouldn't happen): decide on remaining hp.
  forceResolve(state, events);
}

/** Break a runaway battle by remaining hp fraction. */
function forceResolve(state: BattleState, events: BattleEvent[]): void {
  if (state.phase !== 'choosing') return;
  const frac = (team: readonly Combatant[]): number => {
    const max = team.reduce((s, c) => s + c.maxHp, 0) || 1;
    const cur = team.reduce((s, c) => s + c.currentHp, 0);
    return cur / max;
  };
  if (frac(state.playerTeam) >= frac(state.enemyTeam)) {
    state.phase = 'won';
    onVictory(state, events);
  } else {
    state.phase = 'lost';
    events.push({ type: 'defeat' });
  }
}

// ── the reducer ──────────────────────────────────────────────────────────────

/**
 * Resolve the player's action for the current actor, then auto-run enemy turns
 * until it's the player's turn again (or the battle ends). PURE: returns a NEW
 * state and the FULL ordered event stream for everything that happened; the
 * input `state` is never mutated.
 */
export function step(
  state: BattleState,
  action: BattleAction,
): { state: BattleState; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  if (state.phase !== 'choosing') return { state, events };

  const next = cloneState(state);
  const id = next.turnOrder[next.activeIndex];
  const actor = id ? findCombatant(next, id) : undefined;

  if (!actor || actor.side !== 'player' || !actor.alive || !actor.active) {
    // Invariant slipped — recover by running the loop to the next player.
    runUntilPlayerTurn(next, events);
    return { state: next, events };
  }

  const rng = beginTurn(next, actor, events);
  resolveAction(next, actor, action, rng, events);

  if (!checkEnd(next, events)) {
    advance(next);
    runUntilPlayerTurn(next, events);
  }

  return { state: next, events };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
