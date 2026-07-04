/**
 * economy — currency, items, and shops, as a pure serializable reducer state.
 *
 * PURE, THREE-FREE, DOM-FREE. Every function returns a NEW EconomyState and
 * never mutates its input (structural sharing is fine). No three, no DOM, no
 * Math.random, no Date.now: the same inputs always yield a deep-equal state,
 * and the whole state JSON round-trips.
 *
 * Economy does NOT know about creatures or battles. `useItem` yields an
 * `ItemEffect` descriptor — data only — for the consumer (battle/roster code)
 * to apply. This keeps the module a pure leaf with no upstream dependencies.
 *
 * Invariants held by every returned state:
 *   - gold is always >= 0 (an integer)
 *   - item counts are always >= 0 (an integer); a count of 0 may be dropped
 *     from the map but is never negative
 */

import type { Family } from '../creature/index.js';

/** The kinds of item an ItemDef may be. */
export type ItemKind = 'heal' | 'mp' | 'revive' | 'bait' | 'stat-seed' | 'catalyst';

/** The stat a stat-seed permanently raises. */
export type StatKey = 'atk' | 'def' | 'mag' | 'spd' | 'hp' | 'mp';

/**
 * A data descriptor for what an item does. Economy never interprets this — it
 * only carries it back to the caller from `useItem`. Every field is optional
 * except the ones relevant to the item's own `kind`, so the shape stays a
 * plain, legible, JSON-clean union-by-convention rather than a real union
 * (keeps `ITEMS` a flat, easy-to-scan table).
 */
export interface ItemEffect {
  kind: ItemKind;
  /** heal: HP restored. */
  amount?: number;
  /** revive: fraction of max HP restored on un-faint (e.g. 0.5). */
  reviveFraction?: number;
  /** bait: scout-chance bonus (additive, e.g. 0.15 for +15%). */
  scoutBonus?: number;
  /** bait: restricts the bonus to one family; absent = any family. */
  family?: Family;
  /** stat-seed: the stat to permanently raise. */
  stat?: StatKey;
  /** stat-seed: how much to raise it by (always +1 by convention, but data-driven). */
  statAmount?: number;
  /** catalyst: biases synthesis toward this family; absent = no family bias. */
  biasFamily?: Family;
  /** catalyst: biases synthesis toward this rank; absent = no rank bias. */
  biasRank?: number;
  /** catalyst: strength of the bias, 0..1. */
  biasStrength?: number;
}

/** One item definition in the catalog. */
export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  desc: string;
  /** Buy price in gold. */
  price: number;
  effect: ItemEffect;
}

/** Fraction of `price` refunded on `sell` (rounded down). */
export const SELL_FRACTION = 0.5;

// ── item catalog ──────────────────────────────────────────────────────────────

/**
 * The item catalog, keyed by id. Data-driven and legible: every row is a
 * complete `ItemDef`. Add new items here — no other file needs to change.
 */
export const ITEMS: Record<string, ItemDef> = {
  'healing-herb': {
    id: 'healing-herb',
    name: 'Healing Herb',
    kind: 'heal',
    desc: 'Restores 30 HP to one creature.',
    price: 20,
    effect: { kind: 'heal', amount: 30 },
  },
  'mp-tonic': {
    id: 'mp-tonic',
    name: 'MP Tonic',
    kind: 'mp',
    desc: 'Restores 20 MP to one creature.',
    price: 25,
    effect: { kind: 'mp', amount: 20 },
  },
  revive: {
    id: 'revive',
    name: 'Revive',
    kind: 'revive',
    desc: 'Un-faints a creature at 50% of its max HP.',
    price: 50,
    effect: { kind: 'revive', reviveFraction: 0.5 },
  },
  'scout-bait': {
    id: 'scout-bait',
    name: 'Scout Bait',
    kind: 'bait',
    desc: 'Raises scout chance for any wild creature.',
    price: 15,
    effect: { kind: 'bait', scoutBonus: 0.15 },
  },
  'dragon-meat': {
    id: 'dragon-meat',
    name: 'Dragon Meat',
    kind: 'bait',
    desc: 'Strongly raises scout chance for dragon-family creatures.',
    price: 40,
    effect: { kind: 'bait', scoutBonus: 0.35, family: 'dragon' },
  },
  'beast-meat': {
    id: 'beast-meat',
    name: 'Beast Meat',
    kind: 'bait',
    desc: 'Strongly raises scout chance for beast-family creatures.',
    price: 30,
    effect: { kind: 'bait', scoutBonus: 0.35, family: 'beast' },
  },
  'power-seed': {
    id: 'power-seed',
    name: 'Power Seed',
    kind: 'stat-seed',
    desc: 'Permanently raises a creature’s ATK by 1.',
    price: 100,
    effect: { kind: 'stat-seed', stat: 'atk', statAmount: 1 },
  },
  'guard-seed': {
    id: 'guard-seed',
    name: 'Guard Seed',
    kind: 'stat-seed',
    desc: 'Permanently raises a creature’s DEF by 1.',
    price: 100,
    effect: { kind: 'stat-seed', stat: 'def', statAmount: 1 },
  },
  'mind-seed': {
    id: 'mind-seed',
    name: 'Mind Seed',
    kind: 'stat-seed',
    desc: 'Permanently raises a creature’s MAG by 1.',
    price: 100,
    effect: { kind: 'stat-seed', stat: 'mag', statAmount: 1 },
  },
  'swift-seed': {
    id: 'swift-seed',
    name: 'Swift Seed',
    kind: 'stat-seed',
    desc: 'Permanently raises a creature’s SPD by 1.',
    price: 100,
    effect: { kind: 'stat-seed', stat: 'spd', statAmount: 1 },
  },
  'dragon-catalyst': {
    id: 'dragon-catalyst',
    name: 'Dragon Catalyst',
    kind: 'catalyst',
    desc: 'Biases synthesis toward the dragon family.',
    price: 150,
    effect: { kind: 'catalyst', biasFamily: 'dragon', biasStrength: 0.5 },
  },
  'rank-catalyst': {
    id: 'rank-catalyst',
    name: 'Rank Catalyst',
    kind: 'catalyst',
    desc: 'Biases synthesis toward a higher rank.',
    price: 200,
    effect: { kind: 'catalyst', biasRank: 1, biasStrength: 0.5 },
  },
};

/** Look up an item def by id, or undefined if unknown. */
export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** All item ids in the catalog, in declaration order. */
export function allItemIds(): string[] {
  return Object.keys(ITEMS);
}

/** All item defs of a given kind, in declaration order. */
export function itemsOfKind(kind: ItemKind): ItemDef[] {
  return Object.values(ITEMS).filter((d) => d.kind === kind);
}

// ── shop stock ────────────────────────────────────────────────────────────────

/** Legible default shop stock per tier (0 = starting Sanctuary shop). Keep tiny. */
const SHOP_TIERS: readonly string[][] = [
  ['healing-herb', 'mp-tonic', 'scout-bait'],
  ['healing-herb', 'mp-tonic', 'revive', 'scout-bait', 'beast-meat', 'dragon-meat'],
  [
    'healing-herb',
    'mp-tonic',
    'revive',
    'scout-bait',
    'beast-meat',
    'dragon-meat',
    'power-seed',
    'guard-seed',
    'mind-seed',
    'swift-seed',
    'dragon-catalyst',
    'rank-catalyst',
  ],
];

/**
 * The item ids available for purchase at a given zone/tier. `tier` clamps to
 * the last defined tier, so an out-of-range tier just yields the fullest shop
 * rather than throwing.
 */
export function shopFor(tier: number): string[] {
  const clamped = Math.max(0, Math.min(SHOP_TIERS.length - 1, Math.floor(tier)));
  return [...SHOP_TIERS[clamped]!];
}

// ── wallet / inventory state ──────────────────────────────────────────────────

/** The whole economy: gold and item counts. Serializable. */
export interface EconomyState {
  gold: number;
  /** itemId -> count. A missing key means 0; counts are never negative. */
  items: Record<string, number>;
}

/** Options for `createEconomy`. */
export interface CreateEconomyOptions {
  gold?: number;
  items?: Record<string, number>;
}

/** The result of an operation that can fail (insufficient gold or items). */
export interface EconomyResult {
  state: EconomyState;
  ok: boolean;
}

/** The result of `useItem` — carries the consumed item's effect descriptor. */
export interface UseItemResult extends EconomyResult {
  effect?: ItemEffect;
}

/** Create a fresh economy. Starting gold defaults to 0; starting items default to none. */
export function createEconomy(opts?: CreateEconomyOptions): EconomyState {
  return {
    gold: Math.max(0, Math.floor(opts?.gold ?? 0)),
    items: { ...(opts?.items ?? {}) },
  };
}

// ── internal helpers (pure) ───────────────────────────────────────────────────

function itemCount(state: EconomyState, id: string): number {
  return state.items[id] ?? 0;
}

/** Set an item's count, dropping the key entirely at 0 (keeps state JSON-clean). */
function withItemCount(state: EconomyState, id: string, count: number): EconomyState {
  if (count <= 0) {
    if (!(id in state.items)) return state;
    const items = { ...state.items };
    delete items[id];
    return { ...state, items };
  }
  return { ...state, items: { ...state.items, [id]: count } };
}

// ── pure reducers ─────────────────────────────────────────────────────────────

/** Add gold (n must be >= 0; fractional values are floored). */
export function addGold(state: EconomyState, n: number): EconomyState {
  const amount = Math.max(0, Math.floor(n));
  if (amount === 0) return state;
  return { ...state, gold: state.gold + amount };
}

/**
 * Spend gold. Fails (ok=false, state unchanged) if `n` exceeds the current
 * balance; otherwise deducts it.
 */
export function spendGold(state: EconomyState, n: number): EconomyResult {
  const amount = Math.max(0, Math.floor(n));
  if (amount > state.gold) return { state, ok: false };
  return { state: { ...state, gold: state.gold - amount }, ok: true };
}

/** Add `n` (default 1) of an item by id. */
export function addItem(state: EconomyState, id: string, n = 1): EconomyState {
  const amount = Math.max(0, Math.floor(n));
  if (amount === 0) return state;
  return withItemCount(state, id, itemCount(state, id) + amount);
}

/**
 * Consume one of an item and return its effect descriptor for the caller to
 * apply. Fails (ok=false, state unchanged, no effect) if the item is unknown
 * or the count is 0.
 */
export function useItem(state: EconomyState, id: string): UseItemResult {
  const def = ITEMS[id];
  if (!def) return { state, ok: false };
  const count = itemCount(state, id);
  if (count <= 0) return { state, ok: false };
  return { state: withItemCount(state, id, count - 1), ok: true, effect: def.effect };
}

/**
 * Buy `qty` (default 1) of an item: spends `price * qty` gold and adds `qty`
 * of the item. Fails (ok=false, state unchanged) if the item is unknown or
 * gold is insufficient.
 */
export function buy(state: EconomyState, id: string, qty = 1): EconomyResult {
  const def = ITEMS[id];
  const amount = Math.max(0, Math.floor(qty));
  if (!def || amount === 0) return { state, ok: false };

  const cost = def.price * amount;
  const spent = spendGold(state, cost);
  if (!spent.ok) return { state, ok: false };

  return { state: addItem(spent.state, id, amount), ok: true };
}

/**
 * Sell `qty` (default 1) of an item: removes `qty` of the item and adds
 * `floor(price * qty * SELL_FRACTION)` gold. Fails (ok=false, state
 * unchanged) if the item is unknown or the held count is insufficient.
 */
export function sell(state: EconomyState, id: string, qty = 1): EconomyResult {
  const def = ITEMS[id];
  const amount = Math.max(0, Math.floor(qty));
  if (!def || amount === 0) return { state, ok: false };

  const held = itemCount(state, id);
  if (held < amount) return { state, ok: false };

  const refund = Math.floor(def.price * amount * SELL_FRACTION);
  const removed = withItemCount(state, id, held - amount);
  return { state: addGold(removed, refund), ok: true };
}
