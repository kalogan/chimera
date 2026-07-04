/**
 * zone-loop — headless proof of the Wave 2 overworld wiring: enter Meadowmere,
 * walk, meet a wild goober, battle it, and return to the meadow with that roamer
 * consumed. The pure movement/encounter logic is tested in the kit's
 * `world-runtime`; this pins the CHIMERA-side glue (enterZone / startEncounterWith
 * / returnToZone) so the loop can't silently break.
 */
import { describe, it, expect } from "vitest";
import {
  newGame,
  enterZone,
  zoneStep,
  startEncounterWith,
  returnToZone,
} from "./game.js";

describe("Meadowmere loop", () => {
  it("enters the zone with roamers on the grid", () => {
    const g = enterZone(newGame());
    expect(g.screen).toBe("zone");
    expect(g.zone).not.toBeNull();
    expect(g.zone!.roamers.length).toBeGreaterThan(0);
  });

  it("a grid step moves the player (or bumps a wall) deterministically", () => {
    const g = enterZone(newGame());
    const before = { ...g.zone!.player };
    const { game: g2, events } = zoneStep(g, "up");
    // Either we moved up (y decreased) or we were blocked — never a no-op silently.
    const moved = events.some((e) => e.type === "moved");
    const blocked = events.some((e) => e.type === "blocked");
    expect(moved || blocked).toBe(true);
    if (moved) expect(g2.zone!.player.y).toBe(before.y - 1);
  });

  it("meeting a wild goober battles THAT creature, then returns to the meadow", () => {
    const g = enterZone(newGame());
    const roamer = g.zone!.roamers[0]!;
    // Simulate the encounter handoff the view triggers on a `pending` encounter.
    const inBattle = startEncounterWith(g, roamer.token, roamer.id);
    expect(inBattle.screen).toBe("battle");
    expect(inBattle.battle).not.toBeNull();
    expect(inBattle.wildToken?.id).toBe(roamer.token.id);
    expect(inBattle.zoneReturnRoamerId).toBe(roamer.id);

    const back = returnToZone(inBattle);
    expect(back.screen).toBe("zone");
    expect(back.battle).toBeNull();
    // The roamer we fought is consumed — no instant re-trigger on the same tile.
    expect(back.zone!.roamers.some((r) => r.id === roamer.id)).toBe(false);
  });
});
