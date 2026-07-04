import { describe, it, expect } from "vitest";
import { creatureFromToken, seedToken, FAMILIES, RANKS, type CreatureToken, type Family } from "game-kit/creature";
import {
  deriveDex,
  rarityFor,
  matchupsFor,
  titleFor,
  flavorFor,
  dropsFor,
  habitatFor,
  RANK_RARITY,
} from "./creature-dex.js";

function tok(id: string, family: Family, plus = 0, generation = 0): CreatureToken {
  return { id, family, plus, generation, parents: null };
}

describe("rarityFor — rank → rarity map", () => {
  it("maps every rank to the documented rarity", () => {
    expect(rarityFor("F")).toBe("common");
    expect(rarityFor("E")).toBe("common");
    expect(rarityFor("D")).toBe("uncommon");
    expect(rarityFor("C")).toBe("uncommon");
    expect(rarityFor("B")).toBe("rare");
    expect(rarityFor("A")).toBe("epic");
    expect(rarityFor("S")).toBe("legendary");
  });

  it("covers every RANKS entry with no gaps", () => {
    for (const rank of RANKS) {
      expect(RANK_RARITY[rank]).toBeDefined();
    }
  });
});

describe("matchupsFor — matches the real battle element chart", () => {
  // Mirrors vendor/game-kit/src/battle/element.ts's ELEMENT_CHART exactly:
  //   water -> fire -> wind -> earth -> water (each beats the next)
  //   light <-> dark (mutual)
  it("a single-element creature is weak to its element cycle predecessor", () => {
    // fire beats wind: a wind-only creature is weak to fire.
    expect(matchupsFor(["wind"]).weakTo).toContain("fire");
    // wind beats earth: an earth-only creature is weak to wind.
    expect(matchupsFor(["earth"]).weakTo).toContain("wind");
    // earth beats water: a water-only creature is weak to earth.
    expect(matchupsFor(["water"]).weakTo).toContain("earth");
    // water beats fire: a fire-only creature is weak to water.
    expect(matchupsFor(["fire"]).weakTo).toContain("water");
  });

  it("light and dark are mutually weak (never resist each other)", () => {
    const light = matchupsFor(["light"]);
    expect(light.weakTo).toContain("dark");
    expect(light.resists).not.toContain("dark");

    const dark = matchupsFor(["dark"]);
    expect(dark.weakTo).toContain("light");
    expect(dark.resists).not.toContain("light");
  });

  it("resists the element it beats (water resists fire, since water beats fire)", () => {
    const water = matchupsFor(["water"]);
    expect(water.resists).toContain("fire");
    expect(water.weakTo).not.toContain("fire");
  });

  it("a dual-element creature unions weaknesses from both elements", () => {
    // fire is weak to water; earth is weak to wind — a fire+earth creature
    // inherits both (each element's own weak matchup still applies).
    const m = matchupsFor(["fire", "earth"]);
    expect(m.weakTo).toEqual(expect.arrayContaining(["water", "wind"]));
  });

  it("a single-element creature resists exactly what its element beats", () => {
    // The chart is one 4-cycle (water>fire>wind>earth>water), so any two
    // distinct cycle elements are adjacent enough that pairing them collapses
    // every matchup to "weak" (ties favor weak) — resists only shows up
    // cleanly for a single element, resisting precisely what it beats.
    const fire = matchupsFor(["fire"]);
    expect(fire.resists).toEqual(["wind"]);
    expect(fire.weakTo).toEqual(["water"]);
  });

  it("never marks the same element both weak and resisted (weak wins ties)", () => {
    for (const elements of [["fire"], ["water"], ["earth"], ["wind"], ["light"], ["dark"]] as const) {
      const m = matchupsFor(elements);
      for (const w of m.weakTo) expect(m.resists).not.toContain(w);
    }
  });
});

describe("deriveDex — determinism", () => {
  it("is deterministic: same creature -> deep-equal derivation", () => {
    for (const family of FAMILIES) {
      const t = tok(`dex-det-${family}`, family, 2, 1);
      const c1 = creatureFromToken(t);
      const c2 = creatureFromToken({ ...t });
      expect(deriveDex(c1)).toStrictEqual(deriveDex(c2));
    }
  });

  it("titleFor/flavorFor/dropsFor are deterministic per token id + family", () => {
    for (const family of FAMILIES) {
      const id = `stable-${family}`;
      expect(titleFor(id, family)).toBe(titleFor(id, family));
      expect(flavorFor(id, family)).toBe(flavorFor(id, family));
      expect(dropsFor(id, family)).toEqual(dropsFor(id, family));
    }
  });

  it("produces a full bundle for every family with non-empty fields", () => {
    for (const family of FAMILIES) {
      const c = creatureFromToken(tok(`dex-full-${family}`, family));
      const d = deriveDex(c);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.flavorText.length).toBeGreaterThan(0);
      expect(d.habitat.length).toBeGreaterThan(0);
      expect(d.drops.length).toBe(2);
      expect(d.drops[0]).not.toBe(d.drops[1]);
      expect(d.rarityColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.familyColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(["common", "uncommon", "rare", "epic", "legendary"]).toContain(d.rarity);
    }
  });

  it("habitat follows the family -> zone map", () => {
    expect(habitatFor("beast")).toBe("Meadowmere");
    expect(habitatFor("bird")).toBe("Meadowmere");
    expect(habitatFor("nature")).toBe("Meadowmere");
    expect(habitatFor("dragon")).toBe("Emberdeep");
    expect(habitatFor("golem")).toBe("Emberdeep");
    expect(habitatFor("aquatic")).toBe("Tidewrack");
    expect(habitatFor("slime")).toBe("Tidewrack");
    expect(habitatFor("spirit")).toBe("the wilds");
  });

  it("wires the creature's real matchups through (not invented ad hoc)", () => {
    const c = creatureFromToken(tok("dex-matchup-check", "dragon")); // primary element: fire
    const d = deriveDex(c);
    expect(d.matchups).toEqual(matchupsFor(c.elements));
  });

  it("rank -> rarity stays consistent across many seeded creatures", () => {
    for (let i = 0; i < 40; i++) {
      const c = creatureFromToken(seedToken(`rand-${i}`));
      const d = deriveDex(c);
      expect(d.rarity).toBe(rarityFor(c.rank));
    }
  });
});
