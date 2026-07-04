/**
 * roster — the player's party, collection/storage, and Dex, as a pure
 * serializable reducer state over the save/meta idea.
 *
 * Stores CreatureTokens (the serializable genotype); express to a full Creature
 * on demand via `creatureFromToken`. Every function is PURE — it returns a NEW
 * RosterState and never mutates its input (structural sharing is fine). No three,
 * no Math.random, no Date.now: the same inputs always yield a deep-equal state,
 * and the whole state JSON round-trips.
 *
 * Invariants held by every returned state:
 *   - party.length <= maxParty
 *   - a token id is never in both party and storage
 *   - ids are unique across party ∪ storage
 */

import type { CreatureToken, Family } from '../creature/index.js';

/** Discovery/ownership state for a species/token in the Dex. */
export type DexStatus = 'seen' | 'scouted' | 'bred' | 'owned';

/** Precedence: a higher rank never downgrades. bred trumps owned trumps scouted trumps seen. */
const STATUS_RANK: Record<DexStatus, number> = {
  seen: 0,
  scouted: 1,
  owned: 2,
  bred: 3,
};

/**
 * One Dex record, keyed by token id. Tracks discovery + lineage. `firstSeenGen`
 * is the token generation at first discovery; `parents` is present only for
 * tokens that have a lineage (i.e. were bred).
 */
export interface DexEntry {
  id: string;
  family: Family;
  status: DexStatus;
  firstSeenGen: number;
  parents?: readonly [string, string];
}

/** The whole roster: active party, ranch/box storage, and the Dex. Serializable. */
export interface RosterState {
  /** Active party — always length <= maxParty. */
  party: CreatureToken[];
  /** The ranch/box: every owned token not currently in the party. */
  storage: CreatureToken[];
  /** Dex records keyed by token id. */
  dex: Record<string, DexEntry>;
  /** Party cap (default 3). */
  maxParty: number;
}

/** Options for `addCreature`. */
export interface AddOptions {
  /** Force the token into storage even if the party has room. */
  toStorage?: boolean;
}

const DEFAULT_MAX_PARTY = 3;

// ── internal helpers (pure) ──────────────────────────────────────────────────

function hasId(state: RosterState, id: string): boolean {
  return state.party.some((t) => t.id === id) || state.storage.some((t) => t.id === id);
}

/**
 * Return a dex clone with `token` recorded at `target` status (never downgrading).
 * Creates the entry on first sight; preserves the original `firstSeenGen`.
 */
function recordDex(
  dex: Record<string, DexEntry>,
  token: CreatureToken,
  target: DexStatus,
): Record<string, DexEntry> {
  const existing = dex[token.id];
  const status: DexStatus =
    existing && STATUS_RANK[existing.status] >= STATUS_RANK[target] ? existing.status : target;

  const entry: DexEntry = {
    id: token.id,
    family: token.family,
    status,
    firstSeenGen: existing ? existing.firstSeenGen : token.generation,
  };
  // Only attach parents when the token has a lineage — keeps the state JSON-clean
  // (no `undefined` keys) so it round-trips deep-equal.
  const parents = token.parents ?? existing?.parents;
  if (parents) entry.parents = parents;

  return { ...dex, [token.id]: entry };
}

/** The Dex status a physical acquisition implies: bred if the token has parents, else owned. */
function acquiredStatus(token: CreatureToken): DexStatus {
  return token.parents ? 'bred' : 'owned';
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Create a fresh roster. Any `starters` are acquired (party first, overflow to
 * storage) and recorded in the Dex as owned (or bred if they carry parents).
 */
export function createRoster(starters: CreatureToken[] = [], maxParty = DEFAULT_MAX_PARTY): RosterState {
  let state: RosterState = { party: [], storage: [], dex: {}, maxParty };
  for (const token of starters) {
    state = addCreature(state, token);
  }
  return state;
}

/**
 * Acquire a token — a scout success or a newborn. It joins the party if there is
 * room (unless `opts.toStorage`), else storage; the Dex is upgraded to owned (or
 * bred if the token has parents). A duplicate id is never physically added twice,
 * but its Dex record is still upgraded.
 */
export function addCreature(state: RosterState, token: CreatureToken, opts?: AddOptions): RosterState {
  const dex = recordDex(state.dex, token, acquiredStatus(token));

  if (hasId(state, token.id)) {
    // Already collected — only the Dex may change.
    return { ...state, dex };
  }

  const toParty = !opts?.toStorage && state.party.length < state.maxParty;
  if (toParty) {
    return { ...state, party: [...state.party, token], dex };
  }
  return { ...state, storage: [...state.storage, token], dex };
}

/**
 * Record an encounter — reveals a species in the Dex as 'seen' if not already
 * higher. Does not add the token to the party or storage.
 */
export function markSeen(state: RosterState, token: CreatureToken): RosterState {
  return { ...state, dex: recordDex(state.dex, token, 'seen') };
}

/**
 * Record a scout target — reveals a species in the Dex as 'scouted' if not
 * already higher. Does not add the token to the party or storage.
 */
export function markScouted(state: RosterState, token: CreatureToken): RosterState {
  return { ...state, dex: recordDex(state.dex, token, 'scouted') };
}

/**
 * Choose the active party by token id, in order. Every id must already be owned
 * (in party or storage) and unique; the result must fit `maxParty`. All other
 * owned tokens fall back to storage. Throws on any invariant violation.
 */
export function setParty(state: RosterState, tokenIds: readonly string[]): RosterState {
  if (tokenIds.length > state.maxParty) {
    throw new RangeError(`setParty: ${tokenIds.length} ids exceeds maxParty (${state.maxParty})`);
  }
  const seen = new Set<string>();
  for (const id of tokenIds) {
    if (seen.has(id)) throw new Error(`setParty: duplicate id "${id}"`);
    seen.add(id);
  }

  const all = [...state.party, ...state.storage];
  const byId = new Map(all.map((t) => [t.id, t]));

  const party: CreatureToken[] = [];
  for (const id of tokenIds) {
    const token = byId.get(id);
    if (!token) throw new Error(`setParty: id "${id}" is not in the roster`);
    party.push(token);
  }
  const storage = all.filter((t) => !seen.has(t.id));
  return { ...state, party, storage };
}

/**
 * Move a storage token into the party. If the party is full you must name a
 * `partyTokenId` to send back to storage (a swap); otherwise the storage token
 * fills an open slot. Throws if either id is missing or the party is full with no
 * swap target.
 */
export function swapToParty(
  state: RosterState,
  storageTokenId: string,
  partyTokenId?: string,
): RosterState {
  const incoming = state.storage.find((t) => t.id === storageTokenId);
  if (!incoming) throw new Error(`swapToParty: "${storageTokenId}" is not in storage`);

  if (partyTokenId !== undefined) {
    const slot = state.party.findIndex((t) => t.id === partyTokenId);
    if (slot < 0) throw new Error(`swapToParty: "${partyTokenId}" is not in the party`);
    const outgoing = state.party[slot]!;
    const party = state.party.map((t, i) => (i === slot ? incoming : t));
    const storage = state.storage.map((t) => (t.id === storageTokenId ? outgoing : t));
    return { ...state, party, storage };
  }

  if (state.party.length >= state.maxParty) {
    throw new Error('swapToParty: party is full — supply a partyTokenId to swap out');
  }
  return {
    ...state,
    party: [...state.party, incoming],
    storage: state.storage.filter((t) => t.id !== storageTokenId),
  };
}

/**
 * Release a token from storage (send it away). The Dex record is retained. To
 * release an active party member, swap it to storage first — releasing a token
 * that is still in the party throws.
 */
export function release(state: RosterState, tokenId: string): RosterState {
  if (state.party.some((t) => t.id === tokenId)) {
    throw new Error(`release: "${tokenId}" is in the party — swap it to storage first`);
  }
  if (!state.storage.some((t) => t.id === tokenId)) {
    return state;
  }
  return { ...state, storage: state.storage.filter((t) => t.id !== tokenId) };
}

/** Count Dex entries, optionally filtered by status. */
export function dexCount(state: RosterState, status?: DexStatus): number {
  const entries = Object.values(state.dex);
  if (status === undefined) return entries.length;
  return entries.filter((e) => e.status === status).length;
}

/**
 * Walk a token's lineage through the Dex. Returns ancestor token ids in
 * depth-first order (both parents, then their parents, …), de-duplicated and
 * cycle-safe. Ancestors with no Dex record still appear (by id) but are not
 * walked further.
 */
export function lineageOf(state: RosterState, tokenId: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([tokenId]);

  const walk = (id: string): void => {
    const entry = state.dex[id];
    if (!entry || !entry.parents) return;
    for (const parentId of entry.parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      out.push(parentId);
      walk(parentId);
    }
  };

  walk(tokenId);
  return out;
}
