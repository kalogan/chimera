/**
 * quest — the town questgiver's objective/progress/reward system, as a pure
 * serializable reducer state.
 *
 * PURE, THREE-FREE, DOM-FREE. Every function returns a NEW QuestState and
 * never mutates its input (structural sharing is fine). No three, no DOM, no
 * Math.random, no Date.now: the same inputs always yield a deep-equal state,
 * and the whole state JSON round-trips.
 *
 * Quest does NOT know about creatures, economy, or the roster. Objectives
 * reference ABSTRACT targets (a family string, a zone id, a rival id, a
 * count) and rewards are an ABSTRACT descriptor ({gold?, itemId?,
 * unlockZone?}) — `claimReward` hands that descriptor back to the caller,
 * which applies it against `economy`/`roster`/whatever the game uses. This
 * keeps the module a pure leaf with no upstream dependencies.
 *
 * The game feeds `recordEvent` a `QuestEvent` whenever something quest-worthy
 * happens (a scout, a birth, a zone entry, a Dex tally, a rival defeat); every
 * ACTIVE quest whose objective matches that event advances, and any that
 * reach their target move into `completed` in the same call.
 *
 * Invariants held by every returned state:
 *   - a quest id is never in both `active` and `completed`
 *   - `active[id].progress` is always >= 0 and never exceeds the objective's target
 *   - `completed` holds each id at most once (claiming/completing is idempotent)
 */

import type { Family } from '../creature/index.js';

// ── objectives / rewards / defs ──────────────────────────────────────────────

/**
 * The kinds of objective a quest can carry. A small, legible, extensible set —
 * add a new kind here, plus a `target`/`matches` case below, when a genuinely
 * new quest shape is needed.
 */
export type QuestObjective =
  | { kind: 'scout-family'; family: Family; count: number }
  | { kind: 'scout-any'; count: number }
  | { kind: 'reach-zone'; zone: string }
  | { kind: 'breed'; count: number }
  | { kind: 'breed-family'; family: Family; count: number }
  | { kind: 'dex'; count: number }
  | { kind: 'defeat-rival'; rivalId: string };

/**
 * What a quest grants on completion — data only. Quest never interprets this;
 * it only carries it back to the caller from `claimReward`. The game applies
 * `gold`/`itemId`+`itemCount` via `economy` and `unlockZone` via its own map
 * state.
 */
export interface QuestReward {
  gold?: number;
  itemId?: string;
  itemCount?: number;
  unlockZone?: string;
}

/** One quest definition in the catalog. */
export interface QuestDef {
  id: string;
  title: string;
  /** The npc id who offers this quest, if any. */
  giver?: string;
  description: string;
  objective: QuestObjective;
  reward: QuestReward;
  /** A quest id that must be completed before this one is offerable. */
  prereq?: string;
}

/**
 * A small sample catalog an inspector/game can start from. Games are free to
 * supply their own `QuestDef[]` to every function below — nothing here is
 * hard-wired into the reducers.
 */
export const SAMPLE_QUESTS: readonly QuestDef[] = [
  {
    id: 'q-scout-beasts',
    title: 'Beastly Business',
    giver: 'ranger-orin',
    description: 'Scout 3 beast-family creatures for the ranch.',
    objective: { kind: 'scout-family', family: 'beast', count: 3 },
    reward: { gold: 100 },
  },
  {
    id: 'q-reach-old-mill',
    title: 'The Old Mill',
    giver: 'elder-mara',
    description: 'Find your way to the Old Mill.',
    objective: { kind: 'reach-zone', zone: 'old-mill' },
    reward: { gold: 50, itemId: 'healing-herb', itemCount: 3 },
  },
  {
    id: 'q-first-breed',
    title: 'A New Generation',
    giver: 'breeder-tam',
    description: 'Breed your first creature.',
    objective: { kind: 'breed', count: 1 },
    reward: { itemId: 'dragon-catalyst', itemCount: 1 },
    prereq: 'q-scout-beasts',
  },
  {
    id: 'q-grow-the-dex',
    title: 'Compendium',
    giver: 'elder-mara',
    description: 'Discover 10 species for the Dex.',
    objective: { kind: 'dex', count: 10 },
    reward: { unlockZone: 'sunken-archive' },
    prereq: 'q-reach-old-mill',
  },
];

// ── events ────────────────────────────────────────────────────────────────────

/**
 * Something that happened in the game, fed to `recordEvent`. Quest never
 * emits these — the game does, in response to a scout, a birth, a zone entry,
 * a Dex tally, or a rival defeat.
 */
export type QuestEvent =
  | { type: 'scouted'; family: Family }
  | { type: 'bred'; family: Family }
  | { type: 'enteredZone'; zone: string }
  | { type: 'dexCount'; total: number }
  | { type: 'defeatedRival'; rivalId: string };

// ── state ─────────────────────────────────────────────────────────────────────

/** Progress on one active quest. */
export interface QuestProgress {
  progress: number;
}

/** The whole quest log: active quests with progress, and completed quest ids. Serializable. */
export interface QuestState {
  /** questId -> progress. A quest present here is active but not yet completed. */
  active: Record<string, QuestProgress>;
  /** Quest ids that have reached their target (each appears at most once). */
  completed: string[];
}

/** Create a fresh, empty quest log. */
export function createQuestLog(): QuestState {
  return { active: {}, completed: [] };
}

// ── internal helpers (pure) ───────────────────────────────────────────────────

/** The numeric target an objective is measured against. */
function targetOf(objective: QuestObjective): number {
  switch (objective.kind) {
    case 'scout-family':
    case 'scout-any':
    case 'breed':
    case 'breed-family':
    case 'dex':
      return objective.count;
    case 'reach-zone':
    case 'defeat-rival':
      return 1;
  }
}

/**
 * Whether `event` advances `objective`, and by how much progress toward the
 * target it represents. `dexCount`/`reach-zone`/`defeat-rival` set progress to
 * an absolute value (they carry their own totals or are one-shot); the
 * scout/breed events are additive (`+1` per matching occurrence).
 */
function matchDelta(
  objective: QuestObjective,
  event: QuestEvent,
): { matches: true; nextProgress: (prev: number) => number } | { matches: false } {
  switch (objective.kind) {
    case 'scout-family':
      if (event.type === 'scouted' && event.family === objective.family) {
        return { matches: true, nextProgress: (p) => p + 1 };
      }
      return { matches: false };
    case 'scout-any':
      if (event.type === 'scouted') {
        return { matches: true, nextProgress: (p) => p + 1 };
      }
      return { matches: false };
    case 'reach-zone':
      if (event.type === 'enteredZone' && event.zone === objective.zone) {
        return { matches: true, nextProgress: () => 1 };
      }
      return { matches: false };
    case 'breed':
      if (event.type === 'bred') {
        return { matches: true, nextProgress: (p) => p + 1 };
      }
      return { matches: false };
    case 'breed-family':
      if (event.type === 'bred' && event.family === objective.family) {
        return { matches: true, nextProgress: (p) => p + 1 };
      }
      return { matches: false };
    case 'dex':
      if (event.type === 'dexCount') {
        return { matches: true, nextProgress: (p) => Math.max(p, event.total) };
      }
      return { matches: false };
    case 'defeat-rival':
      if (event.type === 'defeatedRival' && event.rivalId === objective.rivalId) {
        return { matches: true, nextProgress: () => 1 };
      }
      return { matches: false };
  }
}

function findDef(defs: readonly QuestDef[], id: string): QuestDef | undefined {
  return defs.find((d) => d.id === id);
}

// ── pure reducers ─────────────────────────────────────────────────────────────

/**
 * The defs a player could currently start: not already active, not already
 * completed, and (if the def names a `prereq`) that prereq is completed.
 * Order follows `defs`.
 */
export function offerable(defs: readonly QuestDef[], state: QuestState): QuestDef[] {
  const completed = new Set(state.completed);
  return defs.filter((d) => {
    if (d.id in state.active) return false;
    if (completed.has(d.id)) return false;
    if (d.prereq && !completed.has(d.prereq)) return false;
    return true;
  });
}

/**
 * Accept a quest by id, starting it at zero progress. A no-op (returns the
 * SAME state) if the id is already active or already completed.
 */
export function acceptQuest(state: QuestState, id: string): QuestState {
  if (id in state.active || state.completed.includes(id)) return state;
  return { ...state, active: { ...state.active, [id]: { progress: 0 } } };
}

/**
 * Abandon an active quest, dropping its progress entirely. A no-op (returns
 * the SAME state) if the id is not active.
 */
export function abandonQuest(state: QuestState, id: string): QuestState {
  if (!(id in state.active)) return state;
  const active = { ...state.active };
  delete active[id];
  return { ...state, active };
}

/**
 * Fold one game event into every active quest, advancing progress on every
 * def whose objective matches and moving any that reach their target into
 * `completed`. Returns the new state plus the ids that newly completed this
 * call (so the caller knows which rewards to grant) — empty if none did.
 */
export function recordEvent(
  defs: readonly QuestDef[],
  state: QuestState,
  event: QuestEvent,
): { state: QuestState; completed: string[] } {
  let active = state.active;
  let completed = state.completed;
  const newlyCompleted: string[] = [];
  let changed = false;

  for (const [id, prog] of Object.entries(state.active)) {
    const def = findDef(defs, id);
    if (!def) continue;

    const delta = matchDelta(def.objective, event);
    if (!delta.matches) continue;

    const target = targetOf(def.objective);
    const nextProgress = Math.min(target, delta.nextProgress(prog.progress));
    if (nextProgress === prog.progress) continue;

    if (!changed) {
      active = { ...state.active };
      completed = state.completed;
      changed = true;
    }

    if (nextProgress >= target) {
      delete active[id];
      completed = [...completed, id];
      newlyCompleted.push(id);
    } else {
      active[id] = { progress: nextProgress };
    }
  }

  if (!changed) return { state, completed: [] };
  return { state: { active, completed }, completed: newlyCompleted };
}

/** Whether a quest def has reached completion in `state`. */
export function isComplete(def: QuestDef, state: QuestState): boolean {
  return state.completed.includes(def.id);
}

/** The current progress toward a def's objective target, for UI display. */
export function progressOf(def: QuestDef, state: QuestState): { done: number; target: number } {
  const target = targetOf(def.objective);
  if (isComplete(def, state)) return { done: target, target };
  const prog = state.active[def.id];
  return { done: prog ? prog.progress : 0, target };
}

/**
 * Read the reward for a completed quest, for the caller to apply (gold/item
 * via economy, unlockZone via the game's own map state — quest never touches
 * either). Guards double-claim implicitly: `completed` only ever holds an id
 * once, so calling this repeatedly for the same def just re-reads the same
 * (idempotent) reward data without granting anything extra on quest's side —
 * it is the CALLER's responsibility not to apply the same reward twice; pass
 * only ids fresh out of `recordEvent`'s `completed` list to avoid that.
 */
export function claimReward(def: QuestDef): QuestReward {
  return { ...def.reward };
}
