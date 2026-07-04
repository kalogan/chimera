import { describe, it, expect } from "vitest";
import { newGame, startEncounter, activeActor, defaultTargetId, stepBattle } from "./game.js";
import type { GameState } from "./game.js";

// Headless drive of the full battle so the SCOUT path is reachable at runtime
// (the browser smoke can't tune balance). Policy: soften the wild, then befriend it.
function driveToScout(g0: GameState): { outcome: string; rounds: number } {
  let g = startEncounter(g0);
  for (let i = 0; i < 60; i++) {
    if (g.outcome) return { outcome: g.outcome, rounds: i };
    const b = g.battle!;
    const actor = activeActor(b);
    const target = defaultTargetId(b);
    if (!actor || !target) break;
    const enemy = b.enemyTeam.find((c) => c.id === target)!;
    const hpPct = enemy.currentHp / enemy.maxHp;
    const action =
      hpPct > 0.6
        ? { type: "attack" as const, targetId: target }
        : { type: "scout" as const, targetId: target };
    g = stepBattle(g, action).game;
  }
  return { outcome: g.outcome ?? "unresolved", rounds: 60 };
}

describe("core loop is playable — scout is reachable", () => {
  it("the starter party can soften and scout the first wild", () => {
    const { outcome } = driveToScout(newGame());
    expect(outcome).toBe("scouted");
  });

  it("battle always resolves deterministically (same seed → same outcome)", () => {
    const a = driveToScout(newGame());
    const b = driveToScout(newGame());
    expect(a).toEqual(b);
    expect(["scouted", "win", "lose", "fled"]).toContain(a.outcome);
  });
});
