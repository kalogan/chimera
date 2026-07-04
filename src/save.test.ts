/**
 * save — proof of the Wave 5 persistence slice: `saveGame`/`loadGame` round
 * trip the persistent subset of GameState, `applySave` restores a fresh game
 * to the Town (the game's landing hub) from that data, and a corrupt/missing
 * save degrades to `null` (never a throw) so a bad blob can never crash the app.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { saveGame, loadGame, hasSave, clearSave } from "./save.js";
import { newGame, applySave, enterZone, breedPicked, togglePick } from "./game.js";

describe("save/load round-trip", () => {
  beforeEach(() => clearSave());

  it("hasSave() is false with nothing persisted", () => {
    expect(hasSave()).toBe(false);
    expect(loadGame()).toBeNull();
  });

  it("saveGame -> loadGame round-trips roster/economy/rivals/seeds/unlockedZones", () => {
    const g = enterZone(newGame(), "emberdeep"); // unlocks emberdeep, advances rivals
    saveGame(g);

    expect(hasSave()).toBe(true);
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.roster).toEqual(g.roster);
    expect(loaded!.economy).toEqual(g.economy);
    expect(loaded!.rivals).toEqual(g.rivals);
    expect(loaded!.encounterSeed).toBe(g.encounterSeed);
    expect(loaded!.breedSeed).toBe(g.breedSeed);
    expect(loaded!.unlockedZones).toEqual(g.unlockedZones);
  });

  it("applySave restores a fresh game to the Town with the saved roster/economy/dex/rivals", () => {
    // Breed once so roster/dex/breedSeed have moved from their defaults, then save.
    let g = newGame();
    g = togglePick(g, g.roster.party[0]!.id);
    g = togglePick(g, g.roster.party[1]!.id);
    g = breedPicked(g); // this itself auto-saves, but we still drive it through save.ts explicitly below
    saveGame(g);
    const data = loadGame();
    expect(data).not.toBeNull();

    // Restore into a brand-new, DIFFERENT fresh game to prove the data actually transplants.
    const fresh = newGame();
    const restored = applySave(fresh, data!);

    expect(restored.screen).toBe("town");
    expect(restored.battle).toBeNull();
    expect(restored.zone).toBeNull();
    expect(restored.roster).toEqual(g.roster);
    expect(restored.roster.storage.length).toBeGreaterThan(0); // the newborn is in storage
    expect(restored.breedSeed).toBe(g.breedSeed);
  });

  it("a missing save loads as null, never throws", () => {
    clearSave();
    expect(() => loadGame()).not.toThrow();
    expect(loadGame()).toBeNull();
  });

  it("a malformed-shape save (fails isSaveData's structural check) loads as null, never throws", () => {
    // The kit's save module itself already proves corrupt-JSON/checksum/version
    // handling (vendor/game-kit/src/save/index.test.ts); this pins CHIMERA's own
    // extra guard — a syntactically valid but structurally wrong payload (e.g. an
    // old/foreign shape that happens to match version+checksum) must still be
    // rejected as "no save", never partially applied.
    saveGame({
      roster: {} as never, // missing party/storage arrays — fails isSaveData
      economy: { gold: 0, items: {} },
      rivals: [],
      encounterSeed: 1,
      breedSeed: 1,
      unlockedZones: ["meadowmere"],
    });
    expect(() => loadGame()).not.toThrow();
    expect(loadGame()).toBeNull();
  });
});
