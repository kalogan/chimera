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
  release,
  swapToParty,
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
  addItem,
  buy,
  sell,
  useItem,
  itemDef,
  type EconomyState,
} from "game-kit/economy";
import {
  createQuestLog,
  recordEvent,
  claimReward,
  offerable,
  acceptQuest,
  type QuestState,
  type QuestEvent,
  type QuestDef,
} from "game-kit/quest";
import { MEADOWMERE, ZONES, zoneById, SANCTUARY_TARGET, GUARDIAN_ROAMER_ID, GUARDIAN_TITLE } from "./zone.js";
import {
  makeRivals,
  makeRivalCtx,
  advanceRivals,
  driftRivals,
  rivalAt,
  updateRival,
  type PlacedRival,
} from "./rivals.js";
import {
  TOWN_SPAWN,
  isTownWalkable,
  portalAt,
  dormantPadAt,
  TOWN_HOME_TILE,
  TOWN_TREE_TILE,
} from "./town.js";
import { saveGame, type SaveData } from "./save.js";
import {
  createHeartseeds,
  awardHeartseed,
  healedCount,
  isTreeWhole,
  worldForZone,
  type Heartseeds,
} from "./worldtree.js";

export type Screen =
  | "home"
  | "zone"
  | "battle"
  | "cradle"
  | "newborn"
  | "shop"
  | "dex"
  | "town"
  | "trade"
  | "aldercradle"
  | "finale";

// Gold earned when a wild encounter resolves — winning is worth more than
// befriending (scouting already rewards you with the creature itself).
const GOLD_WIN = 28;
const GOLD_SCOUT = 16;
// A Guardian battle is worth notably more than a common wild win — this is
// the boss of the zone's whole world.
const GOLD_GUARDIAN_WIN = 150;
export type Outcome = "win" | "lose" | "scouted" | "fled" | "guardian-win" | null;

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
  // TOWN (walkable plaza hub). `townPlayerTile` is the player's grid position
  // in town.ts's map, carried in GameState (not local App.tsx state) so it
  // survives whatever the view layer does; `quests` is the player's quest log
  // (see GAME_QUESTS below) — IN-SESSION ONLY for now, see save.ts note at
  // applySave/newGame (save.ts's SaveData is a closed, unedited shape, so
  // quest progress does not yet survive a reload).
  townPlayerTile: [number, number];
  quests: QuestState;
  // ALDERCRADLE (world-tree progression). `heartseeds` is the PERSISTED record
  // of which of the 8 worlds (see worldtree.ts's WORLDS) have had their
  // Guardian defeated — the tree's bloom stage is derived from this via
  // `healedCount`, never stored redundantly. `guardianBattleWorldId` mirrors
  // `rivalBattleId`'s shape: set when the CURRENT battle is a Guardian fight
  // (identified by the zone roamer id `zone.ts`'s GUARDIAN_ROAMER_ID, not a
  // new ZoneEvent variant), so stepBattle/leaveBattle/returnToZone know to
  // award the seed + pacify the Guardian on victory, and it's null for every
  // ordinary wild/rival battle.
  heartseeds: Heartseeds;
  guardianBattleWorldId: string | null;
}

/**
 * CHIMERA's quest catalog, lightly adapted from the kit's `SAMPLE_QUESTS`
 * families/zones to this game's own (beast/dragon/aquatic families;
 * meadowmere/emberdeep/tidewrack zones; Old Tamsin as the sole in-fiction
 * giver). Offered through Old Tamsin's TownDialogue (`offerable(GAME_QUESTS,
 * g.quests)`); progressed by `recordEvent` calls threaded through the real
 * game moments (see stepBattle/breedPicked/enterZone below).
 */
export const GAME_QUESTS: readonly QuestDef[] = [
  {
    id: "q-scout-beasts",
    title: "Beastly Business",
    giver: "questgiver",
    description: "Scout 3 beast-family goobers for the town ranch.",
    objective: { kind: "scout-family", family: "beast", count: 3 },
    reward: { gold: 100 },
  },
  {
    id: "q-reach-emberdeep",
    title: "Into the Embers",
    giver: "questgiver",
    description: "Find your way to Emberdeep.",
    objective: { kind: "reach-zone", zone: "emberdeep" },
    reward: { gold: 50, itemId: "healing-herb", itemCount: 3 },
  },
  {
    id: "q-first-breed",
    title: "A New Generation",
    giver: "questgiver",
    description: "Weave your first new life in the Cradle.",
    objective: { kind: "breed", count: 1 },
    reward: { itemId: "dragon-catalyst", itemCount: 1 },
    prereq: "q-scout-beasts",
  },
  {
    id: "q-grow-the-dex",
    title: "Compendium",
    giver: "questgiver",
    description: "Discover 10 species for the Dex.",
    objective: { kind: "dex", count: 10 },
    reward: { unlockZone: "tidewrack" },
    prereq: "q-reach-emberdeep",
  },
  {
    id: "q-tide-scout",
    title: "Tidewrack Bounty",
    giver: "questgiver",
    description: "Scout 2 aquatic-family goobers from Tidewrack.",
    objective: { kind: "scout-family", family: "aquatic", count: 2 },
    reward: { gold: 80 },
    prereq: "q-grow-the-dex",
  },
];

// Three balanced rank-C starter companions (scanned for viable, non-godlike stats).
const STARTER_IDS = ["s16", "s24", "s33"];
// Early wild encounters, escalating from weak/scoutable → tougher. Kept legible so
// the first meadow encounter can be softened and befriended by the starters.
const WILD_POOL = ["w3", "w16", "w25", "w9", "w70", "w56"];

/** A fresh game: a starting party of three goober companions. Lands in the
 *  walkable TOWN (not the old Sanctuary/party menu) — see the Screen type's
 *  "home" for the retired menu's successor, now a building you walk into. */
export function newGame(): GameState {
  const starters = STARTER_IDS.map((id) => seedToken(id));
  return {
    roster: createRoster(starters, 3),
    screen: "town",
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
    townPlayerTile: [...TOWN_SPAWN],
    quests: createQuestLog(),
    heartseeds: createHeartseeds(),
    guardianBattleWorldId: null,
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
    screen: "town",
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
    guardianBattleWorldId: null,
    roster: data.roster,
    economy: data.economy,
    rivals: data.rivals,
    encounterSeed: data.encounterSeed,
    breedSeed: data.breedSeed,
    unlockedZones: data.unlockedZones.length > 0 ? data.unlockedZones : ["meadowmere"],
    // Older saves may predate this field entirely (see save.ts's note) —
    // forward-fill to "no seeds yet" rather than propagating undefined.
    heartseeds: data.heartseeds ?? createHeartseeds(),
    // Not part of SaveData (see the note on GameState.quests) — a loaded game
    // always resumes with a fresh in-session quest log and the town spawn,
    // same as every other transient/screen-local field above.
    townPlayerTile: [...TOWN_SPAWN],
    quests: g.quests,
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
    guardianBattleWorldId: null,
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
 * Leave the town (via a teleporter pad) — or travel from another zone —
 * into `zoneId`'s walkable map (a fresh, seeded zone state each time).
 * Defaults to Meadowmere — the entry zone every fresh game starts unlocked.
 * Only rivals CURRENTLY in the destination zone advance/relocate; rivals
 * elsewhere keep simming quietly off-screen without a placement change
 * (handled by `advanceRivals` itself).
 */
export function enterZone(g: GameState, zoneId: string = "meadowmere"): GameState {
  const descriptor = zoneById(zoneId);
  const ctx = makeRivalCtx();
  const rivals = advanceRivals(g.rivals, ctx, RIVAL_STEPS_PER_VISIT, descriptor.id);
  const unlockedZones = g.unlockedZones.includes(descriptor.id)
    ? g.unlockedZones
    : [...g.unlockedZones, descriptor.id];
  const next: GameState = {
    ...g,
    screen: "zone",
    zone: createZone(descriptor, g.encounterSeed * 101 + 7),
    zoneReturnRoamerId: null,
    unlockedZones,
    rivals,
    rivalBattleId: null,
    guardianBattleWorldId: null,
  };
  return applyQuestEvent(next, { type: "enteredZone", zone: descriptor.id });
}

/** Start a battle against a SPECIFIC wild token (the roamer/grass you met).
 *  A Guardian roamer (id === GUARDIAN_ROAMER_ID) is recognized here and
 *  flagged via `guardianBattleWorldId` — same battle system, a distinct
 *  opening log line, and (on victory) the Heartseed award in `stepBattle`. */
export function startEncounterWith(
  g: GameState,
  wildToken: CreatureToken,
  roamerId: string | null,
): GameState {
  const wild = creatureFromToken(wildToken);
  const battle = createBattle(partyCreatures(g), [wild], g.encounterSeed * 1000 + 7);
  const zoneId = g.zone?.descriptor.id;
  const isGuardian = roamerId === GUARDIAN_ROAMER_ID && !!zoneId;
  const guardianTitle = zoneId ? GUARDIAN_TITLE[zoneId] : undefined;
  return {
    ...g,
    screen: "battle",
    wildToken,
    battle,
    outcome: null,
    zoneReturnRoamerId: roamerId,
    guardianBattleWorldId: isGuardian ? (worldForZone(zoneId!)?.id ?? null) : null,
    roster: markSeen(g.roster, wildToken),
    log:
      isGuardian && guardianTitle
        ? [`${guardianTitle} rises to meet you — this is no ordinary foe.`]
        : [`A wild ${wild.name} (${wild.family} · rank ${wild.rank}) appears!`],
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
    guardianBattleWorldId: null,
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

/**
 * After a zone battle resolves, return to the current zone (consuming that
 * roamer). An ordinary wild roamer is ALWAYS consumed on return, win or lose
 * (the existing design — it never re-triggers). A GUARDIAN roamer is the one
 * exception: it's only removed on an actual victory (`outcome ===
 * 'guardian-win'`) — on defeat/flee it stays exactly where it was, so the
 * Guardian can be challenged again rather than vanishing on a loss.
 */
export function returnToZone(g: GameState): GameState {
  const isUndefeatedGuardian =
    g.zoneReturnRoamerId === GUARDIAN_ROAMER_ID && g.outcome !== "guardian-win";
  // Undefeated Guardian: clear the `done` latch (so stepZone accepts input
  // again) WITHOUT filtering the roamer out — pass no roamerId so it's kept.
  // Any other case (a normal roamer, or a Guardian that WAS just defeated):
  // consume the roamer exactly as before.
  const zone = g.zone
    ? resumeAfterEncounter(g.zone, isUndefeatedGuardian ? undefined : (g.zoneReturnRoamerId ?? undefined))
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
    guardianBattleWorldId: null,
    rivals,
    encounterSeed: g.encounterSeed + 1,
  };
}

/**
 * Resolve a portal's `to` target: either `'sanctuary'` (leave the overworld
 * back to the TOWN — the name is legacy from before the Town existed, but the
 * routing target is now the walkable hub, not the retired Sanctuary menu) or
 * another zone id (travel there directly, staying in the "zone" screen). Both
 * `exitZone` (legacy no-arg call, always back to town) and the view's
 * portal-pending handler route through this single function so the travel
 * graph has one source of truth.
 */
export function travelPortal(g: GameState, to: string): GameState {
  if (to === SANCTUARY_TARGET || !ZONES[to]) {
    return exitZone(g);
  }
  return enterZone({ ...g, screen: "town", zone: null, zoneReturnRoamerId: null }, to);
}

/** Step out of the overworld back to the TOWN (via a portal). Auto-saves. */
export function exitZone(g: GameState): GameState {
  const next: GameState = {
    ...g,
    screen: "town",
    zone: null,
    zoneReturnRoamerId: null,
    guardianBattleWorldId: null,
    log: [],
  };
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
  let heartseeds = g.heartseeds;

  const scouted = events.find((e) => e.type === "scout" && e.success);
  const fled = events.find((e) => e.type === "flee" && e.success);
  const won = events.some((e) => e.type === "victory");
  const lost = events.some((e) => e.type === "defeat");
  const guardianWorldId = g.guardianBattleWorldId;

  if (scouted && g.wildToken) {
    roster = addCreature(roster, g.wildToken);
    economy = addGold(economy, GOLD_SCOUT);
    outcome = "scouted";
  } else if (won && guardianWorldId) {
    // The Guardian falls: award its world's Heartseed + a heftier purse, and
    // surface the "guardian-win" outcome so the view can show a distinct,
    // warmer beat than an ordinary wild victory.
    economy = addGold(economy, GOLD_GUARDIAN_WIN);
    heartseeds = awardHeartseed(heartseeds, guardianWorldId);
    outcome = "guardian-win";
  } else if (won) {
    economy = addGold(economy, GOLD_WIN);
    outcome = "win";
  } else if (lost) {
    outcome = "lose";
  } else if (fled) {
    outcome = "fled";
  }

  if (outcome) screen = "battle"; // stay to show the result banner; player taps Continue

  if (outcome === "guardian-win") {
    const world = worldForZone(g.zone?.descriptor.id ?? "");
    const title = g.zone ? GUARDIAN_TITLE[g.zone.descriptor.id] : undefined;
    if (world && title) {
      newLog.push(`${title} falls — you recovered ${world.seedName}!`);
    }
  }

  let next: GameState = { ...g, battle: state, roster, economy, outcome, screen, heartseeds, log: newLog.slice(-8) };

  // Quest progress: a successful scout advances scout-family/scout-any +
  // grows the Dex tally; a won RIVAL battle advances defeat-rival for that
  // specific rival (a plain wild victory carries no rival id, so it never
  // matches a defeat-rival objective).
  if (scouted && g.wildToken) {
    next = applyQuestEvent(next, { type: "scouted", family: creatureFromToken(g.wildToken).family });
    next = applyQuestEvent(next, { type: "dexCount", total: dexCount(roster) });
  }
  if (won && g.rivalBattleId) {
    next = applyQuestEvent(next, { type: "defeatedRival", rivalId: g.rivalBattleId });
  }

  return { game: next, events };
}

/** Leave the battle back to the town, bumping the encounter seed. Auto-saves. */
export function leaveBattle(g: GameState): GameState {
  const next: GameState = {
    ...g,
    screen: "town",
    battle: null,
    wildToken: null,
    outcome: null,
    rivalBattleId: null,
    guardianBattleWorldId: null,
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
  let next: GameState = {
    ...g,
    roster,
    screen: "newborn",
    newborn,
    lastBreed: result,
    breedSeed: g.breedSeed + 1,
  };
  next = applyQuestEvent(next, { type: "bred", family: newborn.family });
  next = applyQuestEvent(next, { type: "dexCount", total: dexCount(roster) });
  saveGame(next); // a new life is a natural auto-save beat
  return next;
}

/** Return to the TOWN from the Cradle/Market/Dex/Newborn-reveal screens (the
 *  name is legacy from the retired Sanctuary/party menu — kept so every call
 *  site below stays a one-liner — but the destination is now the walkable
 *  town, per the Director's "back to town, not the retired Sanctuary" call). */
export function backToParty(g: GameState): GameState {
  return { ...g, screen: "town", cradlePick: [], newborn: null };
}

// ── Quests (Old Tamsin's questgiver flow) ───────────────────────────────────

/** Fold one `QuestEvent` into the quest log, applying any reward(s) for quests
 *  that newly complete this call (gold/item → economy, unlockZone → the
 *  unlocked-zones list) — the ONE place `recordEvent`'s output is threaded
 *  into the rest of GameState, so every call site below (stepBattle/
 *  breedPicked/enterZone) stays a one-liner. */
function applyQuestEvent(g: GameState, event: QuestEvent): GameState {
  const { state: quests, completed } = recordEvent(GAME_QUESTS, g.quests, event);
  if (completed.length === 0) return { ...g, quests };

  let economy = g.economy;
  let unlockedZones = g.unlockedZones;
  for (const id of completed) {
    const def = GAME_QUESTS.find((d) => d.id === id);
    if (!def) continue;
    const reward = claimReward(def);
    if (reward.gold) economy = addGold(economy, reward.gold);
    if (reward.itemId) economy = addItem(economy, reward.itemId, reward.itemCount ?? 1);
    if (reward.unlockZone && !unlockedZones.includes(reward.unlockZone)) {
      unlockedZones = [...unlockedZones, reward.unlockZone];
    }
  }
  return { ...g, quests, economy, unlockedZones };
}

/** Accept an offered quest by id (Old Tamsin's TownDialogue → `onAcceptQuest`). */
export function acceptGameQuest(g: GameState, id: string): GameState {
  return { ...g, quests: acceptQuest(g.quests, id) };
}

/** Quests Old Tamsin currently has to offer (not active, not completed, prereqs met). */
export function offeredQuests(g: GameState): QuestDef[] {
  return offerable(GAME_QUESTS, g.quests);
}

// ── TOWN (walkable plaza hub — the game's landing place) ───────────────────

/** Enter (or re-enter) the town at the road-in spawn tile. Still used to
 *  return to a known-good tile (e.g. after a facility visit that doesn't
 *  otherwise touch `townPlayerTile`), even though the town is no longer
 *  reached FROM a separate Sanctuary menu — it's where the game lands. */
export function enterTown(g: GameState): GameState {
  return { ...g, screen: "town", townPlayerTile: [...TOWN_SPAWN] };
}

/** Move the player's town tile, guarded by `isTownWalkable` — a no-op (same
 *  state) on a blocked step so the caller can always just setGame() the result. */
export function moveInTown(g: GameState, dx: number, dy: number): GameState {
  const [x, y] = g.townPlayerTile;
  const nx = x + dx;
  const ny = y + dy;
  if (!isTownWalkable(nx, ny)) return g;
  return { ...g, townPlayerTile: [nx, ny] };
}

/** What a town step wants the view layer to do next (after the hop plays) —
 *  mirrors `ZonePending`'s shape so `TownScreen`'s onStep can drive the same
 *  "play a cue, short delay, then transition" beat ZoneScreen already uses
 *  for its golden-ring portals. `dormant` never transitions anywhere — it's
 *  just a hint beat ("this world still sleeps") for a not-yet-built world's pad. */
export type TownPending =
  | { kind: "portal"; zoneId: string }
  | { kind: "home" }
  | { kind: "tree" }
  | { kind: "dormant"; label: string }
  | null;

/** Move in town, additionally reporting a pending transition if the player's
 *  NEW tile lands on a zone teleporter pad, the Home building's door tile, the
 *  Aldercradle, or a dormant future-world pad. A no-op move (blocked step)
 *  never reports a pending transition. */
export function townStep(
  g: GameState,
  dx: number,
  dy: number,
): { game: GameState; pending: TownPending } {
  const next = moveInTown(g, dx, dy);
  if (next === g) return { game: next, pending: null };
  const [x, y] = next.townPlayerTile;
  const pad = portalAt(x, y);
  if (pad && g.unlockedZones.includes(pad.zoneId)) {
    return { game: next, pending: { kind: "portal", zoneId: pad.zoneId } };
  }
  if (x === TOWN_HOME_TILE[0] && y === TOWN_HOME_TILE[1]) {
    return { game: next, pending: { kind: "home" } };
  }
  if (x === TOWN_TREE_TILE[0] && y === TOWN_TREE_TILE[1]) {
    return { game: next, pending: { kind: "tree" } };
  }
  const dormant = dormantPadAt(x, y);
  if (dormant) {
    return { game: next, pending: { kind: "dormant", label: dormant.label } };
  }
  return { game: next, pending: null };
}

/** Open the Home building (party lineup + box management) from the town. */
export function openHome(g: GameState): GameState {
  return { ...g, screen: "home" };
}

/** Leave Home back to the town. */
export function leaveHome(g: GameState): GameState {
  return { ...g, screen: "town" };
}

/** Swap a storage creature into the active party (Home's box management),
 *  optionally naming which party member to send back to storage when the
 *  party is already full. A thin GameState wrapper over the kit's
 *  `swapToParty` reducer — no-ops (returns `g` unchanged) on any invariant
 *  violation rather than throwing, since this is driven straight off HomeScreen
 *  button clicks. */
export function swapPartyMember(g: GameState, storageTokenId: string, partyTokenId?: string): GameState {
  try {
    return { ...g, roster: swapToParty(g.roster, storageTokenId, partyTokenId) };
  } catch {
    return g;
  }
}

// ── The Dex (Wave 5) ─────────────────────────────────────────────────────────

export function openDex(g: GameState): GameState {
  return { ...g, screen: "dex" };
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

// ── TRADE (Ferro Vantt's trade post) ────────────────────────────────────────

// Rank tier index (F=0..S=6) times this multiplier, plus a flat base and a
// small per-generation/plus bonus — a simple, legible valuation good enough
// for a first trade-post pass (storage-only, never the last party member).
const TRADE_BASE = 12;
const TRADE_RANK_K = 14;
const TRADE_GEN_BONUS = 4;
const TRADE_PLUS_BONUS = 3;

/** Value a creature in gold for the trade post — base + rank tier * k + a
 *  small generation/plus bonus (a bred, leveled-up lineage is worth a bit more). */
export function creatureValue(c: Creature): number {
  const rankIdx = RANKS_ORDER.indexOf(c.rank);
  const tier = rankIdx < 0 ? 0 : rankIdx;
  return (
    TRADE_BASE +
    tier * TRADE_RANK_K +
    c.token.generation * TRADE_GEN_BONUS +
    c.token.plus * TRADE_PLUS_BONUS
  );
}
const RANKS_ORDER = ["F", "E", "D", "C", "B", "A", "S"] as const;

/** Enter the trade screen from the Questmaster's dialogue. */
export function openTrade(g: GameState): GameState {
  return { ...g, screen: "trade" };
}

/**
 * Trade in a STORAGE creature (never the party — a party member must be
 * swapped to storage first, which the trade screen doesn't offer) for gold at
 * `creatureValue`. A no-op (same state) if the token isn't in storage. Auto-saves,
 * same beat as a breed/battle-leave.
 */
export function tradeCreature(g: GameState, tokenId: string): GameState {
  const token = g.roster.storage.find((t) => t.id === tokenId);
  if (!token) return g;
  const value = creatureValue(creatureFromToken(token));
  const roster = release(g.roster, tokenId);
  const economy = addGold(g.economy, value);
  const next: GameState = { ...g, roster, economy };
  saveGame(next);
  return next;
}

// ── ALDERCRADLE (the world-tree — town center, the Heartseed progression) ──

/** Open the Aldercradle panel — reached by walking onto TOWN_TREE_TILE or
 *  pressing E while adjacent (mirrors Home/villager interactions). */
export function openAldercradle(g: GameState): GameState {
  return { ...g, screen: "aldercradle" };
}

/** Leave the Aldercradle panel back to the town. */
export function leaveAldercradle(g: GameState): GameState {
  return { ...g, screen: "town" };
}

/** How many of the 8 Heartseeds are recovered (0..8) — the tree's bloom stage. */
export function treeHealedCount(g: GameState): number {
  return healedCount(g.heartseeds);
}

/** True once all 8 Heartseeds are recovered — gates the Aldercradle panel's
 *  "The tree is whole" finale button. NOT reachable in normal play today
 *  (only 3/8 worlds are built — see worldtree.ts's note), but the gate itself
 *  is real: it flips the moment `heartseeds` actually holds all 8. */
export function treeIsWhole(g: GameState): boolean {
  return isTreeWhole(g.heartseeds);
}

/** Award a world's Heartseed directly (used by `stepBattle`'s Guardian-victory
 *  path above; also handy for the Architect to force-test the 8/8 finale from
 *  a console/devtools call — see the report for the exact snippet — WITHOUT
 *  a debug button ever shipping in the UI). */
export function awardWorldHeartseed(g: GameState, worldId: string): GameState {
  return { ...g, heartseeds: awardHeartseed(g.heartseeds, worldId) };
}

/** Open the finale — GUARDED so it only ever does anything at 8/8; called
 *  from the Aldercradle panel's "The tree is whole" button, which itself is
 *  only rendered at 8/8, so this is a belt-and-suspenders no-op otherwise. */
export function openFinale(g: GameState): GameState {
  if (!treeIsWhole(g)) return g;
  return { ...g, screen: "finale" };
}

/** Leave the finale back to the town (the endgame's own "what's next" screen
 *  is out of this slice's scope — see the report). */
export function leaveFinale(g: GameState): GameState {
  return { ...g, screen: "town" };
}
