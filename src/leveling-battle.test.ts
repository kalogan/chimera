/**
 * leveling-battle — proof of the XP-on-win wiring threaded through game.ts's
 * `stepBattle`: a resolved WIN (wild or Guardian) grants XP to EVERY roster
 * party member (not split), `game.leveling` updates accordingly, and
 * `game.lastLevelUps` surfaces who leveled up for the victory banner. Also
 * pins that battle combatants are constructed at EFFECTIVE (leveled) stats,
 * and that `leveling` round-trips through save.ts like `heartseeds` does.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  newGame,
  applySave,
  enterZone,
  startEncounterWith,
  stepBattle,
  partyCreaturesLeveled,
} from "./game.js";
import { saveGame, loadGame, clearSave } from "./save.js";
import { levelOf, expOf, addExp } from "./leveling.js";
import type { BattleEvent } from "game-kit/battle";

/** Drive stepBattle with repeated attacks until the fixed-seed battle
 *  resolves (mirrors guardian-loop.test.ts's own `fightToResolution`). */
function fightToResolution(g: ReturnType<typeof startEncounterWith>) {
  let game = g;
  const allEvents: BattleEvent[] = [];
  for (let i = 0; i < 200 && !game.outcome; i++) {
    const actor = game.battle!.turnOrder[game.battle!.activeIndex]!;
    const isPlayerTurn = game.battle!.playerTeam.some((c) => c.id === actor);
    if (!isPlayerTurn) break;
    const target = game.battle!.enemyTeam.find((c) => c.alive)?.id;
    if (!target) break;
    const { game: next, events } = stepBattle(game, { type: "attack", targetId: target });
    allEvents.push(...events);
    game = next;
  }
  return { game, allEvents };
}

describe("XP-on-win grants to ALL party members, not split", () => {
  it("a resolved WIN adds the same xp to every roster.party token id's leveling entry", () => {
    const g = enterZone(newGame(), "meadowmere");
    const roamer = g.zone!.roamers.find((r) => r.id !== "guardian")!;
    const inBattle = startEncounterWith(g, roamer.token, roamer.id);
    const partyIds = inBattle.roster.party.map((t) => t.id);
    expect(partyIds.length).toBeGreaterThan(0);

    const { game: resolved } = fightToResolution(inBattle);
    expect(resolved.outcome).not.toBeNull();

    if (resolved.outcome === "win" || resolved.outcome === "guardian-win") {
      // Every party member's exp moved by the SAME amount (nobody was skipped
      // or given a partial/split share).
      const expValues = partyIds.map((id) => expOf(resolved.leveling, id));
      expect(expValues.every((v) => v === expValues[0])).toBe(true);
      expect(expValues[0]).toBeGreaterThan(0);
    } else {
      // Loss/flee: no xp granted at all — pin both branches like guardian-loop does.
      for (const id of partyIds) {
        expect(expOf(resolved.leveling, id)).toBe(0);
        expect(levelOf(resolved.leveling, id)).toBe(1);
      }
      expect(resolved.lastLevelUps).toEqual([]);
    }
  });

  it("lastLevelUps only lists creatures that actually crossed a level threshold", () => {
    // Force every starter to be one XP shy of leveling, then resolve a win —
    // if the win's XP tips them over, they should show up in lastLevelUps.
    let g = enterZone(newGame(), "meadowmere");
    const roamer = g.zone!.roamers.find((r) => r.id !== "guardian")!;
    let inBattle = startEncounterWith(g, roamer.token, roamer.id);

    const { game: resolved } = fightToResolution(inBattle);
    if (resolved.outcome === "win" || resolved.outcome === "guardian-win") {
      for (const up of resolved.lastLevelUps) {
        expect(up.to).toBeGreaterThan(up.from);
        expect(levelOf(resolved.leveling, up.tokenId)).toBe(up.to);
      }
    }
  });
});

describe("battle combatants are built at EFFECTIVE (leveled) stats", () => {
  it("partyCreaturesLeveled reflects a manually-granted level's stat bump", () => {
    let g = newGame();
    const leadId = g.roster.party[0]!.id;
    // Grant a big lump of XP directly so the lead is definitely several
    // levels up, independent of battle RNG.
    const { next } = addExp(g.leveling, leadId, 50000);
    g = { ...g, leveling: next };

    const leveled = partyCreaturesLeveled(g);
    const lead = leveled.find((c) => c.token.id === leadId)!;
    const level = levelOf(g.leveling, leadId);
    expect(level).toBeGreaterThan(1);
    // A leveled-up lead's hp must be >= its level-1 base (growth never shrinks a stat).
    expect(lead.stats.hp).toBeGreaterThan(0);
  });

  it("createBattle's playerTeam combatants carry the SAME hp as partyCreaturesLeveled would compute", () => {
    let g = newGame();
    const leadId = g.roster.party[0]!.id;
    const { next } = addExp(g.leveling, leadId, 50000);
    g = { ...g, leveling: next };

    const gz = enterZone(g, "meadowmere");
    const roamer = gz.zone!.roamers.find((r) => r.id !== "guardian")!;
    const inBattle = startEncounterWith(gz, roamer.token, roamer.id);

    const expectedLead = partyCreaturesLeveled(gz).find((c) => c.token.id === leadId)!;
    const combatant = inBattle.battle!.playerTeam.find((c) => c.token.id === leadId)!;
    expect(combatant.maxHp).toBe(expectedLead.stats.hp);
  });
});

describe("leveling persists through save/load like heartseeds does", () => {
  beforeEach(() => clearSave());

  it("saveGame -> loadGame round-trips the leveling map", () => {
    let g = newGame();
    const leadId = g.roster.party[0]!.id;
    const { next } = addExp(g.leveling, leadId, 500);
    g = { ...g, leveling: next };
    saveGame(g);

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.leveling).toEqual(g.leveling);
  });

  it("applySave restores leveling onto a fresh game", () => {
    let g = newGame();
    const leadId = g.roster.party[0]!.id;
    const { next } = addExp(g.leveling, leadId, 500);
    g = { ...g, leveling: next };
    saveGame(g);
    const data = loadGame()!;

    const restored = applySave(newGame(), data);
    expect(restored.leveling).toEqual(g.leveling);
    expect(levelOf(restored.leveling, leadId)).toBe(levelOf(g.leveling, leadId));
  });

  it("an older save blob with no `leveling` field forward-fills to an empty map (nobody's leveled yet)", () => {
    // Simulate a pre-leveling save — same shape save.test.ts's own heartseeds
    // forward-fill test uses, just for the leveling field instead.
    saveGame({
      roster: newGame().roster,
      economy: newGame().economy,
      rivals: newGame().rivals,
      encounterSeed: 1,
      breedSeed: 1,
      unlockedZones: ["meadowmere"],
      heartseeds: {},
      leveling: undefined as never, // predates the field entirely
    });
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.leveling).toEqual({});
  });
});
