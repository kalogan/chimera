/**
 * aldercradle-loop — proof of the town-side Aldercradle wiring: walking onto
 * the tree tile reports a `tree` pending (opened via openAldercradle),
 * walking onto a dormant pad reports a `dormant` pending (never travels),
 * and the 8/8 endgame gate only opens the finale once every world is healed
 * — `openFinale` is a no-op otherwise, so there's no way to reach it early
 * even if a button were somehow shown.
 */
import { describe, it, expect } from "vitest";
import {
  newGame,
  townStep,
  openAldercradle,
  leaveAldercradle,
  treeHealedCount,
  treeIsWhole,
  openFinale,
  leaveFinale,
  awardWorldHeartseed,
} from "./game.js";
import { TOWN_TREE_TILE, TOWN_DORMANT_PADS } from "./town.js";
import { WORLDS } from "./worldtree.js";

describe("townStep reports the Aldercradle tree pending", () => {
  it("stepping onto TOWN_TREE_TILE reports { kind: 'tree' }", () => {
    const g = newGame();
    const [tx, ty] = TOWN_TREE_TILE;
    const staged = { ...g, townPlayerTile: [tx, ty - 1] as [number, number] };
    const { game: g2, pending } = townStep(staged, 0, 1);
    expect(g2.townPlayerTile).toEqual([tx, ty]);
    expect(pending).toEqual({ kind: "tree" });
  });

  it("openAldercradle / leaveAldercradle round-trip screens", () => {
    const g = newGame();
    const opened = openAldercradle(g);
    expect(opened.screen).toBe("aldercradle");
    const back = leaveAldercradle(opened);
    expect(back.screen).toBe("town");
  });
});

describe("townStep reports a dormant pending for a roadmap world's pad", () => {
  it("stepping onto a dormant pad never travels — just reports the pad's label", () => {
    const g = newGame();
    const pad = TOWN_DORMANT_PADS[0]!;
    const [px, py] = pad.tile;
    const staged = { ...g, townPlayerTile: [px, py - 1] as [number, number] };
    const { game: g2, pending } = townStep(staged, 0, 1);
    expect(g2.townPlayerTile).toEqual([px, py]);
    expect(pending).toEqual({ kind: "dormant", label: pad.label });
    // Screen never changes — this is a hint, not a transition.
    expect(g2.screen).toBe(g.screen);
  });
});

describe("the 8/8 endgame gate", () => {
  it("is false for a fresh game, and true only once every world is awarded", () => {
    let g = newGame();
    expect(treeIsWhole(g)).toBe(false);
    for (const w of WORLDS) {
      expect(treeIsWhole(g)).toBe(false);
      g = awardWorldHeartseed(g, w.id);
    }
    expect(treeHealedCount(g)).toBe(8);
    expect(treeIsWhole(g)).toBe(true);
  });

  it("openFinale is a no-op below 8/8 (the Architect's force-test path — see report)", () => {
    let g = newGame();
    g = awardWorldHeartseed(g, "beast");
    g = awardWorldHeartseed(g, "dragon");
    const attempted = openFinale(g);
    expect(attempted.screen).not.toBe("finale");
    expect(attempted).toBe(g); // exact no-op, not just a different screen
  });

  it("openFinale opens the finale once all 8 are awarded; leaveFinale returns to town", () => {
    let g = newGame();
    for (const w of WORLDS) g = awardWorldHeartseed(g, w.id);
    const finale = openFinale(g);
    expect(finale.screen).toBe("finale");
    const back = leaveFinale(finale);
    expect(back.screen).toBe("town");
  });
});
