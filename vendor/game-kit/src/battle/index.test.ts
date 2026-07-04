import { describe, it, expect } from 'vitest';
import { seedToken, creatureFromToken } from '../creature/index.js';
import type { Creature } from '../creature/types.js';
import {
  createBattle,
  step,
  findCombatant,
  effectiveness,
  ELEMENT_CHART,
  EFFECTIVENESS_MULTIPLIER,
  type BattleState,
  type BattleAction,
  type BattleEvent,
  type BattleItemEffect,
} from './index.js';

// ── team builders ────────────────────────────────────────────────────────────

function team(prefix: string, n: number): Creature[] {
  return Array.from({ length: n }, (_, i) => creatureFromToken(seedToken(`${prefix}-${i}`)));
}

/** First living, on-field enemy id (the policy's default target). */
function firstLivingEnemy(state: BattleState): string | undefined {
  return state.enemyTeam.find((c) => c.alive && c.active)?.id;
}

/**
 * Drive a battle to its end with a fixed policy (current player always basic
 * -attacks the first living enemy). Returns the final state + the FULL stream.
 */
function playToEnd(seed: number): { state: BattleState; events: BattleEvent[] } {
  let state = createBattle(team('P', 3), team('E', 3), seed);
  const events: BattleEvent[] = [];
  let guard = 0;
  while (state.phase === 'choosing' && guard++ < 500) {
    const targetId = firstLivingEnemy(state);
    const action: BattleAction = targetId
      ? { type: 'attack', targetId }
      : { type: 'defend' };
    const r = step(state, action);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

// ── determinism ──────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('same seed + same actions → identical events AND identical state', () => {
    const a = playToEnd(1234);
    const b = playToEnd(1234);
    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(b.state);
  });

  it('different seeds diverge', () => {
    const a = playToEnd(1);
    const b = playToEnd(2);
    expect(a.events).not.toEqual(b.events);
  });

  it('state is serializable (survives a JSON round-trip)', () => {
    const { state } = playToEnd(77);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('step never mutates the input state', () => {
    const state = createBattle(team('P', 3), team('E', 3), 42);
    const frozen = JSON.parse(JSON.stringify(state));
    const targetId = firstLivingEnemy(state)!;
    step(state, { type: 'attack', targetId });
    expect(state).toEqual(frozen);
  });
});

// ── speed ordering ───────────────────────────────────────────────────────────

describe('speed ordering by agi', () => {
  it('turnOrder is sorted by agi descending', () => {
    const state = createBattle(team('P', 3), team('E', 3), 9);
    const agis = state.turnOrder.map((id) => findCombatant(state, id)!.agi);
    const sorted = [...agis].sort((x, y) => y - x);
    expect(agis).toEqual(sorted);
  });

  it('the pointer starts on a living player', () => {
    const state = createBattle(team('P', 3), team('E', 3), 9);
    const actor = findCombatant(state, state.turnOrder[state.activeIndex]!)!;
    expect(actor.side).toBe('player');
    expect(actor.alive).toBe(true);
  });
});

// ── element effectiveness ────────────────────────────────────────────────────

describe('element chart + effectiveness', () => {
  it('classifies weak / normal / resist across the ring', () => {
    expect(effectiveness('fire', ['wind'])).toBe('weak'); // fire beats wind
    expect(effectiveness('fire', ['fire'])).toBe('normal');
    expect(effectiveness('fire', ['water'])).toBe('resist'); // water beats fire
  });

  it('light and dark are mutually super-effective', () => {
    expect(effectiveness('light', ['dark'])).toBe('weak');
    expect(effectiveness('dark', ['light'])).toBe('weak');
    expect(ELEMENT_CHART.light).toContain('dark');
    expect(ELEMENT_CHART.dark).toContain('light');
  });

  it('multipliers order weak > normal > resist', () => {
    expect(EFFECTIVENESS_MULTIPLIER.weak).toBeGreaterThan(EFFECTIVENESS_MULTIPLIER.normal);
    expect(EFFECTIVENESS_MULTIPLIER.normal).toBeGreaterThan(EFFECTIVENESS_MULTIPLIER.resist);
  });

  it('weak hits harder than normal, which hits harder than resist (same seed)', () => {
    // Same seed → identical variance draw; only the defender element differs.
    const dmgFor = (defenderElements: Creature['elements']): number => {
      const state = createBattle(team('P', 1), team('E', 1), 555);
      // Pin the attacker to fire and the lone enemy to the chosen elements so the
      // ONLY variable across runs is effectiveness.
      state.playerTeam[0]!.elements = ['fire'];
      state.enemyTeam[0]!.elements = defenderElements.slice();
      const { events } = step(state, { type: 'attack', targetId: 'E0' });
      const dmg = events.find((e) => e.type === 'damage' && e.sourceId === 'P0');
      if (!dmg || dmg.type !== 'damage') throw new Error('no player damage event');
      return dmg.amount;
    };
    const weak = dmgFor(['wind']); // fire > wind
    const normal = dmgFor(['fire']);
    const resist = dmgFor(['water']); // water > fire
    expect(weak).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(resist);
  });
});

// ── fainting ─────────────────────────────────────────────────────────────────

describe('fainting (tender, never death)', () => {
  it('a full battle ends with hp floored at 0 and fainted = not alive', () => {
    const { state, events } = playToEnd(2024);
    const all = [...state.playerTeam, ...state.enemyTeam];
    for (const c of all) {
      expect(c.currentHp).toBeGreaterThanOrEqual(0);
      expect(c.currentHp).toBeLessThanOrEqual(c.maxHp);
      if (!c.alive) expect(c.currentHp).toBe(0);
    }
    // At least one combatant fainted, and the stream says so with 'faint'.
    expect(events.some((e) => e.type === 'faint')).toBe(true);
    // No "death" ever leaks into the stream.
    expect(events.some((e) => (e as { type: string }).type === 'death')).toBe(false);
  });
});

// ── scout ────────────────────────────────────────────────────────────────────

describe('scout chance rises as hp falls', () => {
  const scoutChanceAtHp = (hpFrac: number): number => {
    const state = createBattle(team('P', 1), team('E', 1), 808);
    const enemy = state.enemyTeam[0]!;
    enemy.currentHp = Math.max(1, Math.round(enemy.maxHp * hpFrac));
    const { events } = step(state, { type: 'scout', targetId: 'E0' });
    const scout = events.find((e) => e.type === 'scout');
    if (!scout || scout.type !== 'scout') throw new Error('no scout event');
    return scout.chance;
  };

  it('a badly hurt target is easier to scout than a healthy one', () => {
    const healthy = scoutChanceAtHp(1);
    const hurt = scoutChanceAtHp(0.1);
    expect(hurt).toBeGreaterThan(healthy);
  });

  it('emits a scout event carrying success + chance', () => {
    const state = createBattle(team('P', 1), team('E', 1), 3);
    const { events } = step(state, { type: 'scout', targetId: 'E0' });
    const scout = events.find((e) => e.type === 'scout');
    expect(scout).toBeDefined();
    if (scout && scout.type === 'scout') {
      expect(typeof scout.success).toBe('boolean');
      expect(scout.chance).toBeGreaterThan(0);
    }
  });
});

// ── MP gating ────────────────────────────────────────────────────────────────

describe('MP gates skills', () => {
  /** Find a battle whose first player actor owns a positive-cost skill. */
  function withCostedSkill(): { state: BattleState; skillId: string; cost: number } {
    for (let seed = 0; seed < 50; seed++) {
      const state = createBattle(team('P', 3), team('E', 3), seed);
      const actor = findCombatant(state, state.turnOrder[state.activeIndex]!)!;
      const skill = actor.skills.find((s) => s.mpCost > 0);
      if (skill) return { state, skillId: skill.id, cost: skill.mpCost };
    }
    throw new Error('no costed skill found in 50 seeds');
  }

  it('an unaffordable skill fizzles to a miss with no MP spent', () => {
    const { state, skillId } = withCostedSkill();
    const actor = findCombatant(state, state.turnOrder[state.activeIndex]!)!;
    actor.currentMp = 0;
    const target = firstLivingEnemy(state)!;
    const { events, state: after } = step(state, { type: 'skill', skillId, targetId: target });
    expect(events.some((e) => e.type === 'miss')).toBe(true);
    expect(findCombatant(after, actor.id)!.currentMp).toBe(0);
  });

  it('an affordable skill spends its MP cost', () => {
    const { state, skillId, cost } = withCostedSkill();
    const actor = findCombatant(state, state.turnOrder[state.activeIndex]!)!;
    actor.currentMp = cost + 5;
    const target = firstLivingEnemy(state)!;
    const { state: after } = step(state, { type: 'skill', skillId, targetId: target });
    expect(findCombatant(after, actor.id)!.currentMp).toBe(5);
  });
});

// ── full battle resolves ─────────────────────────────────────────────────────

describe('a full battle plays to victory or defeat', () => {
  it('reaches a terminal phase and emits the matching event', () => {
    for (const seed of [1, 7, 42, 100, 2024]) {
      const { state, events } = playToEnd(seed);
      expect(['won', 'lost']).toContain(state.phase);
      const terminal = events.some((e) => e.type === 'victory' || e.type === 'defeat');
      expect(terminal).toBe(true);
      if (state.phase === 'won') {
        expect(events.some((e) => e.type === 'victory')).toBe(true);
        expect(events.some((e) => e.type === 'xp')).toBe(true);
      }
    }
  });

  it('stops accepting actions once terminal', () => {
    const { state } = playToEnd(42);
    const r = step(state, { type: 'defend' });
    expect(r.events).toEqual([]);
    expect(r.state).toBe(state);
  });
});

// ── item action ──────────────────────────────────────────────────────────────

describe('item action (economy-decoupled: carries a plain effect, not an item id)', () => {
  function itemAction(targetId: string, effect: BattleItemEffect): BattleAction {
    return { type: 'item', targetId, effect };
  }

  it('heals a hurt ally: HP rises, capped at maxHp', () => {
    const state = createBattle(team('P', 3), team('E', 3), 11);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    ally.currentHp = 1;
    const { state: after, events } = step(state, itemAction(ally.id, { heal: 9999 }));
    const healedAlly = findCombatant(after, ally.id)!;
    expect(healedAlly.currentHp).toBe(healedAlly.maxHp);
    const heal = events.find((e) => e.type === 'heal' && e.targetId === ally.id);
    expect(heal).toBeDefined();
  });

  it('a modest heal amount is not clamped away — HP rises by the given amount', () => {
    const state = createBattle(team('P', 3), team('E', 3), 12);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    ally.currentHp = Math.max(1, ally.maxHp - 10);
    const before = ally.currentHp;
    const { state: after } = step(state, itemAction(ally.id, { heal: 5 }));
    const healedAlly = findCombatant(after, ally.id)!;
    expect(healedAlly.currentHp).toBe(Math.min(ally.maxHp, before + 5));
  });

  it('restores MP, capped at maxMp', () => {
    const state = createBattle(team('P', 3), team('E', 3), 13);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    ally.currentMp = 0;
    const { state: after } = step(state, itemAction(ally.id, { mp: 9999 }));
    const restoredAlly = findCombatant(after, ally.id)!;
    expect(restoredAlly.currentMp).toBe(restoredAlly.maxMp);
  });

  it('MP restore is clamped to a partial amount when not overfull', () => {
    const state = createBattle(team('P', 3), team('E', 3), 14);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    ally.currentMp = 0;
    const cappedAmount = Math.max(1, Math.floor(ally.maxMp / 2));
    const { state: after } = step(state, itemAction(ally.id, { mp: cappedAmount }));
    const restoredAlly = findCombatant(after, ally.id)!;
    expect(restoredAlly.currentMp).toBe(Math.min(ally.maxMp, cappedAmount));
  });

  it('revives a fainted ally: alive becomes true and HP > 0', () => {
    const state = createBattle(team('P', 3), team('E', 3), 15);
    const actorId = state.turnOrder[state.activeIndex]!;
    const fainted = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    fainted.alive = false;
    fainted.currentHp = 0;
    const { state: after, events } = step(state, itemAction(fainted.id, { revive: true }));
    const revived = findCombatant(after, fainted.id)!;
    expect(revived.alive).toBe(true);
    expect(revived.currentHp).toBeGreaterThan(0);
    expect(revived.currentHp).toBe(Math.round(revived.maxHp * 0.5));
    expect(events.some((e) => e.type === 'item' && e.targetId === fainted.id)).toBe(true);
  });

  it('revive honors an explicit heal amount as the post-revive HP', () => {
    const state = createBattle(team('P', 3), team('E', 3), 16);
    const actorId = state.turnOrder[state.activeIndex]!;
    const fainted = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    fainted.alive = false;
    fainted.currentHp = 0;
    const reviveHp = Math.max(1, Math.floor(fainted.maxHp / 4));
    const { state: after } = step(state, itemAction(fainted.id, { revive: true, heal: reviveHp }));
    const revived = findCombatant(after, fainted.id)!;
    expect(revived.alive).toBe(true);
    expect(revived.currentHp).toBe(reviveHp);
  });

  it('using an item consumes the turn: the enemy gets to act (an enemy event follows)', () => {
    // Seed chosen so the field is a straightforward 1v1 — the very next slot
    // after the player's item action MUST belong to the enemy, so a single
    // `step` call is guaranteed to run the enemy's turn too.
    const state = createBattle(team('P', 1), team('E', 1), 30);
    const actorId = state.turnOrder[state.activeIndex]!;
    expect(actorId).toBe('P0');
    const ally = state.playerTeam[0]!;
    ally.currentHp = Math.max(1, ally.maxHp - 5);
    const { events } = step(state, itemAction(ally.id, { heal: 3 }));
    // The player's own turn-start, then (turn consumed → advance) an enemy
    // action following it in the SAME event stream — proof the turn passed.
    const playerTurnIdx = events.findIndex((e) => e.type === 'turn-start' && e.actorId === 'P0');
    expect(playerTurnIdx).toBeGreaterThanOrEqual(0);
    const enemyActedAfter = events
      .slice(playerTurnIdx + 1)
      .some((e) => e.type === 'action' && e.actorId === 'E0');
    const battleEnded = events.some((e) => e.type === 'victory' || e.type === 'defeat');
    expect(enemyActedAfter || battleEnded).toBe(true);
  });

  it('healing is clamped: no overheal past max even from full', () => {
    const state = createBattle(team('P', 3), team('E', 3), 18);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    expect(ally.currentHp).toBe(ally.maxHp); // starts full
    const { state: after, events } = step(state, itemAction(ally.id, { heal: 50 }));
    const healedAlly = findCombatant(after, ally.id)!;
    expect(healedAlly.currentHp).toBe(healedAlly.maxHp);
    const heal = events.find((e) => e.type === 'heal' && e.targetId === ally.id);
    if (heal && heal.type === 'heal') expect(heal.amount).toBe(0);
  });

  it('reviving a living target is a guarded no-op (still consumes the turn)', () => {
    const state = createBattle(team('P', 3), team('E', 3), 19);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    expect(ally.alive).toBe(true);
    const before = ally.currentHp;
    const { state: after, events } = step(state, itemAction(ally.id, { revive: true }));
    const stillAlive = findCombatant(after, ally.id)!;
    expect(stillAlive.alive).toBe(true);
    expect(stillAlive.currentHp).toBe(before);
    // No 'heal' event emitted for the guarded no-op — only the 'item' event.
    expect(events.some((e) => e.type === 'heal' && e.targetId === ally.id)).toBe(false);
    expect(events.some((e) => e.type === 'item' && e.targetId === ally.id)).toBe(true);
    // Turn was still consumed: the actor's own turn-start is present.
    expect(events.some((e) => e.type === 'turn-start' && e.actorId === actorId)).toBe(true);
  });

  it('healing a fainted target without revive is guarded — no HP change', () => {
    const state = createBattle(team('P', 3), team('E', 3), 20);
    const actorId = state.turnOrder[state.activeIndex]!;
    const fainted = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    fainted.alive = false;
    fainted.currentHp = 0;
    const { state: after, events } = step(state, itemAction(fainted.id, { heal: 20 }));
    const stillFainted = findCombatant(after, fainted.id)!;
    expect(stillFainted.alive).toBe(false);
    expect(stillFainted.currentHp).toBe(0);
    expect(events.some((e) => e.type === 'heal' && e.targetId === fainted.id)).toBe(false);
  });

  it('emits a well-formed item event carrying actorId, targetId, and the effect', () => {
    const state = createBattle(team('P', 3), team('E', 3), 21);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    const effect: BattleItemEffect = { heal: 4 };
    const { events } = step(state, itemAction(ally.id, effect));
    const item = events.find((e) => e.type === 'item');
    expect(item).toBeDefined();
    if (item && item.type === 'item') {
      expect(item.actorId).toBe(actorId);
      expect(item.targetId).toBe(ally.id);
      expect(item.effect).toEqual(effect);
    }
  });

  it('a heal-and-mp combo effect applies both in one action', () => {
    const state = createBattle(team('P', 3), team('E', 3), 22);
    const actorId = state.turnOrder[state.activeIndex]!;
    const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
    ally.currentHp = 1;
    ally.currentMp = 0;
    const { state: after } = step(state, itemAction(ally.id, { heal: 5, mp: 3 }));
    const updated = findCombatant(after, ally.id)!;
    expect(updated.currentHp).toBe(Math.min(updated.maxHp, 6));
    expect(updated.currentMp).toBe(Math.min(updated.maxMp, 3));
  });

  it('unknown targetId is guarded — no crash, item event still emitted, turn still consumed', () => {
    const state = createBattle(team('P', 3), team('E', 3), 23);
    const actorId = state.turnOrder[state.activeIndex]!;
    const { events } = step(state, itemAction('nope-not-a-real-id', { heal: 10 }));
    expect(events.some((e) => e.type === 'item')).toBe(true);
    expect(events.some((e) => e.type === 'turn-start' && e.actorId === actorId)).toBe(true);
  });

  it('determinism holds: same seed + same item action → identical events and state', () => {
    const run = () => {
      const state = createBattle(team('P', 3), team('E', 3), 24);
      const actorId = state.turnOrder[state.activeIndex]!;
      const ally = state.playerTeam.find((c) => c.id !== actorId) ?? state.playerTeam[0]!;
      ally.currentHp = 1;
      return step(state, { type: 'item', targetId: ally.id, effect: { heal: 7 } });
    };
    const a = run();
    const b = run();
    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(b.state);
  });
});
