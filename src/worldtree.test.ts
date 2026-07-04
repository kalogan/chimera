/**
 * worldtree — proof of the Aldercradle world registry + Heartseed state:
 * exactly 8 worlds (3 built, 5 roadmap/dormant), award -> healedCount tracks
 * correctly, isTreeWhole only flips at 8/8, and the save round-trip (via
 * game.ts/save.ts) carries seeds across a reload.
 */
import { describe, it, expect } from "vitest";
import {
  WORLDS,
  builtWorlds,
  dormantWorlds,
  worldById,
  worldForZone,
  createHeartseeds,
  isHealed,
  awardHeartseed,
  healedCount,
  isTreeWhole,
  nextGuardianFor,
} from "./worldtree.js";
import { ZONE_IDS } from "./zone.js";
import { newGame, applySave, awardWorldHeartseed } from "./game.js";
import { saveGame, loadGame, clearSave } from "./save.js";

describe("WORLDS registry integrity", () => {
  it("has exactly 8 worlds, one per creature family", () => {
    expect(WORLDS.length).toBe(8);
    expect(new Set(WORLDS.map((w) => w.id)).size).toBe(8);
  });

  it("has exactly 3 worlds with a built zone, matching zone.ts's ZONE_IDS", () => {
    const built = builtWorlds();
    expect(built.length).toBe(3);
    const zoneIds = built.map((w) => w.zoneId).sort();
    expect(zoneIds).toEqual([...ZONE_IDS].sort());
  });

  it("has exactly 5 dormant (roadmap) worlds with no zone", () => {
    const dormant = dormantWorlds();
    expect(dormant.length).toBe(5);
    for (const w of dormant) expect(w.zoneId).toBeNull();
  });

  it("worldById finds a known world and misses an unknown one", () => {
    expect(worldById("beast")?.label).toBe("Meadowmere");
    expect(worldById("nobody")).toBeUndefined();
  });

  it("worldForZone resolves each built zone id back to its world", () => {
    expect(worldForZone("meadowmere")?.id).toBe("beast");
    expect(worldForZone("emberdeep")?.id).toBe("dragon");
    expect(worldForZone("tidewrack")?.id).toBe("aquatic");
    expect(worldForZone("nowhere")).toBeUndefined();
  });

  it("every world has a non-empty label, seedName, and lore", () => {
    for (const w of WORLDS) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.seedName.length).toBeGreaterThan(0);
      expect(w.lore.length).toBeGreaterThan(10);
    }
  });
});

describe("Heartseed state — award -> healedCount", () => {
  it("a fresh Heartseeds record heals nothing", () => {
    const seeds = createHeartseeds();
    expect(healedCount(seeds)).toBe(0);
    expect(isTreeWhole(seeds)).toBe(false);
    for (const w of WORLDS) expect(isHealed(seeds, w.id)).toBe(false);
  });

  it("awardHeartseed marks exactly that world healed, others untouched", () => {
    let seeds = createHeartseeds();
    seeds = awardHeartseed(seeds, "beast");
    expect(isHealed(seeds, "beast")).toBe(true);
    expect(isHealed(seeds, "dragon")).toBe(false);
    expect(healedCount(seeds)).toBe(1);
  });

  it("awarding all 8 worlds -> healedCount 8 and isTreeWhole true", () => {
    let seeds = createHeartseeds();
    for (const w of WORLDS) seeds = awardHeartseed(seeds, w.id);
    expect(healedCount(seeds)).toBe(8);
    expect(isTreeWhole(seeds)).toBe(true);
  });

  it("re-awarding an already-healed world doesn't double count", () => {
    let seeds = createHeartseeds();
    seeds = awardHeartseed(seeds, "beast");
    seeds = awardHeartseed(seeds, "beast");
    expect(healedCount(seeds)).toBe(1);
  });

  it("nextGuardianFor returns the world while unhealed, undefined once healed", () => {
    let seeds = createHeartseeds();
    expect(nextGuardianFor(seeds, "meadowmere")?.id).toBe("beast");
    seeds = awardHeartseed(seeds, "beast");
    expect(nextGuardianFor(seeds, "meadowmere")).toBeUndefined();
    expect(nextGuardianFor(seeds, "nowhere")).toBeUndefined();
  });
});

describe("Heartseeds survive a save round-trip (game.ts/save.ts wiring)", () => {
  it("a fresh game has no seeds, and saveGame/loadGame carries them", () => {
    clearSave();
    let g = newGame();
    expect(healedCount(g.heartseeds)).toBe(0);

    g = awardWorldHeartseed(g, "beast");
    expect(healedCount(g.heartseeds)).toBe(1);

    saveGame(g);
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.heartseeds).toEqual(g.heartseeds);
  });

  it("applySave forward-merges a save missing `heartseeds` (older shape) to an empty record, never crashes", () => {
    clearSave();
    const g = newGame();
    saveGame(g);
    // Simulate an OLDER SaveData shape (pre-worldtree) that never had a
    // `heartseeds` field at all — applySave must still produce a valid,
    // empty Heartseeds rather than throwing/undefined-propagating.
    const olderData = { ...loadGame()!, heartseeds: undefined as never };
    const restored = applySave(newGame(), olderData);
    expect(() => healedCount(restored.heartseeds)).not.toThrow();
    expect(healedCount(restored.heartseeds)).toBe(0);
  });
});
