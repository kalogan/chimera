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
import type { RivalState } from "game-kit/rival";
import {
  createBattle,
  step,
  findCombatant,
  type BattleState,
  type BattleAction,
  type BattleEvent,
  type BattleItemEffect,
  type Combatant,
} from "game-kit/battle";
import {
  createZone,
  stepZone,
  resumeAfterEncounter,
  isWalkable,
  type ZoneState,
  type ZoneEvent,
  type Dir,
} from "game-kit/world-runtime";
import {
  createEconomy,
  addGold,
  buy,
  sell,
  useItem,
  itemDef,
  type EconomyState,
} from "game-kit/economy";
import { MEADOWMERE, ZONES, zoneById, SANCTUARY_TARGET } from "./zone.js";
import {
  makeRivals,
  makeRivalCtx,
  advanceRivals,
  driftRivals,
  rivalAt,
  updateRival,
  type PlacedRival,
} from "./rivals.js";
import { saveGame, type SaveData } from "./save.js";

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
  // Overworld (Wave 2, generalized Wave 5). `zone` is the CURRENT walkable zone's
  // state (Meadowmere/Emberdeep/Tidewrack — see zone.ts's registry); when a battle
  // is entered FROM the zone, `zoneReturnRoamerId` remembers which roamer to
  // consume on the way back (null for a tall-grass encounter).
  zone: ZoneState | null;
  zoneReturnRoamerId: string | null;
  // Wave 5: the small world map. Zone ids the player has unlocked/can travel to —
  // Meadowmere is always unlocked; the others open the first time their portal is
  // reached (a portal is always walkable, so in practice all three are reachable
  // from the start via the travel graph, but this also drives the Sanctuary's
  // "Explore" zone picker and survives a save round-trip).
  unlockedZones: string[];
  // Wave 3: currency + inventory (the Market). Gold is earned from encounters;
  // items are bought here and (next slice) used in battle.
  economy: EconomyState;
  // Wave 4: rivals. Two AI rivals sim off-screen (kit `rival` module — real
  // roster/dex/breeding/economy reducers) and roam the world map (Wave 5:
  // distributed one per zone rather than all camping Meadowmere); walking into
  // one triggers a RIVAL BATTLE against their sim-produced party. `rivalBattleId`
  // remembers which rival you're currently fighting (null for a wild battle) so
  // Return-to-zone knows to relocate/advance that rival rather than consume a
  // roamer.
  rivals: PlacedRival[];
  rivalBattleId: string | null;
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
    unlockedZones: ["meadowmere"],
    economy: createEconomy({ gold: 120, items: { "healing-herb": 2 } }),
    rivals: makeRivals(),
    rivalBattleId: null,
  };
}

/**
 * Restore a fresh game to the Sanctuary using a loaded `SaveData` — roster,
 * economy, rivals (their full off-screen sim, so history/dex/roster all
 * resume exactly where they left off), rng seeds, and unlocked zones are
 * taken from the save; everything transient (screen/battle/zone/etc.) comes
 * from a fresh `newGame()` baseline so a restored game can never resume
 * mid-battle or mid-zone-transition.
 */
export function applySave(g: GameState, data: SaveData): GameState {
  return {
    ...g,
    screen: "party",
    battle: null,
    wildToken: null,
    log: [],
    outcome: null,
    cradlePick: [],
    newborn: null,
    lastBreed: null,
    zone: null,
    zoneReturnRoamerId: null,
    rivalBattleId: null,
    roster: data.roster,
    economy: data.economy,
    rivals: data.rivals,
    encounterSeed: data.encounterSeed,
    breedSeed: data.breedSeed,
    unlockedZones: data.unlockedZones.length > 0 ? data.unlockedZones : ["meadowmere"],
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

// ── Overworld (Wave 2, generalized Wave 5: a small world map) ──────────────────

// How many off-screen sim steps each rival gets per zone entry — enough that
// their roster/economy visibly differ (a scout, a hunt, sometimes a breed)
// between visits without a long pause.
const RIVAL_STEPS_PER_VISIT = 3;

/**
 * Leave the Sanctuary (or travel from another zone) into `zoneId`'s walkable
 * map (a fresh, seeded zone state each time). Defaults to Meadowmere — the
 * entry zone every fresh game starts unlocked. Only rivals CURRENTLY in the
 * destination zone advance/relocate; rivals elsewhere keep simming quietly
 * off-screen without a placement change (handled by `advanceRivals` itself).
 */
export function enterZone(g: GameState, zoneId: string = "meadowmere"): GameState {
  const descriptor = zoneById(zoneId);
  const ctx = makeRivalCtx();
  const rivals = advanceRivals(g.rivals, ctx, RIVAL_STEPS_PER_VISIT, descriptor.id);
  const unlockedZones = g.unlockedZones.includes(descriptor.id)
    ? g.unlockedZones
    : [...g.unlockedZones, descriptor.id];
  return {
    ...g,
    screen: "zone",
    zone: createZone(descriptor, g.encounterSeed * 101 + 7),
    zoneReturnRoamerId: null,
    unlockedZones,
    rivals,
    rivalBattleId: null,
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
  | { kind: "rival"; rivalId: string; name: string }
  | { kind: "portal"; to: string }
  | null;

/**
 * Advance the overworld one grid step. Returns the zone-updated game (screen
 * stays "zone" so the hop animates), the ordered ZoneEvent stream (for audio),
 * and a `pending` transition the view triggers after a short beat.
 *
 * Rivals are NOT kit `RoamerState`s (chimera tracks their tile positions in
 * `g.rivals`, parallel to `world-runtime`'s own roamers) — so after the kit
 * resolves the player's hop, we drift every in-zone rival one tile and check
 * the player's NEW tile against each rival's tile. A rival collision takes
 * PRIORITY over any wild pending (checked first below), and — like a wild
 * roamer hit — only fires when the kit step didn't already latch `done`
 * (can't double-trigger a battle on the same hop).
 */
export function zoneStep(
  g: GameState,
  dir: Dir,
): { game: GameState; events: ZoneEvent[]; pending: ZonePending } {
  if (g.screen !== "zone" || !g.zone) return { game: g, events: [], pending: null };
  const { state, events } = stepZone(g.zone, dir);
  const zoneId = g.zone.descriptor.id;

  let rivals = g.rivals;
  let pending: ZonePending = null;

  const moved = events.some((ev) => ev.type === "moved");
  const kitDone = state.done !== undefined;

  if (moved && !kitDone) {
    // Only drift rivals + check collision on a successful, uncontested hop.
    rivals = driftRivals(
      g.rivals,
      zoneId,
      state.player.x,
      state.player.y,
      state.step,
      (x, y) => isWalkable(state, x, y),
    );
    const hit = rivalAt(rivals, zoneId, state.player.x, state.player.y);
    if (hit) pending = { kind: "rival", rivalId: hit.rival.id, name: hit.rival.name };
  }

  if (!pending) {
    for (const ev of events) {
      if (ev.type === "encounter") {
        pending = { kind: "encounter", token: ev.token, roamerId: ev.roamerId ?? null };
      } else if (ev.type === "portal") {
        pending = { kind: "portal", to: ev.to };
      }
    }
  }

  const game = { ...g, zone: state, rivals };
  return { game, events, pending };
}

/**
 * Start a RIVAL BATTLE: your 3 party vs the rival's CURRENT sim-produced party
 * (`rival.roster.party`, expressed to full `Creature`s — never a fixed team).
 * The kit's `createBattle` already supports uneven N-vs-N, so a rival whose
 * sim hasn't grown past one starter still fields a legal (if lopsided) fight.
 */
export function startRivalBattle(g: GameState, rival: RivalState): GameState {
  const enemyTeam = rival.roster.party.map((t) => creatureFromToken(t));
  const battle = createBattle(partyCreatures(g), enemyTeam, g.encounterSeed * 1000 + hashSeedFromId(rival.id));
  return {
    ...g,
    screen: "battle",
    wildToken: null,
    battle,
    outcome: null,
    rivalBattleId: rival.id,
    zoneReturnRoamerId: null,
    log: [`${rival.name} blocks your path — a rival battle begins!`],
  };
}

// A tiny deterministic string→int so a rival battle's seed varies by WHICH
// rival you fight (not just the shared encounterSeed), without a real hash dep.
function hashSeedFromId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h >>> 0) % 97 + 3;
}

/** After a zone battle resolves, return to the current zone (consuming that roamer). */
export function returnToZone(g: GameState): GameState {
  const zone = g.zone
    ? resumeAfterEncounter(g.zone, g.zoneReturnRoamerId ?? undefined)
    : g.zone;
  const zoneId = g.zone?.descriptor.id ?? MEADOWMERE.id;

  // A rival battle doesn't consume a kit roamer — instead, advance that
  // rival's off-screen sim a beat further and relocate it, so it moves on
  // (and its team keeps growing) rather than standing right where you fought.
  let rivals = g.rivals;
  if (g.rivalBattleId) {
    const found = rivals.find((p) => p.rival.id === g.rivalBattleId);
    if (found) {
      const ctx = makeRivalCtx();
      const [advanced] = advanceRivals([found], ctx, RIVAL_STEPS_PER_VISIT, zoneId);
      rivals = updateRival(rivals, advanced!);
    }
  }

  return {
    ...g,
    screen: "zone",
    battle: null,
    wildToken: null,
    outcome: null,
    zone,
    zoneReturnRoamerId: null,
    rivalBattleId: null,
    rivals,
    encounterSeed: g.encounterSeed + 1,
  };
}

/**
 * Resolve a portal's `to` target: either `'sanctuary'` (leave the overworld
 * back to the hub) or another zone id (travel there directly, staying in the
 * "zone" screen). Both `exitZone` (legacy no-arg call, always the Sanctuary)
 * and the view's portal-pending handler route through this single function so
 * the travel graph has one source of truth.
 */
export function travelPortal(g: GameState, to: string): GameState {
  if (to === SANCTUARY_TARGET || !ZONES[to]) {
    return exitZone(g);
  }
  return enterZone({ ...g, screen: "party", zone: null, zoneReturnRoamerId: null }, to);
}

/** Step out of the overworld back to the Sanctuary hub (via a portal). Auto-saves. */
export function exitZone(g: GameState): GameState {
  const next: GameState = { ...g, screen: "party", zone: null, zoneReturnRoamerId: null, log: [] };
  saveGame(next);
  return next;
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

/** Leave the battle back to the sanctuary, bumping the encounter seed. Auto-saves. */
export function leaveBattle(g: GameState): GameState {
  const next: GameState = {
    ...g,
    screen: "party",
    battle: null,
    wildToken: null,
    outcome: null,
    rivalBattleId: null,
    encounterSeed: g.encounterSeed + 1,
    log: [],
  };
  saveGame(next);
  return next;
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
  const next: GameState = {
    ...g,
    roster,
    screen: "newborn",
    newborn,
    lastBreed: result,
    breedSeed: g.breedSeed + 1,
  };
  saveGame(next); // a new life is a natural auto-save beat
  return next;
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

// ── In-battle item use (Wave 3) ────────────────────────────────────────────────

// Item kinds usable in a fight (bait/stat-seeds/catalysts are not battle items).
const BATTLE_ITEM_KINDS = new Set(["heal", "mp", "revive"]);

export interface BattleItemOption { id: string; name: string; count: number; kind: string }

/** Inventory items that can be used in battle right now, with counts. */
export function usableBattleItems(g: GameState): BattleItemOption[] {
  const out: BattleItemOption[] = [];
  for (const [id, count] of Object.entries(g.economy.items)) {
    if (count <= 0) continue;
    const def = itemDef(id);
    if (def && BATTLE_ITEM_KINDS.has(def.effect.kind)) {
      out.push({ id, name: def.name, count, kind: def.effect.kind });
    }
  }
  return out;
}

function toBattleEffect(kind: string, amount?: number): BattleItemEffect | null {
  switch (kind) {
    case "heal": return { heal: amount ?? 0 };
    case "mp": return { mp: amount ?? 0 };
    case "revive": return { revive: true };
    default: return null;
  }
}

/** Which ally an item targets: a fainted ally for revive, else the lowest-HP
 *  (heal) / lowest-MP (mp) living ally. Null if there is no valid target. */
export function itemTargetId(battle: BattleState, itemId: string): string | null {
  const kind = itemDef(itemId)?.effect.kind;
  const team = battle.playerTeam;
  if (kind === "revive") return team.find((c) => !c.alive)?.id ?? null;
  const living = team.filter((c) => c.alive);
  if (living.length === 0) return null;
  if (kind === "mp") return living.reduce((lo, c) => (c.currentMp < lo.currentMp ? c : lo)).id;
  return living.reduce((lo, c) => (c.currentHp < lo.currentHp ? c : lo)).id;
}

/** Use an inventory item on an ally mid-battle: decrement the item, then apply
 *  its effect via the battle 'item' action (which consumes the turn). */
export function useItemInBattle(
  g: GameState,
  itemId: string,
  targetId: string,
): { game: GameState; events: BattleEvent[] } {
  if (!g.battle) return { game: g, events: [] };
  const { state: economy, ok, effect } = useItem(g.economy, itemId);
  if (!ok || !effect) return { game: g, events: [] };
  const battleEffect = toBattleEffect(effect.kind, effect.amount);
  if (!battleEffect) return { game: g, events: [] };
  return stepBattle({ ...g, economy }, { type: "item", targetId, effect: battleEffect });
}
