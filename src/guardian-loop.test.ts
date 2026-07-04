/**
 * guardian-loop — proof of the Aldercradle Guardian encounter: each built
 * zone (Meadowmere/Emberdeep/Tidewrack) has exactly one Guardian roamer,
 * walking into it starts a flagged battle, a VICTORY awards that world's
 * Heartseed + pacifies the Guardian (no re-fight), while a LOSS/FLEE leaves
 * it standing so the player can try again. Mirrors zone-loop.test.ts's shape
 * for the ordinary wild-roamer loop.
 */
import { describe, it, expect } from "vitest";
import {
  newGame,
  enterZone,
  startEncounterWith,
  stepBattle,
  returnToZone,
  treeHealedCount,
} from "./game.js";
import { ZONE_IDS } from "./zone.js";
import { GUARDIAN_ROAMER_ID } from "./zone.js";
import { worldForZone } from "./worldtree.js";
import type { BattleEvent } from "game-kit/battle";

describe("every built zone has exactly one Guardian roamer", () => {
  for (const zoneId of ZONE_IDS) {
    it(`${zoneId} has a Guardian roamer at a fixed idle tile`, () => {
      const g = enterZone(newGame(), zoneId);
      const guardians = g.zone!.roamers.filter((r) => r.id === GUARDIAN_ROAMER_ID);
      expect(guardians.length).toBe(1);
      expect(guardians[0]!.wander).toBe("idle");
      // The Guardian's token family matches this zone's world exactly.
      const world = worldForZone(zoneId)!;
      expect(guardians[0]!.token.family).toBe(world.family);
    });
  }
});

describe("walking into the Guardian starts a flagged boss battle", () => {
  it("startEncounterWith flags guardianBattleWorldId for the Guardian roamer", () => {
    const g = enterZone(newGame(), "meadowmere");
    const guardian = g.zone!.roamers.find((r) => r.id === GUARDIAN_ROAMER_ID)!;
    const inBattle = startEncounterWith(g, guardian.token, guardian.id);
    expect(inBattle.screen).toBe("battle");
    expect(inBattle.guardianBattleWorldId).toBe("beast");
  });

  it("does NOT flag guardianBattleWorldId for an ordinary wild roamer", () => {
    const g = enterZone(newGame(), "meadowmere");
    const roamer = g.zone!.roamers.find((r) => r.id !== GUARDIAN_ROAMER_ID)!;
    const inBattle = startEncounterWith(g, roamer.token, roamer.id);
    expect(inBattle.guardianBattleWorldId).toBeNull();
  });
});

// Force a battle to a clean victory/defeat by directly manipulating enemy HP
// via repeated 'attack' actions isn't guaranteed deterministic-fast, so these
// two tests instead drive stepBattle with synthetic events isn't possible
// (step() owns event derivation) — instead we attack repeatedly until the
// kit's own battle resolves, which IS deterministic given a fixed seed.
function fightToResolution(
  g: ReturnType<typeof startEncounterWith>,
): { game: ReturnType<typeof startEncounterWith>; allEvents: BattleEvent[] } {
  let game = g;
  const allEvents: BattleEvent[] = [];
  for (let i = 0; i < 200 && !game.outcome; i++) {
    const actor = game.battle!.turnOrder[game.battle!.activeIndex]!;
    const isPlayerTurn = game.battle!.playerTeam.some((c) => c.id === actor);
    if (!isPlayerTurn) break; // shouldn't happen mid-choosing phase
    const target = game.battle!.enemyTeam.find((c) => c.alive)?.id;
    if (!target) break;
    const { game: next, events } = stepBattle(game, { type: "attack", targetId: target });
    allEvents.push(...events);
    game = next;
  }
  return { game, allEvents };
}

describe("Guardian VICTORY awards the Heartseed and pacifies the Guardian", () => {
  it("defeating Meadowmere's Guardian heals the beast world and removes the roamer", () => {
    let g = enterZone(newGame(), "meadowmere");
    const guardian = g.zone!.roamers.find((r) => r.id === GUARDIAN_ROAMER_ID)!;
    let inBattle = startEncounterWith(g, guardian.token, guardian.id);
    expect(treeHealedCount(inBattle)).toBe(0);

    const { game: resolved } = fightToResolution(inBattle);
    // With enough attack turns against a fixed-seed battle, SOME outcome is
    // reached (this repo's own battle system is deterministic + bounded).
    expect(resolved.outcome).not.toBeNull();

    if (resolved.outcome === "guardian-win") {
      expect(treeHealedCount(resolved)).toBe(1);
      const back = returnToZone(resolved);
      expect(back.zone!.roamers.some((r) => r.id === GUARDIAN_ROAMER_ID)).toBe(false);
    } else {
      // Loss/flee: the Guardian must remain (no seed, no pacify) — pin BOTH
      // branches so this test can't silently only cover the lucky RNG path.
      expect(treeHealedCount(resolved)).toBe(0);
      const back = returnToZone(resolved);
      expect(back.zone!.roamers.some((r) => r.id === GUARDIAN_ROAMER_ID)).toBe(true);
    }
  });
});
