/**
 * game — the pure CHIMERA core loop, engine-agnostic and testable headless.
 * Holds the roster + the current screen and drives: party → wild encounter →
 * turn-based battle (off the BattleEvent stream) → scout into the roster → the
 * Cradle (breed two) → a NEW creature is born. No React, no three here.
 */
import { createRng } from "game-kit/prng";
import { creatureFromToken, seedToken, type Creature, type CreatureToken } from "game-kit/creature";
import { breed, type BreedResult } from "game-kit/breeding";
import {
  createRoster,
  addCreature,
  markSeen,
  dexCount,
  type RosterState,
} from "game-kit/roster";
import {
  createBattle,
  step,
  findCombatant,
  type BattleState,
  type BattleAction,
  type BattleEvent,
  type Combatant,
} from "game-kit/battle";
import {
  createZone,
  stepZone,
  resumeAfterEncounter,
  type ZoneState,
  type ZoneEvent,
  type Dir,
} from "game-kit/world-runtime";
import {
  createEconomy,
  addGold,
  buy,
  sell,
  type EconomyState,
} from "game-kit/economy";
import { MEADOWMERE } from "./zone.js";

export type Screen = "party" | "zone" | "battle" | "cradle" | "newborn" | "shop";

// Gold earned when a wild encounter resolves — winning is worth more than
// befriending (scouting already rewards you with the creature itself).
const GOLD_WIN = 28;
const GOLD_SCOUT = 16;
export type Outcome = "win" | "lose" | "scouted" | "fled" | null;

export interface GameState {
  roster: RosterState;
  screen: Screen;
  encounterSeed: number;
  battle: BattleState | null;
  wildToken: CreatureToken | null;
  log: string[];
  outcome: Outcome;
  cradlePick: string[]; // token ids chosen to breed (max 2)
  newborn: Creature | null;
  lastBreed: BreedResult | null;
  breedSeed: number;
  // Overworld (Wave 2). `zone` is the walkable Meadowmere state; when a battle is
  // entered FROM the zone, `zoneReturnRoamerId` remembers which roamer to consume
  // on the way back (null for a tall-grass encounter).
  zone: ZoneState | null;
  zoneReturnRoamerId: string | null;
  // Wave 3: currency + inventory (the Market). Gold is earned from encounters;
  // items are bought here and (next slice) used in battle.
  economy: EconomyState;
}

// Three balanced rank-C starter companions (scanned for viable, non-godlike stats).
const STARTER_IDS = ["s16", "s24", "s33"];
// Early wild encounters, escalating from weak/scoutable → tougher. Kept legible so
// the first meadow encounter can be softened and befriended by the starters.
const WILD_POOL = ["w3", "w16", "w25", "w9", "w70", "w56"];

/** A fresh game: a starting party of three goober companions. */
export function newGame(): GameState {
  const starters = STARTER_IDS.map((id) => seedToken(id));
  return {
    roster: createRoster(starters, 3),
    screen: "party",
    encounterSeed: 1,
    battle: null,
    wildToken: null,
    log: [],
    outcome: null,
    cradlePick: [],
    newborn: null,
    lastBreed: null,
    breedSeed: 1,
    zone: null,
    zoneReturnRoamerId: null,
    economy: createEconomy({ gold: 120, items: { "healing-herb": 2 } }),
  };
}

/** Express the party tokens into full creatures. */
export function partyCreatures(g: GameState): Creature[] {
  return g.roster.party.map((t) => creatureFromToken(t));
}

/** The whole collection (party + storage), expressed. */
export function collectionCreatures(g: GameState): Creature[] {
  return [...g.roster.party, ...g.roster.storage].map((t) => creatureFromToken(t));
}

export function dexTotal(g: GameState): number {
  return dexCount(g.roster);
}

/** Deterministically make the wild encounter token from the encounter seed. */
export function makeWild(seed: number): CreatureToken {
  const id = WILD_POOL[(seed - 1) % WILD_POOL.length] ?? `wild-${seed}`;
  return seedToken(id);
}

/** Start a wild encounter: 3 party vs 1 wild. Marks the wild as SEEN. */
export function startEncounter(g: GameState): GameState {
  const wildToken = makeWild(g.encounterSeed);
  const wild = creatureFromToken(wildToken);
  const battle = createBattle(partyCreatures(g), [wild], g.encounterSeed * 1000 + 7);
  return {
    ...g,
    screen: "battle",
    wildToken,
    battle,
    outcome: null,
    roster: markSeen(g.roster, wildToken),
    log: [`A wild ${wild.name} (${wild.family} · rank ${wild.rank}) appears!`],
  };
}

// ── Overworld (Wave 2): the walkable Meadowmere ────────────────────────────────

/** Leave the Sanctuary and walk into Meadowmere (a fresh, seeded zone). */
export function enterZone(g: GameState): GameState {
  return {
    ...g,
    screen: "zone",
    zone: createZone(MEADOWMERE, g.encounterSeed * 101 + 7),
    zoneReturnRoamerId: null,
  };
}

/** Start a battle against a SPECIFIC wild token (the roamer/grass you met). */
export function startEncounterWith(
  g: GameState,
  wildToken: CreatureToken,
  roamerId: string | null,
): GameState {
  const wild = creatureFromToken(wildToken);
  const battle = createBattle(partyCreatures(g), [wild], g.encounterSeed * 1000 + 7);
  return {
    ...g,
    screen: "battle",
    wildToken,
    battle,
    outcome: null,
    zoneReturnRoamerId: roamerId,
    roster: markSeen(g.roster, wildToken),
    log: [`A wild ${wild.name} (${wild.family} · rank ${wild.rank}) appears!`],
  };
}

/** What a zone step wants the view layer to do next (after the hop plays). */
export type ZonePending =
  | { kind: "encounter"; token: CreatureToken; roamerId: string | null }
  | { kind: "portal"; to: string }
  | null;

/**
 * Advance the overworld one grid step. Returns the zone-updated game (screen
 * stays "zone" so the hop animates), the ordered ZoneEvent stream (for audio),
 * and a `pending` transition the view triggers after a short beat.
 */
export function zoneStep(
  g: GameState,
  dir: Dir,
): { game: GameState; events: ZoneEvent[]; pending: ZonePending } {
  if (g.screen !== "zone" || !g.zone) return { game: g, events: [], pending: null };
  const { state, events } = stepZone(g.zone, dir);
  const game = { ...g, zone: state };

  let pending: ZonePending = null;
  for (const ev of events) {
    if (ev.type === "encounter") {
      pending = { kind: "encounter", token: ev.token, roamerId: ev.roamerId ?? null };
    } else if (ev.type === "portal") {
      pending = { kind: "portal", to: ev.to };
    }
  }
  return { game, events, pending };
}

/** After a zone battle resolves, return to Meadowmere (consuming that roamer). */
export function returnToZone(g: GameState): GameState {
  const zone = g.zone
    ? resumeAfterEncounter(g.zone, g.zoneReturnRoamerId ?? undefined)
    : g.zone;
  return {
    ...g,
    screen: "zone",
    battle: null,
    wildToken: null,
    outcome: null,
    zone,
    zoneReturnRoamerId: null,
    encounterSeed: g.encounterSeed + 1,
  };
}

/** Step out of Meadowmere back to the Sanctuary hub (via the portal). */
export function exitZone(g: GameState): GameState {
  return { ...g, screen: "party", zone: null, zoneReturnRoamerId: null, log: [] };
}

/** The combatant whose turn it is (null if the battle is over / not choosing). */
export function activeActor(battle: BattleState | null): Combatant | null {
  if (!battle || battle.phase !== "choosing") return null;
  const id = battle.turnOrder[battle.activeIndex];
  if (id === undefined) return null;
  return findCombatant(battle, id) ?? null;
}

export function aliveEnemies(battle: BattleState): Combatant[] {
  return battle.enemyTeam.filter((c) => c.alive);
}

/** Auto-target the lowest-HP living enemy (keeps the placeholder UI simple). */
export function defaultTargetId(battle: BattleState): string | null {
  const alive = aliveEnemies(battle);
  if (alive.length === 0) return null;
  return alive.reduce((lo, c) => (c.currentHp < lo.currentHp ? c : lo)).id;
}

function summarize(ev: BattleEvent, battle: BattleState): string | null {
  const nm = (id: string) => findCombatant(battle, id)?.name ?? id;
  switch (ev.type) {
    case "damage":
      return `${nm(ev.sourceId)} hits ${nm(ev.targetId)} for ${ev.amount} (${ev.effectiveness})`;
    case "heal":
      return `${nm(ev.targetId)} recovers ${ev.amount} HP`;
    case "faint":
      return `${nm(ev.targetId)} faints…`;
    case "scout":
      return ev.success
        ? `You befriended ${nm(ev.targetId)}!`
        : `${nm(ev.targetId)} wasn't ready to bond (${Math.round(ev.chance * 100)}%)`;
    case "buff":
      return `${nm(ev.targetId)}'s ${ev.stat} rose`;
    case "debuff":
      return `${nm(ev.targetId)}'s ${ev.stat} fell`;
    case "flee":
      return ev.success ? `You slipped away.` : `Couldn't escape!`;
    case "level-up":
      return `${nm(ev.actorId)} grew to Lv ${ev.level}!`;
    case "victory":
      return `The wild one is safe. Victory.`;
    case "defeat":
      return `Your party is exhausted…`;
    default:
      return null;
  }
}

/**
 * Apply one player action, returning the new game + the ordered event stream
 * (so the view/audio layer can react). Resolves battle end + a successful scout
 * (adds the wild to the roster).
 */
export function stepBattle(
  g: GameState,
  action: BattleAction,
): { game: GameState; events: BattleEvent[] } {
  if (!g.battle) return { game: g, events: [] };
  const { state, events } = step(g.battle, action);

  const newLog = [...g.log];
  for (const ev of events) {
    const line = summarize(ev, state);
    if (line) newLog.push(line);
  }

  let roster = g.roster;
  let economy = g.economy;
  let outcome: Outcome = g.outcome;
  let screen: Screen = g.screen;

  const scouted = events.find((e) => e.type === "scout" && e.success);
  const fled = events.find((e) => e.type === "flee" && e.success);
  const won = events.some((e) => e.type === "victory");
  const lost = events.some((e) => e.type === "defeat");

  if (scouted && g.wildToken) {
    roster = addCreature(roster, g.wildToken);
    economy = addGold(economy, GOLD_SCOUT);
    outcome = "scouted";
  } else if (won) {
    economy = addGold(economy, GOLD_WIN);
    outcome = "win";
  } else if (lost) {
    outcome = "lose";
  } else if (fled) {
    outcome = "fled";
  }

  if (outcome) screen = "battle"; // stay to show the result banner; player taps Continue

  return {
    game: { ...g, battle: state, roster, economy, outcome, screen, log: newLog.slice(-8) },
    events,
  };
}

/** Leave the battle back to the sanctuary, bumping the encounter seed. */
export function leaveBattle(g: GameState): GameState {
  return {
    ...g,
    screen: "party",
    battle: null,
    wildToken: null,
    outcome: null,
    encounterSeed: g.encounterSeed + 1,
    log: [],
  };
}

export function openCradle(g: GameState): GameState {
  return { ...g, screen: "cradle", cradlePick: [], newborn: null };
}

export function togglePick(g: GameState, tokenId: string): GameState {
  const has = g.cradlePick.includes(tokenId);
  let pick = has ? g.cradlePick.filter((x) => x !== tokenId) : [...g.cradlePick, tokenId];
  if (pick.length > 2) pick = pick.slice(pick.length - 2);
  return { ...g, cradlePick: pick };
}

/** Breed the two picked companions → a NEW creature is born (the money moment). */
export function breedPicked(g: GameState): GameState {
  if (g.cradlePick.length !== 2) return g;
  const all = [...g.roster.party, ...g.roster.storage];
  const a = all.find((t) => t.id === g.cradlePick[0]);
  const b = all.find((t) => t.id === g.cradlePick[1]);
  if (!a || !b) return g;
  const result = breed(creatureFromToken(a), creatureFromToken(b), createRng(g.breedSeed));
  const newborn = creatureFromToken(result.childToken);
  const roster = addCreature(g.roster, result.childToken, { toStorage: true });
  return {
    ...g,
    roster,
    screen: "newborn",
    newborn,
    lastBreed: result,
    breedSeed: g.breedSeed + 1,
  };
}

export function backToParty(g: GameState): GameState {
  return { ...g, screen: "party", cradlePick: [], newborn: null };
}

// ── The Market (Wave 3) ────────────────────────────────────────────────────────

export function openShop(g: GameState): GameState {
  return { ...g, screen: "shop" };
}

export function buyItem(g: GameState, id: string): GameState {
  const { state, ok } = buy(g.economy, id, 1);
  return ok ? { ...g, economy: state } : g;
}

export function sellItem(g: GameState, id: string): GameState {
  const { state, ok } = sell(g.economy, id, 1);
  return ok ? { ...g, economy: state } : g;
}
