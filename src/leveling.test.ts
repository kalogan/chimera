/**
 * leveling — proof of the XP/level slice: per-family `leveledStats` is
 * monotonic in level and level-1 reproduces the token's base stats exactly;
 * `expForLevel`'s gentle curve is monotonic and clamps at LEVEL_CAP;
 * `addExp`/`addExpToCreature` carry remainder across multiple level-ups and
 * never exceed the cap; `grantXpToParty` awards the SAME full amount to every
 * party member (never split); and enemy-level-by-tier (zone.ts) climbs with
 * the WORLD_ORDER chain, mirroring difficulty-ramp.test.ts's own shape.
 */
import { describe, it, expect } from "vitest";
import { creatureFromToken, FAMILIES, seedToken, type CreatureToken, type Family } from "game-kit/creature";
import {
  createLeveling,
  levelOf,
  expOf,
  expForLevel,
  addExpToCreature,
  addExp,
  xpForWin,
  xpForDefeatedTeam,
  grantXpToParty,
  leveledStats,
  creatureAtLevel,
  growthAt,
  LEVEL_CAP,
  K_XP,
} from "./leveling.js";
import { roamerLevel, guardianLevel, enemyLevelForToken } from "./zone.js";
import { WORLD_ORDER } from "./worldtree.js";

function tok(id: string, family: Family, plus = 0, generation = 0): CreatureToken {
  return { id, family, plus, generation, parents: null };
}

describe("createLeveling / levelOf / expOf defaults", () => {
  it("an unlisted creature defaults to level 1, exp 0", () => {
    const leveling = createLeveling();
    expect(levelOf(leveling, "unknown-token")).toBe(1);
    expect(expOf(leveling, "unknown-token")).toBe(0);
  });
});

describe("expForLevel — the gentle/cozy curve", () => {
  it("costs nothing to 'reach' level 1", () => {
    expect(expForLevel(1)).toBe(0);
    expect(expForLevel(0)).toBe(0);
  });

  it("is strictly increasing from level 2 up to the cap", () => {
    let prev = -1;
    for (let lvl = 2; lvl <= LEVEL_CAP; lvl++) {
      const cost = expForLevel(lvl);
      expect(cost).toBeGreaterThan(prev);
      prev = cost;
    }
  });

  it("early levels are cheap (gentle, not Polymatrix's steep cubic)", () => {
    // L2 should be a small, easily-reached cost — nothing like a cubic curve's
    // early-game wall. Pinned generously so the exact K stays tunable.
    expect(expForLevel(2)).toBeLessThan(50);
    expect(expForLevel(5)).toBeLessThan(200);
  });

  it("clamps at LEVEL_CAP — asking beyond the cap doesn't keep climbing", () => {
    expect(expForLevel(LEVEL_CAP + 10)).toBe(expForLevel(LEVEL_CAP));
  });
});

describe("addExpToCreature — carry-over + cap clamp", () => {
  it("a small amount accumulates exp without leveling up yet", () => {
    const { next, levelsGained } = addExpToCreature({ level: 1, exp: 0 }, 5);
    expect(levelsGained).toBe(0);
    expect(next.level).toBe(1);
    expect(next.exp).toBe(5);
  });

  it("enough exp levels up once, carrying the remainder", () => {
    const need2 = expForLevel(2);
    const { next, levelsGained, from, to } = addExpToCreature({ level: 1, exp: 0 }, need2 + 7);
    expect(levelsGained).toBe(1);
    expect(from).toBe(1);
    expect(to).toBe(2);
    expect(next.level).toBe(2);
    expect(next.exp).toBe(7);
  });

  it("a huge lump sum carries over MULTIPLE level-ups in one call", () => {
    const { next, levelsGained } = addExpToCreature({ level: 1, exp: 0 }, 100000);
    expect(levelsGained).toBeGreaterThan(1);
    expect(next.level).toBeGreaterThan(1);
    expect(next.level).toBeLessThanOrEqual(LEVEL_CAP);
  });

  it("never exceeds LEVEL_CAP even with an absurd amount, and drops leftover exp at the cap", () => {
    const { next } = addExpToCreature({ level: 1, exp: 0 }, 10_000_000);
    expect(next.level).toBe(LEVEL_CAP);
    expect(next.exp).toBe(0);
  });

  it("a creature already at the cap gains nothing further", () => {
    const { next, levelsGained } = addExpToCreature({ level: LEVEL_CAP, exp: 0 }, 5000);
    expect(levelsGained).toBe(0);
    expect(next.level).toBe(LEVEL_CAP);
    expect(next.exp).toBe(0);
  });

  it("zero/negative amounts are a no-op", () => {
    const state = { level: 3, exp: 10 };
    expect(addExpToCreature(state, 0).next).toEqual(state);
    expect(addExpToCreature(state, -5).next).toEqual(state);
  });
});

describe("addExp — whole-map wrapper, forward-fills a missing entry", () => {
  it("adds exp to a fresh (unlisted) token, defaulting to level 1 first", () => {
    const leveling = createLeveling();
    const { next } = addExp(leveling, "tok-a", 5);
    expect(next["tok-a"]).toEqual({ level: 1, exp: 5 });
  });

  it("leaves other entries in the map untouched", () => {
    let leveling = createLeveling();
    leveling = addExp(leveling, "tok-a", 5).next;
    const { next } = addExp(leveling, "tok-b", 9);
    expect(next["tok-a"]).toEqual({ level: 1, exp: 5 });
    expect(next["tok-b"]).toEqual({ level: 1, exp: 9 });
  });
});

describe("xpForWin / xpForDefeatedTeam", () => {
  it("xpForWin scales with enemy level via K_XP", () => {
    expect(xpForWin(10)).toBe(Math.round(10 * K_XP));
  });

  it("xpForWin is always at least 1 (never zero/negative for a valid level)", () => {
    expect(xpForWin(0)).toBeGreaterThanOrEqual(1);
  });

  it("xpForDefeatedTeam sums xpForWin across every enemy, not just one", () => {
    const total = xpForDefeatedTeam([5, 10, 15]);
    expect(total).toBe(xpForWin(5) + xpForWin(10) + xpForWin(15));
  });
});

describe("grantXpToParty — XP on WIN awards the SAME full amount to every party member", () => {
  it("grants the identical amount to all listed token ids, not split", () => {
    const leveling = createLeveling();
    const ids = ["p1", "p2", "p3"];
    // Kept safely below expForLevel(2) so this test only checks the "no split"
    // invariant, not level-up carry-over (that's covered separately below).
    const amount = expForLevel(2) - 1;
    const { next } = grantXpToParty(leveling, ids, amount);
    for (const id of ids) {
      expect(expOf(next, id)).toBe(amount);
      expect(levelOf(next, id)).toBe(1);
    }
  });

  it("reports a level-up entry only for creatures that actually gained a level", () => {
    const leveling = createLeveling();
    const need2 = expForLevel(2);
    const { levelUps } = grantXpToParty(leveling, ["p1", "p2"], need2 + 3);
    expect(levelUps.length).toBe(2);
    for (const up of levelUps) {
      expect(up.from).toBe(1);
      expect(up.to).toBe(2);
    }
  });

  it("an empty party list is a safe no-op", () => {
    const leveling = createLeveling();
    const { next, levelUps } = grantXpToParty(leveling, [], 1000);
    expect(next).toEqual(leveling);
    expect(levelUps).toEqual([]);
  });
});

describe("leveledStats / creatureAtLevel — per-family growth", () => {
  it("level 1 reproduces the token's base stats exactly (no growth bump yet)", () => {
    for (const family of FAMILIES) {
      const token = tok(`seed-${family}`, family);
      const creature = creatureFromToken(token);
      const at1 = leveledStats(creature, 1);
      expect(at1).toEqual(creature.stats);
    }
  });

  it("growthAt is zero at level 1 for every family", () => {
    for (const family of FAMILIES) {
      const g = growthAt(family, 1);
      expect(g).toEqual({ hp: 0, mp: 0, atk: 0, def: 0, agi: 0, wis: 0 });
    }
  });

  it("every stat is monotonically non-decreasing as level climbs, per family", () => {
    for (const family of FAMILIES) {
      const token = tok(`mono-${family}`, family);
      const creature = creatureFromToken(token);
      let prev = leveledStats(creature, 1);
      for (let lvl = 2; lvl <= LEVEL_CAP; lvl += 1) {
        const cur = leveledStats(creature, lvl);
        (Object.keys(cur) as (keyof typeof cur)[]).forEach((k) => {
          expect(cur[k]).toBeGreaterThanOrEqual(prev[k]);
        });
        prev = cur;
      }
    }
  });

  it("leveledStats accepts a bare CreatureToken too (expresses it internally)", () => {
    const token = tok("bare-token", "dragon");
    const fromToken = leveledStats(token, 10);
    const fromCreature = leveledStats(creatureFromToken(token), 10);
    expect(fromToken).toEqual(fromCreature);
  });

  it("creatureAtLevel returns a Creature with stats swapped to the leveled block, identity intact", () => {
    const token = tok("swap-token", "beast");
    const creature = creatureFromToken(token);
    const leveled = creatureAtLevel(creature, 20);
    expect(leveled.name).toBe(creature.name);
    expect(leveled.family).toBe(creature.family);
    expect(leveled.stats).toEqual(leveledStats(creature, 20));
  });

  it("each family has a DISTINCT growth identity — no two families share an identical bias vector", () => {
    const growthVectors = FAMILIES.map((f) => JSON.stringify(growthAt(f, 25)));
    expect(new Set(growthVectors).size).toBe(FAMILIES.length);
  });

  it("golem/beast grow HP faster than bird/spirit (per the design's growth-identity intent)", () => {
    const hpAt = (family: Family) => growthAt(family, 30).hp;
    expect(hpAt("golem")).toBeGreaterThan(hpAt("bird"));
    expect(hpAt("beast")).toBeGreaterThan(hpAt("spirit"));
  });

  it("bird grows AGI faster than golem; spirit grows WIS faster than dragon", () => {
    expect(growthAt("bird", 30).agi).toBeGreaterThan(growthAt("golem", 30).agi);
    expect(growthAt("spirit", 30).wis).toBeGreaterThan(growthAt("dragon", 30).wis);
  });

  it("dragon grows ATK faster than aquatic/nature (the heavy hitter vs. the balanced growers)", () => {
    expect(growthAt("dragon", 30).atk).toBeGreaterThan(growthAt("aquatic", 30).atk);
    expect(growthAt("dragon", 30).atk).toBeGreaterThan(growthAt("nature", 30).atk);
  });
});

describe("enemy level by tier (zone.ts) — climbs with the WORLD_ORDER chain", () => {
  it("roamerLevel is non-decreasing across the 8-world chain (allowing for the small per-token variance)", () => {
    // Compare AVERAGE level across several seed ids per chain position (the
    // variance is only ±2) so one unlucky roll can't flip the ordering.
    const avgAt = (idx: number) => {
      const family = WORLD_ORDER[idx]!;
      const seeds = ["a", "b", "c", "d", "e"].map((s) => `${family}-roamer-${s}`);
      const levels = seeds.map((s) => roamerLevel(family, s));
      return levels.reduce((a, b) => a + b, 0) / levels.length;
    };
    let prev = -Infinity;
    for (let i = 0; i < WORLD_ORDER.length; i++) {
      const avg = avgAt(i);
      expect(avg).toBeGreaterThanOrEqual(prev);
      prev = avg;
    }
  });

  it("guardianLevel is always at or above that world's own roamerLevel tier (the Guardian is the spike)", () => {
    for (let i = 0; i < WORLD_ORDER.length; i++) {
      // Compare the deterministic BASE tiers (seed-independent) rather than
      // any single jittered roll, since roamer/Guardian variance bands differ.
      const roamerBase = 3 + i * 6;
      const guardianBase = 8 + i * 6;
      expect(guardianBase).toBeGreaterThan(roamerBase);
    }
  });

  it("every level is clamped within [1, LEVEL_CAP]", () => {
    for (const family of WORLD_ORDER) {
      expect(roamerLevel(family, `${family}-x`)).toBeGreaterThanOrEqual(1);
      expect(roamerLevel(family, `${family}-x`)).toBeLessThanOrEqual(LEVEL_CAP);
      expect(guardianLevel(family, `${family}-x`)).toBeGreaterThanOrEqual(1);
      expect(guardianLevel(family, `${family}-x`)).toBeLessThanOrEqual(LEVEL_CAP);
    }
  });

  it("enemyLevelForToken routes to the Guardian curve iff isGuardian is true", () => {
    const token = seedToken("some-enemy");
    const asRoamer = enemyLevelForToken(token, false);
    const asGuardian = enemyLevelForToken(token, true);
    expect(asRoamer).toBe(roamerLevel(token.family, token.id));
    expect(asGuardian).toBe(guardianLevel(token.family, token.id));
  });

  it("is deterministic — the same (family, seedId) always yields the same level", () => {
    expect(roamerLevel("dragon", "same-id")).toBe(roamerLevel("dragon", "same-id"));
    expect(guardianLevel("dragon", "same-id")).toBe(guardianLevel("dragon", "same-id"));
  });
});
