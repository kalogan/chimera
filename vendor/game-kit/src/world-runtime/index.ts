/**
 * world-runtime — the PURE, deterministic walkable-zone runtime for CHIMERA's
 * top-down 2.5D overworld (grid / step-based movement, visible roamers).
 *
 * THREE-FREE / DOM-FREE: no `three` import, no DOM access, no `Math.random()`,
 * no `Date.now()`. All randomness flows through a seeded `Rng` (see
 * `../prng/index.js`) derived from the zone `rngSeed` + the current `step`
 * cursor, so the same seed + the same dir-sequence always reproduces an
 * identical `ZoneState` AND an identical `ZoneEvent[]` stream.
 *
 * The event stream is THE LOAD-BEARING SEAM — same rule as `board.resolve()`
 * and `battle.step()`: the render/audio layers CONSUME the stream to animate
 * hops, bump roamers, and trigger encounters; they never re-derive movement.
 *
 *   - `createZone` places the player on the `spawn` tile (falling back to a
 *     portal tile, then the first floor-ish tile) and seeds roamer state.
 *   - `stepZone` resolves ONE player move: face the direction, block on a
 *     wall/out-of-bounds (free — no roamer tick), else advance the player and
 *     tick every roamer once, then resolve collision → grass encounter →
 *     portal, in that priority order. Returns a NEW state and the full
 *     ordered event stream (never mutates the input).
 *
 * A roamer engaged in an encounter is "consumed": `resumeAfterEncounter`
 * removes it so re-entering the zone after a battle can't instantly re-trigger
 * the same fight.
 */

import type { CreatureToken } from '../creature/types.js';
import { createRng, type Rng } from '../prng/index.js';

// ── tiles ────────────────────────────────────────────────────────────────────

export type TileKind = 'floor' | 'wall' | 'grass' | 'portal' | 'spawn';

/** Facing direction — also the only legal step directions. */
export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** [x, y] delta for a single step in `dir`. */
function delta(dir: Dir): [number, number] {
  switch (dir) {
    case 'up':
      return [0, -1];
    case 'down':
      return [0, 1];
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
  }
}

// ── descriptor ───────────────────────────────────────────────────────────────

export interface ZonePortal {
  at: [number, number];
  to: string;
}

export type Wander = 'idle' | 'random' | 'seek';

export interface RoamerSeed {
  id: string;
  token: CreatureToken;
  at: [number, number];
  wander: Wander;
}

export interface ZoneDescriptor {
  id: string;
  width: number;
  height: number;
  /** Row-major, length === width*height. */
  tiles: TileKind[];
  portals: ZonePortal[];
  /** Creature tokens drawn from (seeded) for a grass encounter. */
  encounterPool: CreatureToken[];
  /** 0..1 chance a `grass` tile entry triggers an encounter. */
  grassEncounterChance: number;
  roamers: RoamerSeed[];
}

// ── state ────────────────────────────────────────────────────────────────────

export interface PlayerState {
  x: number;
  y: number;
  facing: Dir;
}

export interface RoamerState {
  id: string;
  token: CreatureToken;
  x: number;
  y: number;
  wander: Wander;
  /** true once this roamer has triggered an encounter and been consumed. */
  engaged: boolean;
}

export interface ZoneState {
  descriptor: ZoneDescriptor;
  player: PlayerState;
  roamers: RoamerState[];
  /** Count of successful player moves — also the rng cursor. */
  step: number;
  rngSeed: number;
  /** Set once an encounter or portal transition is pending the consumer's reaction. */
  done?: 'encounter' | 'portal';
}

// ── events ───────────────────────────────────────────────────────────────────

export type ZoneEvent =
  | { type: 'moved'; from: [number, number]; to: [number, number]; facing: Dir }
  | { type: 'blocked'; at: [number, number]; facing: Dir }
  | { type: 'roamerMoved'; id: string; from: [number, number]; to: [number, number] }
  | {
      type: 'encounter';
      kind: 'roamer' | 'grass';
      token: CreatureToken;
      roamerId?: string;
    }
  | { type: 'portal'; to: string };

// ── lookups ──────────────────────────────────────────────────────────────────

function indexOf(state: Pick<ZoneState, 'descriptor'>, x: number, y: number): number {
  return y * state.descriptor.width + x;
}

function inBounds(state: Pick<ZoneState, 'descriptor'>, x: number, y: number): boolean {
  return x >= 0 && x < state.descriptor.width && y >= 0 && y < state.descriptor.height;
}

/** Tile at (x, y), or `undefined` when out of bounds. */
export function tileAt(state: ZoneState, x: number, y: number): TileKind | undefined {
  if (!inBounds(state, x, y)) return undefined;
  return state.descriptor.tiles[indexOf(state, x, y)];
}

/** True iff (x, y) is in-bounds and not a `wall` tile. */
export function isWalkable(state: ZoneState, x: number, y: number): boolean {
  const t = tileAt(state, x, y);
  return t !== undefined && t !== 'wall';
}

function findFirstTileOfKind(descriptor: ZoneDescriptor, kind: TileKind): [number, number] | null {
  const idx = descriptor.tiles.indexOf(kind);
  if (idx < 0) return null;
  return [idx % descriptor.width, Math.floor(idx / descriptor.width)];
}

// ── setup ────────────────────────────────────────────────────────────────────

/**
 * Create a fresh zone. The player starts on the `spawn` tile; if none exists,
 * falls back to the first portal's tile, then the first non-wall tile, then
 * (0, 0) as a last resort so a malformed descriptor still produces a state
 * rather than throwing. Roamers are placed verbatim from the descriptor seed.
 */
export function createZone(descriptor: ZoneDescriptor, seed: number): ZoneState {
  const spawn =
    findFirstTileOfKind(descriptor, 'spawn') ??
    (descriptor.portals[0]?.at ?? null) ??
    findFirstNonWall(descriptor) ??
    [0, 0];

  const roamers: RoamerState[] = descriptor.roamers.map((r) => ({
    id: r.id,
    token: r.token,
    x: r.at[0],
    y: r.at[1],
    wander: r.wander,
    engaged: false,
  }));

  return {
    descriptor,
    player: { x: spawn[0], y: spawn[1], facing: 'down' },
    roamers,
    step: 0,
    rngSeed: seed >>> 0,
    done: undefined,
  };
}

function findFirstNonWall(descriptor: ZoneDescriptor): [number, number] | null {
  const idx = descriptor.tiles.findIndex((t) => t !== 'wall');
  if (idx < 0) return null;
  return [idx % descriptor.width, Math.floor(idx / descriptor.width)];
}

// ── roamer stepping ──────────────────────────────────────────────────────────

/** Candidate dirs (of the 4) that lead to a walkable tile from (x, y). */
function walkableDirs(state: ZoneState, x: number, y: number): Dir[] {
  return DIRS.filter((d) => {
    const [dx, dy] = delta(d);
    return isWalkable(state, x + dx, y + dy);
  });
}

/**
 * Pick ONE step for a roamer, seeded, per its wander policy. Returns the same
 * (x, y) when it has nowhere to go (or policy is `idle`).
 */
function roamerStepTarget(
  state: ZoneState,
  roamer: RoamerState,
  rng: Rng,
): [number, number] {
  if (roamer.wander === 'idle') return [roamer.x, roamer.y];

  const candidates = walkableDirs(state, roamer.x, roamer.y);
  if (candidates.length === 0) return [roamer.x, roamer.y];

  if (roamer.wander === 'random') {
    const dir = rng.pick(candidates);
    const [dx, dy] = delta(dir);
    return [roamer.x + dx, roamer.y + dy];
  }

  // 'seek': bias toward the player, seeded-jittered by occasionally taking a
  // random walkable dir instead of the greedy best one.
  const SEEK_JITTER = 0.25;
  if (rng.next() < SEEK_JITTER) {
    const dir = rng.pick(candidates);
    const [dx, dy] = delta(dir);
    return [roamer.x + dx, roamer.y + dy];
  }
  let best = candidates[0]!;
  let bestDist = Infinity;
  for (const d of candidates) {
    const [dx, dy] = delta(d);
    const nx = roamer.x + dx;
    const ny = roamer.y + dy;
    const dist = Math.abs(nx - state.player.x) + Math.abs(ny - state.player.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  const [dx, dy] = delta(best);
  return [roamer.x + dx, roamer.y + dy];
}

// ── the reducer ──────────────────────────────────────────────────────────────

/**
 * Resolve one player move in `dir`. PURE: returns a NEW state and the full
 * ordered event stream; the input `state` is never mutated.
 *
 * Order: face dir -> wall/OOB blocks (free, no roamer tick) -> else advance
 * player + tick every active roamer once (seeded) -> collision (player tile
 * === any roamer tile, first match wins) -> else grass roll -> else portal.
 */
export function stepZone(state: ZoneState, dir: Dir): { state: ZoneState; events: ZoneEvent[] } {
  const events: ZoneEvent[] = [];

  if (state.done) {
    return { state, events };
  }

  const [dx, dy] = delta(dir);
  const targetX = state.player.x + dx;
  const targetY = state.player.y + dy;
  const from: [number, number] = [state.player.x, state.player.y];

  if (!isWalkable(state, targetX, targetY)) {
    events.push({ type: 'blocked', at: [targetX, targetY], facing: dir });
    const next: ZoneState = {
      ...state,
      player: { ...state.player, facing: dir },
    };
    return { state: next, events };
  }

  const nextStep = state.step + 1;
  const rng = createRng(state.rngSeed).fork(nextStep);

  events.push({ type: 'moved', from, to: [targetX, targetY], facing: dir });

  const movedRoamers: RoamerState[] = state.roamers.map((r) => {
    if (r.engaged) return r;
    const [nx, ny] = roamerStepTarget(state, r, rng);
    if (nx !== r.x || ny !== r.y) {
      events.push({ type: 'roamerMoved', id: r.id, from: [r.x, r.y], to: [nx, ny] });
    }
    return { ...r, x: nx, y: ny };
  });

  const nextPlayer: PlayerState = { x: targetX, y: targetY, facing: dir };

  // Collision: player tile === any (non-engaged) roamer tile. First match
  // (by roamer array order) wins.
  const collided = movedRoamers.find(
    (r) => !r.engaged && r.x === nextPlayer.x && r.y === nextPlayer.y,
  );

  let done: ZoneState['done'];
  let finalRoamers = movedRoamers;

  if (collided) {
    events.push({
      type: 'encounter',
      kind: 'roamer',
      token: collided.token,
      roamerId: collided.id,
    });
    finalRoamers = movedRoamers.map((r) => (r.id === collided.id ? { ...r, engaged: true } : r));
    done = 'encounter';
  } else {
    const destTile = tileAt(state, targetX, targetY);
    if (destTile === 'grass' && state.descriptor.encounterPool.length > 0) {
      const roll = rng.next();
      if (roll < state.descriptor.grassEncounterChance) {
        const token = rng.pick(state.descriptor.encounterPool);
        events.push({ type: 'encounter', kind: 'grass', token });
        done = 'encounter';
      }
    }
    if (!done && destTile === 'portal') {
      const portal = state.descriptor.portals.find(
        (p) => p.at[0] === targetX && p.at[1] === targetY,
      );
      if (portal) {
        events.push({ type: 'portal', to: portal.to });
        done = 'portal';
      }
    }
  }

  const next: ZoneState = {
    ...state,
    player: nextPlayer,
    roamers: finalRoamers,
    step: nextStep,
    done,
  };

  return { state: next, events };
}

/**
 * Re-enter the zone after a battle: the engaged roamer that triggered the
 * encounter is removed entirely (never re-added), and the `done` latch is
 * cleared so `stepZone` accepts input again. A grass-triggered encounter (no
 * `roamerId`) simply clears the latch — there's no roamer to consume.
 */
export function resumeAfterEncounter(state: ZoneState, roamerId?: string): ZoneState {
  const roamers = roamerId ? state.roamers.filter((r) => r.id !== roamerId) : state.roamers;
  return { ...state, roamers, done: undefined };
}
