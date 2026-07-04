/**
 * worldtree — proof of the Aldercradle world registry + Heartseed state: all
 * 8 worlds now have a built zone (see zone.ts's ZONE_IDS), award ->
 * healedCount tracks correctly, isTreeWhole only flips at 8/8, the LINEAR
 * WORLD_ORDER chain gates unlock (derived from `heartseeds`, never
 * persisted), and the save round-trip (via game.ts/save.ts) carries seeds
 * across a reload.
 */
import { describe, it, expect } from "vitest";
import {
  WORLDS,
  WORLD_ORDER,
  builtWorlds,
  dormantWorlds,
  worldById,
  worldForZone,
  chainIndexOf,
  isWorldUnlocked,
  unlockedWorlds,
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

  it("all 8 worlds have a built zone, matching zone.ts's ZONE_IDS exactly", () => {
    const built = builtWorlds();
    expect(built.length).toBe(8);
    const zoneIds = built.map((w) => w.zoneId).sort();
    expect(zoneIds).toEqual([...ZONE_IDS].sort());
  });

  it("has zero dormant (roadmap) worlds — every world is built today", () => {
    expect(dormantWorlds().length).toBe(0);
  });

  it("worldById finds a known world and misses an unknown one", () => {
    expect(worldById("beast")?.label).toBe("Meadowmere");
    expect(worldById("nobody")).toBeUndefined();
  });

  it("worldForZone resolves each built zone id back to its world", () => {
    expect(worldForZone("meadowmere")?.id).toBe("beast");
    expect(worldForZone("skyreach")?.id).toBe("bird");
    expect(worldForZone("emberdeep")?.id).toBe("dragon");
    expect(worldForZone("tidewrack")?.id).toBe("aquatic");
    expect(worldForZone("oozehollow")?.id).toBe("slime");
    expect(worldForZone("verdanthush")?.id).toBe("nature");
    expect(worldForZone("stonewake")?.id).toBe("golem");
    expect(worldForZone("hollowvale")?.id).toBe("spirit");
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

describe("WORLD_ORDER — the linear 8-step unlock chain", () => {
  it("has exactly 8 entries, one per world, starting with beast and ending with spirit", () => {
    expect(WORLD_ORDER.length).toBe(8);
    expect(new Set(WORLD_ORDER).size).toBe(8);
    expect(WORLD_ORDER[0]).toBe("beast");
    expect(WORLD_ORDER[WORLD_ORDER.length - 1]).toBe("spirit");
  });

  it("chainIndexOf matches WORLD_ORDER's position, -1 for an unknown id", () => {
    WORLD_ORDER.forEach((id, i) => expect(chainIndexOf(id)).toBe(i));
    expect(chainIndexOf("nobody")).toBe(-1);
  });
});

describe("isWorldUnlocked / unlockedWorlds — derived, save-safe unlock", () => {
  it("a fresh Heartseeds record unlocks ONLY the first world in the chain", () => {
    const seeds = createHeartseeds();
    expect(isWorldUnlocked(seeds, WORLD_ORDER[0]!)).toBe(true);
    for (const id of WORLD_ORDER.slice(1)) expect(isWorldUnlocked(seeds, id)).toBe(false);
    expect(unlockedWorlds(seeds).map((w) => w.id)).toEqual([WORLD_ORDER[0]]);
  });

  it("healing a world unlocks exactly the NEXT world in the chain, nothing further", () => {
    let seeds = createHeartseeds();
    seeds = awardHeartseed(seeds, WORLD_ORDER[0]!);
    expect(isWorldUnlocked(seeds, WORLD_ORDER[1]!)).toBe(true);
    expect(isWorldUnlocked(seeds, WORLD_ORDER[2]!)).toBe(false);
  });

  it("healing every world in order unlocks the whole chain, one step at a time", () => {
    let seeds = createHeartseeds();
    for (let i = 0; i < WORLD_ORDER.length; i++) {
      expect(unlockedWorlds(seeds).length).toBe(i + 1);
      seeds = awardHeartseed(seeds, WORLD_ORDER[i]!);
    }
    expect(unlockedWorlds(seeds).length).toBe(WORLD_ORDER.length);
  });

  it("an unknown world id is never unlocked", () => {
    expect(isWorldUnlocked(createHeartseeds(), "nobody")).toBe(false);
  });

  it("unlock is DERIVED, not stored — a fresh game + a manually-awarded seed agree with a game restored via save/load", () => {
    clearSave();
    let g = newGame();
    g = awardWorldHeartseed(g, WORLD_ORDER[0]!);
    saveGame(g);
    const loaded = loadGame()!;
    const restored = applySave(newGame(), loaded);
    // Unlock state recomputed fresh from the restored heartseeds matches the
    // pre-save game exactly — nothing about "which pads are open" was ever
    // itself persisted.
    expect(unlockedWorlds(restored.heartseeds).map((w) => w.id)).toEqual(
      unlockedWorlds(g.heartseeds).map((w) => w.id),
    );
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
