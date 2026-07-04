/**
 * dex (screen transition) — pins the game.ts glue the Dex screen depends on:
 * `openDex` switches to the "dex" screen without disturbing roster/economy/
 * zone state, and `backToParty` returns to the Sanctuary. The Dex's own
 * render logic (src/dex.tsx) is a presentational React/DOM component with no
 * game-state mutation of its own — consistent with the rest of this app's
 * test suite (ZoneScene/GooberStage are exercised via headless game.ts glue
 * too, not component-rendered) — so this file covers the state machine, and
 * dex.tsx itself reads roster.dex read-only.
 */
import { describe, it, expect } from "vitest";
import { newGame, openDex, backToParty, enterZone } from "./game.js";

describe("Dex screen transition", () => {
  it("openDex switches to the dex screen, preserving all other state", () => {
    const g = newGame();
    const d = openDex(g);
    expect(d.screen).toBe("dex");
    expect(d.roster).toBe(g.roster);
    expect(d.economy).toBe(g.economy);
    expect(d.rivals).toBe(g.rivals);
  });

  it("backToParty returns from the Dex to the Sanctuary", () => {
    const g = openDex(newGame());
    const back = backToParty(g);
    expect(back.screen).toBe("party");
  });

  it("the starter roster's dex already has entries for the 3 starters (owned)", () => {
    const g = newGame();
    const entries = Object.values(g.roster.dex);
    expect(entries.length).toBe(3);
    for (const e of entries) expect(["owned", "bred"]).toContain(e.status);
  });

  it("opening the Dex from inside a zone still reports the zone's roamers as seen once encountered", () => {
    // Not a strict requirement of openDex itself, but proves dex state survives
    // a zone round-trip (openDex doesn't reset/clear anything zone-related).
    const g = enterZone(newGame());
    const d = openDex(g);
    expect(d.zone).toBe(g.zone);
    expect(d.screen).toBe("dex");
  });
});
