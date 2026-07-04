import { describe, it, expect } from 'vitest';
import {
  createEconomy,
  addGold,
  spendGold,
  addItem,
  useItem,
  buy,
  sell,
  shopFor,
  itemDef,
  allItemIds,
  itemsOfKind,
  ITEMS,
  SELL_FRACTION,
  type EconomyState,
} from './index.js';

describe('createEconomy', () => {
  it('defaults to zero gold and no items', () => {
    const e = createEconomy();
    expect(e.gold).toBe(0);
    expect(e.items).toEqual({});
  });

  it('honours starting gold and items', () => {
    const e = createEconomy({ gold: 100, items: { 'healing-herb': 3 } });
    expect(e.gold).toBe(100);
    expect(e.items).toEqual({ 'healing-herb': 3 });
  });

  it('floors and clamps a negative starting gold to 0', () => {
    const e = createEconomy({ gold: -5 });
    expect(e.gold).toBe(0);
  });
});

describe('addGold / spendGold', () => {
  it('adds gold', () => {
    const e = addGold(createEconomy(), 50);
    expect(e.gold).toBe(50);
  });

  it('floors fractional gold amounts', () => {
    const e = addGold(createEconomy(), 10.9);
    expect(e.gold).toBe(10);
  });

  it('is a no-op for zero or negative amounts', () => {
    const e0 = createEconomy({ gold: 10 });
    expect(addGold(e0, 0)).toBe(e0);
    expect(addGold(e0, -5)).toBe(e0);
  });

  it('spends gold when sufficient', () => {
    const e0 = createEconomy({ gold: 100 });
    const { state, ok } = spendGold(e0, 40);
    expect(ok).toBe(true);
    expect(state.gold).toBe(60);
  });

  it('fails to spend more gold than held, leaving state unchanged', () => {
    const e0 = createEconomy({ gold: 10 });
    const { state, ok } = spendGold(e0, 11);
    expect(ok).toBe(false);
    expect(state).toBe(e0);
    expect(state.gold).toBe(10);
  });

  it('spendGold is pure — does not mutate input', () => {
    const e0 = createEconomy({ gold: 100 });
    const { state } = spendGold(e0, 40);
    expect(e0.gold).toBe(100);
    expect(state).not.toBe(e0);
  });
});

describe('addItem', () => {
  it('adds a new item', () => {
    const e = addItem(createEconomy(), 'healing-herb');
    expect(e.items['healing-herb']).toBe(1);
  });

  it('accumulates counts across calls', () => {
    let e = createEconomy();
    e = addItem(e, 'healing-herb', 2);
    e = addItem(e, 'healing-herb', 3);
    expect(e.items['healing-herb']).toBe(5);
  });

  it('is a no-op for zero amount', () => {
    const e0 = createEconomy();
    expect(addItem(e0, 'healing-herb', 0)).toBe(e0);
  });

  it('is pure — does not mutate input', () => {
    const e0 = createEconomy();
    const e1 = addItem(e0, 'healing-herb');
    expect(e0.items).toEqual({});
    expect(e1).not.toBe(e0);
  });
});

describe('useItem', () => {
  it('decrements count and returns the effect descriptor', () => {
    const e0 = addItem(createEconomy(), 'healing-herb', 2);
    const { state, ok, effect } = useItem(e0, 'healing-herb');
    expect(ok).toBe(true);
    expect(state.items['healing-herb']).toBe(1);
    expect(effect).toEqual({ kind: 'heal', amount: 30 });
  });

  it('drops the key entirely once the count hits 0', () => {
    const e0 = addItem(createEconomy(), 'healing-herb', 1);
    const { state } = useItem(e0, 'healing-herb');
    expect('healing-herb' in state.items).toBe(false);
  });

  it('fails when the item count is 0 (never held)', () => {
    const e0 = createEconomy();
    const { state, ok, effect } = useItem(e0, 'healing-herb');
    expect(ok).toBe(false);
    expect(state).toBe(e0);
    expect(effect).toBeUndefined();
  });

  it('fails when the item count has been used down to empty', () => {
    let e = addItem(createEconomy(), 'revive', 1);
    e = useItem(e, 'revive').state;
    const { ok } = useItem(e, 'revive');
    expect(ok).toBe(false);
  });

  it('fails for an unknown item id', () => {
    const e0 = createEconomy();
    const { ok } = useItem(e0, 'nonexistent-item');
    expect(ok).toBe(false);
  });

  it.each(['heal', 'mp', 'revive', 'bait', 'stat-seed', 'catalyst'] as const)(
    'returns the right effect descriptor for kind=%s',
    (kind) => {
      const id = Object.values(ITEMS).find((d) => d.kind === kind)!.id;
      const e0 = addItem(createEconomy(), id, 1);
      const { effect } = useItem(e0, id);
      expect(effect?.kind).toBe(kind);
      expect(effect).toEqual(ITEMS[id]!.effect);
    },
  );

  it('bait effect carries an optional family tag for family-specific bait', () => {
    const e0 = addItem(createEconomy(), 'dragon-meat', 1);
    const { effect } = useItem(e0, 'dragon-meat');
    expect(effect?.family).toBe('dragon');
    expect(effect?.scoutBonus).toBeGreaterThan(0);
  });

  it('generic scout-bait carries no family restriction', () => {
    const e0 = addItem(createEconomy(), 'scout-bait', 1);
    const { effect } = useItem(e0, 'scout-bait');
    expect(effect?.family).toBeUndefined();
  });

  it('catalyst effect carries the synthesis bias as data', () => {
    const e0 = addItem(createEconomy(), 'dragon-catalyst', 1);
    const { effect } = useItem(e0, 'dragon-catalyst');
    expect(effect?.biasFamily).toBe('dragon');
    expect(effect?.biasStrength).toBeGreaterThan(0);
  });

  it('stat-seed effect names the stat and amount', () => {
    const e0 = addItem(createEconomy(), 'power-seed', 1);
    const { effect } = useItem(e0, 'power-seed');
    expect(effect?.stat).toBe('atk');
    expect(effect?.statAmount).toBe(1);
  });
});

describe('buy', () => {
  it('spends price*qty gold and adds the items on success', () => {
    const e0 = createEconomy({ gold: 100 });
    const { state, ok } = buy(e0, 'healing-herb', 2);
    expect(ok).toBe(true);
    expect(state.gold).toBe(100 - 20 * 2);
    expect(state.items['healing-herb']).toBe(2);
  });

  it('defaults qty to 1', () => {
    const e0 = createEconomy({ gold: 100 });
    const { state } = buy(e0, 'healing-herb');
    expect(state.items['healing-herb']).toBe(1);
    expect(state.gold).toBe(80);
  });

  it('fails on insufficient gold, leaving state unchanged', () => {
    const e0 = createEconomy({ gold: 5 });
    const { state, ok } = buy(e0, 'healing-herb');
    expect(ok).toBe(false);
    expect(state).toBe(e0);
  });

  it('fails for an unknown item id', () => {
    const e0 = createEconomy({ gold: 1000 });
    const { ok } = buy(e0, 'nonexistent-item');
    expect(ok).toBe(false);
  });
});

describe('sell', () => {
  it('removes items and refunds price*qty*SELL_FRACTION gold', () => {
    const e0 = addItem(createEconomy({ gold: 0 }), 'healing-herb', 3);
    const { state, ok } = sell(e0, 'healing-herb', 2);
    expect(ok).toBe(true);
    expect(state.items['healing-herb']).toBe(1);
    expect(state.gold).toBe(Math.floor(20 * 2 * SELL_FRACTION));
  });

  it('SELL_FRACTION is about half', () => {
    expect(SELL_FRACTION).toBeCloseTo(0.5);
  });

  it('fails when holding fewer than qty, leaving state unchanged', () => {
    const e0 = addItem(createEconomy(), 'healing-herb', 1);
    const { state, ok } = sell(e0, 'healing-herb', 2);
    expect(ok).toBe(false);
    expect(state).toBe(e0);
  });

  it('fails for an unknown item id', () => {
    const e0 = createEconomy();
    const { ok } = sell(e0, 'nonexistent-item', 1);
    expect(ok).toBe(false);
  });
});

describe('catalog integrity', () => {
  it('every ITEMS entry is well-formed', () => {
    for (const [key, def] of Object.entries(ITEMS)) {
      expect(def.id).toBe(key);
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.desc).toBe('string');
      expect(def.desc.length).toBeGreaterThan(0);
      expect(def.price).toBeGreaterThan(0);
      expect(['heal', 'mp', 'revive', 'bait', 'stat-seed', 'catalyst']).toContain(def.kind);
      expect(def.effect.kind).toBe(def.kind);
    }
  });

  it('itemDef looks up a known id and returns undefined for unknown', () => {
    expect(itemDef('healing-herb')).toBe(ITEMS['healing-herb']);
    expect(itemDef('nonexistent-item')).toBeUndefined();
  });

  it('allItemIds covers every catalog key', () => {
    expect(new Set(allItemIds())).toEqual(new Set(Object.keys(ITEMS)));
  });

  it('itemsOfKind filters correctly', () => {
    const seeds = itemsOfKind('stat-seed');
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) expect(s.kind).toBe('stat-seed');
  });
});

describe('shopFor', () => {
  it('returns a legible default list for tier 0', () => {
    const stock = shopFor(0);
    expect(stock).toContain('healing-herb');
    expect(stock.length).toBeGreaterThan(0);
    for (const id of stock) expect(ITEMS[id]).toBeDefined();
  });

  it('later tiers carry more stock', () => {
    expect(shopFor(1).length).toBeGreaterThan(shopFor(0).length);
    expect(shopFor(2).length).toBeGreaterThan(shopFor(1).length);
  });

  it('clamps an out-of-range tier to the fullest shop', () => {
    expect(shopFor(999)).toEqual(shopFor(2));
    expect(shopFor(-1)).toEqual(shopFor(0));
  });
});

describe('determinism + serialization', () => {
  it('JSON round-trips to a deep-equal state', () => {
    let e = createEconomy({ gold: 200 });
    e = buy(e, 'healing-herb', 3).state;
    e = buy(e, 'revive', 1).state;
    e = useItem(e, 'healing-herb').state;
    const round: EconomyState = JSON.parse(JSON.stringify(e));
    expect(round).toEqual(e);
  });

  it('is deterministic — same ops yield deep-equal states', () => {
    const build = (): EconomyState => {
      let e = createEconomy({ gold: 500 });
      e = buy(e, 'healing-herb', 2).state;
      e = buy(e, 'scout-bait', 1).state;
      e = sell(e, 'healing-herb', 1).state;
      e = useItem(e, 'scout-bait').state;
      return e;
    };
    expect(build()).toEqual(build());
  });

  it('gold and item counts never go negative across a sequence of ops', () => {
    let e = createEconomy({ gold: 10 });
    e = buy(e, 'revive', 5).state; // fails, insufficient gold
    e = spendGold(e, 9999).state; // fails
    e = useItem(e, 'healing-herb').state; // fails, none held
    e = sell(e, 'healing-herb', 1).state; // fails, none held
    expect(e.gold).toBeGreaterThanOrEqual(0);
    for (const count of Object.values(e.items)) {
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });
});
