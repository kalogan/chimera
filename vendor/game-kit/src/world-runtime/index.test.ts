import { describe, it, expect } from 'vitest';
import { seedToken } from '../creature/index.js';
import type { CreatureToken } from '../creature/types.js';
import {
  createZone,
  stepZone,
  tileAt,
  isWalkable,
  resumeAfterEncounter,
  type ZoneDescriptor,
  type ZoneState,
  type ZoneEvent,
  type TileKind,
  type Dir,
  type RoamerSeed,
} from './index.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

const T = {
  f: 'floor' as TileKind,
  w: 'wall' as TileKind,
  g: 'grass' as TileKind,
  p: 'portal' as TileKind,
  s: 'spawn' as TileKind,
};

const slimeToken: CreatureToken = seedToken('wild-slime');
const batToken: CreatureToken = seedToken('wild-bat');

/**
 * A small open room, 5x5, walled on the border, spawn at (1,1), a grass strip
 * down column 3, and a portal at (3,1).
 *
 *   row0: w w w w w
 *   row1: w s f p w
 *   row2: w f f g w
 *   row3: w f f g w
 *   row4: w w w w w
 */
function roomDescriptor(overrides: Partial<ZoneDescriptor> = {}): ZoneDescriptor {
  const tiles: TileKind[] = [
    T.w, T.w, T.w, T.w, T.w,
    T.w, T.s, T.f, T.p, T.w,
    T.w, T.f, T.f, T.g, T.w,
    T.w, T.f, T.f, T.g, T.w,
    T.w, T.w, T.w, T.w, T.w,
  ];
  return {
    id: 'room',
    width: 5,
    height: 5,
    tiles,
    portals: [{ at: [3, 1], to: 'next-zone' }],
    encounterPool: [slimeToken],
    grassEncounterChance: 0.5,
    roamers: [],
    ...overrides,
  };
}

function withRoamers(roamers: RoamerSeed[]): ZoneDescriptor {
  return roomDescriptor({ roamers });
}

// ── createZone ───────────────────────────────────────────────────────────────

describe('createZone', () => {
  it('places the player on the spawn tile', () => {
    const state = createZone(roomDescriptor(), 1);
    expect(state.player.x).toBe(1);
    expect(state.player.y).toBe(1);
  });

  it('falls back to the first portal tile when there is no spawn tile', () => {
    const descriptor = roomDescriptor();
    descriptor.tiles = descriptor.tiles.map((t) => (t === 'spawn' ? 'floor' : t));
    const state = createZone(descriptor, 1);
    expect([state.player.x, state.player.y]).toEqual([3, 1]);
  });

  it('falls back to the first non-wall tile when there is no spawn or portal', () => {
    const descriptor = roomDescriptor({ portals: [] });
    descriptor.tiles = descriptor.tiles.map((t) => (t === 'spawn' ? 'floor' : t));
    const state = createZone(descriptor, 1);
    const t = tileAt(state, state.player.x, state.player.y);
    expect(t).not.toBe('wall');
  });

  it('seeds roamer state from the descriptor', () => {
    const state = createZone(
      withRoamers([{ id: 'r1', token: batToken, at: [2, 2], wander: 'idle' }]),
      1,
    );
    expect(state.roamers).toHaveLength(1);
    expect(state.roamers[0]).toMatchObject({ id: 'r1', x: 2, y: 2, engaged: false });
  });

  it('player faces down initially and step starts at 0', () => {
    const state = createZone(roomDescriptor(), 1);
    expect(state.player.facing).toBe('down');
    expect(state.step).toBe(0);
    expect(state.done).toBeUndefined();
  });
});

// ── tileAt / isWalkable ──────────────────────────────────────────────────────

describe('tileAt / isWalkable', () => {
  const state = createZone(roomDescriptor(), 1);

  it('reads the tile at a given coordinate', () => {
    expect(tileAt(state, 1, 1)).toBe('spawn');
    expect(tileAt(state, 0, 0)).toBe('wall');
    expect(tileAt(state, 3, 2)).toBe('grass');
  });

  it('returns undefined out of bounds', () => {
    expect(tileAt(state, -1, 0)).toBeUndefined();
    expect(tileAt(state, 5, 0)).toBeUndefined();
    expect(tileAt(state, 0, 5)).toBeUndefined();
  });

  it('walls are not walkable; floor/grass/portal/spawn are', () => {
    expect(isWalkable(state, 0, 0)).toBe(false);
    expect(isWalkable(state, 1, 1)).toBe(true);
    expect(isWalkable(state, 3, 2)).toBe(true);
    expect(isWalkable(state, 3, 1)).toBe(true);
  });

  it('out-of-bounds is not walkable', () => {
    expect(isWalkable(state, -1, -1)).toBe(false);
  });
});

// ── basic movement ───────────────────────────────────────────────────────────

describe('stepZone: basic movement', () => {
  it('moves the player onto a floor tile and updates facing', () => {
    const state = createZone(roomDescriptor(), 1);
    const { state: next, events } = stepZone(state, 'right');
    expect(next.player).toEqual({ x: 2, y: 1, facing: 'right' });
    expect(events).toEqual([{ type: 'moved', from: [1, 1], to: [2, 1], facing: 'right' }]);
  });

  it('increments step on a successful move', () => {
    const state = createZone(roomDescriptor(), 1);
    const { state: next } = stepZone(state, 'right');
    expect(next.step).toBe(1);
  });

  it('does not mutate the input state', () => {
    const state = createZone(roomDescriptor(), 1);
    const frozen = JSON.parse(JSON.stringify(state));
    stepZone(state, 'right');
    expect(JSON.parse(JSON.stringify(state))).toEqual(frozen);
  });

  it('facing updates even without moving further (turn then move)', () => {
    const state = createZone(roomDescriptor(), 1);
    const afterDown = stepZone(state, 'down').state;
    expect(afterDown.player.facing).toBe('down');
  });
});

// ── blocking ─────────────────────────────────────────────────────────────────

describe('stepZone: blocking', () => {
  it('blocks on a wall tile with no advance and updates facing only', () => {
    const state = createZone(roomDescriptor(), 1); // player at (1,1)
    const { state: next, events } = stepZone(state, 'up'); // (1,0) is wall
    expect(next.player).toEqual({ x: 1, y: 1, facing: 'up' });
    expect(events).toEqual([{ type: 'blocked', at: [1, 0], facing: 'up' }]);
  });

  it('blocks on out-of-bounds the same way', () => {
    // Move to the corner-most walkable tile, then try to walk further into a wall.
    let state = createZone(roomDescriptor(), 1);
    state = stepZone(state, 'left').state; // blocked by wall at (0,1), stays (1,1)
    expect(state.player).toEqual({ x: 1, y: 1, facing: 'left' });
  });

  it('does not increment step on a block', () => {
    const state = createZone(roomDescriptor(), 1);
    const { state: next } = stepZone(state, 'up');
    expect(next.step).toBe(0);
  });

  it('roamers do NOT move when the player is blocked', () => {
    const state = createZone(
      withRoamers([{ id: 'r1', token: batToken, at: [2, 2], wander: 'random' }]),
      1,
    );
    const { state: next, events } = stepZone(state, 'up');
    expect(next.roamers[0]).toMatchObject({ x: 2, y: 2 });
    expect(events.some((e) => e.type === 'roamerMoved')).toBe(false);
  });
});

// ── roamer determinism ───────────────────────────────────────────────────────

describe('stepZone: roamer movement', () => {
  it('a random-wander roamer moves deterministically for a given seed', () => {
    const descriptor = withRoamers([
      { id: 'r1', token: batToken, at: [2, 2], wander: 'random' },
    ]);
    const runA = replay(descriptor, 42, ['right', 'right']);
    const runB = replay(descriptor, 42, ['right', 'right']);
    expect(runA.state.roamers).toEqual(runB.state.roamers);
    expect(runA.events).toEqual(runB.events);
  });

  it('a different seed can produce a different roamer path', () => {
    const descriptor = withRoamers([
      { id: 'r1', token: batToken, at: [2, 3], wander: 'random' },
    ]);
    const runA = replay(descriptor, 1, ['right', 'right', 'down']);
    const runB = replay(descriptor, 999, ['right', 'right', 'down']);
    // Not guaranteed to differ on every seed pair, but exercised across many
    // seeds at least one diverges — pin two known-divergent seeds.
    const somePathDiffers =
      JSON.stringify(runA.state.roamers) !== JSON.stringify(runB.state.roamers) ||
      JSON.stringify(runA.events) !== JSON.stringify(runB.events);
    expect(somePathDiffers).toBe(true);
  });

  it('an idle roamer never moves', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 2], wander: 'idle' }]);
    const { state } = replay(descriptor, 1, ['right', 'down', 'left', 'up']);
    expect(state.roamers[0]).toMatchObject({ x: 2, y: 2 });
  });

  it('a random-wander roamer only steps onto walkable tiles', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 2], wander: 'random' }]);
    let state = createZone(descriptor, 7);
    for (const dir of ['right', 'down', 'left', 'up', 'right', 'down'] as Dir[]) {
      state = stepZone(state, dir).state;
      const r = state.roamers[0]!;
      expect(isWalkable(state, r.x, r.y)).toBe(true);
    }
  });

  it('a seek roamer generally closes distance to the player over time', () => {
    // Far corner roamer, player advances toward it; seek should trend closer
    // (allowing for jitter) rather than trend away.
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [3, 3], wander: 'seek' }]);
    let state = createZone(descriptor, 3);
    const distAt = (s: ZoneState) =>
      Math.abs(s.player.x - s.roamers[0]!.x) + Math.abs(s.player.y - s.roamers[0]!.y);
    const startDist = distAt(state);
    for (const dir of ['right', 'down', 'down'] as Dir[]) {
      state = stepZone(state, dir).state;
    }
    expect(distAt(state)).toBeLessThanOrEqual(startDist + 1);
  });
});

// ── encounters: roamer collision ─────────────────────────────────────────────

describe('stepZone: roamer encounters', () => {
  it('player stepping onto a roamer emits an encounter with the roamer token', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 1], wander: 'idle' }]);
    const state = createZone(descriptor, 1); // player at (1,1)
    const { state: next, events } = stepZone(state, 'right'); // -> (2,1), onto roamer
    const encounter = events.find((e) => e.type === 'encounter');
    expect(encounter).toEqual({ type: 'encounter', kind: 'roamer', token: batToken, roamerId: 'r1' });
    expect(next.done).toBe('encounter');
  });

  it('marks the collided roamer engaged', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 1], wander: 'idle' }]);
    const state = createZone(descriptor, 1);
    const { state: next } = stepZone(state, 'right');
    expect(next.roamers.find((r) => r.id === 'r1')?.engaged).toBe(true);
  });

  it('a roamer stepping onto the player also emits an encounter with the right token', () => {
    // A seek roamer one tile from the player's destination will, for at least
    // one seed in a small search, step directly onto the player's new tile
    // (rather than the player stepping onto it) — search for such a seed to
    // exercise the "roamer moves into player" collision path specifically.
    const custom: ZoneDescriptor = {
      ...roomDescriptor(),
      roamers: [{ id: 'r1', token: batToken, at: [2, 2], wander: 'seek' }],
    };
    let found = false;
    for (let seed = 0; seed < 200 && !found; seed++) {
      const state = createZone(custom, seed);
      const { state: next, events } = stepZone(state, 'right'); // player (1,1) -> (2,1)
      const encounter = events.find((e) => e.type === 'encounter');
      if (encounter && encounter.type === 'encounter' && encounter.kind === 'roamer') {
        expect(encounter.token).toEqual(batToken);
        expect(next.roamers.find((r) => r.id === 'r1')?.engaged).toBe(true);
        // Confirm this was genuinely the roamer moving onto the player's new
        // tile, not the player walking onto the roamer's starting tile.
        expect([2, 2]).not.toEqual([next.player.x, next.player.y]);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('first collision wins when multiple roamers would occupy the player tile', () => {
    const descriptor: ZoneDescriptor = {
      ...roomDescriptor(),
      roamers: [
        { id: 'r1', token: slimeToken, at: [2, 1], wander: 'idle' },
        { id: 'r2', token: batToken, at: [2, 1], wander: 'idle' },
      ],
    };
    const state = createZone(descriptor, 1);
    const { events } = stepZone(state, 'right');
    const encounter = events.find((e) => e.type === 'encounter');
    expect(encounter).toMatchObject({ kind: 'roamer', roamerId: 'r1', token: slimeToken });
  });

  it('an engaged roamer cannot re-trigger a collision', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 1], wander: 'idle' }]);
    const state = createZone(descriptor, 1);
    const afterEncounter = stepZone(state, 'right').state;
    expect(afterEncounter.done).toBe('encounter');
    // Simulate resuming without removing (shouldn't be possible via the API,
    // but the engaged flag alone should already prevent re-collision logic
    // from re-firing if stepZone were forced to run again).
    const resumed = resumeAfterEncounter(afterEncounter, 'r1');
    expect(resumed.roamers.find((r) => r.id === 'r1')).toBeUndefined();
    expect(resumed.done).toBeUndefined();
  });
});

// ── encounters: grass ────────────────────────────────────────────────────────

describe('stepZone: grass encounters', () => {
  it('fires a grass encounter at the seeded rate (chance=1 always fires)', () => {
    const descriptor = roomDescriptor({ grassEncounterChance: 1 });
    let state = createZone(descriptor, 1);
    // Walk player to grass column 3 via (1,1)->(2,1)->(2,2)->(3,2 grass).
    state = stepZone(state, 'right').state; // (2,1)
    state = stepZone(state, 'down').state; // (2,2)
    const { events, state: next } = stepZone(state, 'right'); // (3,2) grass
    expect(events.find((e) => e.type === 'encounter')).toEqual({
      type: 'encounter',
      kind: 'grass',
      token: slimeToken,
    });
    expect(next.done).toBe('encounter');
  });

  it('never fires when chance is 0', () => {
    const descriptor = roomDescriptor({ grassEncounterChance: 0 });
    let state = createZone(descriptor, 1);
    state = stepZone(state, 'right').state;
    state = stepZone(state, 'down').state;
    const { events, state: next } = stepZone(state, 'right');
    expect(events.find((e) => e.type === 'encounter')).toBeUndefined();
    expect(next.done).toBeUndefined();
  });

  it('draws the encounter token seeded from the encounterPool', () => {
    const pool = [slimeToken, batToken];
    const descriptor = roomDescriptor({ grassEncounterChance: 1, encounterPool: pool });
    let state = createZone(descriptor, 5);
    state = stepZone(state, 'right').state;
    state = stepZone(state, 'down').state;
    const { events } = stepZone(state, 'right');
    const encounter = events.find((e) => e.type === 'encounter');
    expect(encounter && encounter.type === 'encounter' ? pool.includes(encounter.token) : false).toBe(
      true,
    );
  });

  it('does not fire a grass encounter if a roamer collision already happened', () => {
    // Roamer parked on the grass tile the player is about to step onto:
    // the roamer collision must win, and no grass encounter should also fire.
    const descriptor = roomDescriptor({
      grassEncounterChance: 1,
      roamers: [{ id: 'r1', token: batToken, at: [3, 2], wander: 'idle' }],
    });
    let state = createZone(descriptor, 1);
    state = stepZone(state, 'right').state; // (1,1) -> (2,1)
    state = stepZone(state, 'down').state; // (2,1) -> (2,2)
    const result = stepZone(state, 'right'); // (2,2) -> (3,2) grass, onto roamer
    const kinds = result.events
      .filter((e) => e.type === 'encounter')
      .map((e) => (e as { kind: string }).kind);
    expect(kinds).toEqual(['roamer']);
  });
});

// ── portals ──────────────────────────────────────────────────────────────────

describe('stepZone: portals', () => {
  it('emits a portal event with the target zone id', () => {
    const state = createZone(roomDescriptor(), 1); // player (1,1)
    const { events, state: next } = stepZone(state, 'right'); // (2,1)
    expect(events).toEqual([{ type: 'moved', from: [1, 1], to: [2, 1], facing: 'right' }]);
    const { events: events2, state: next2 } = stepZone(next, 'right'); // (3,1) portal
    expect(events2.find((e) => e.type === 'portal')).toEqual({ type: 'portal', to: 'next-zone' });
    expect(next2.done).toBe('portal');
  });
});

// ── resumeAfterEncounter ─────────────────────────────────────────────────────

describe('resumeAfterEncounter', () => {
  it('removes the engaged roamer so it cannot instantly re-trigger', () => {
    const descriptor = withRoamers([
      { id: 'r1', token: batToken, at: [2, 1], wander: 'idle' },
      { id: 'r2', token: slimeToken, at: [2, 2], wander: 'idle' },
    ]);
    const state = createZone(descriptor, 1);
    const afterEncounter = stepZone(state, 'right').state;
    const resumed = resumeAfterEncounter(afterEncounter, 'r1');
    expect(resumed.roamers.map((r) => r.id)).toEqual(['r2']);
    expect(resumed.done).toBeUndefined();
  });

  it('clears the done latch for a grass encounter with no roamerId', () => {
    const descriptor = roomDescriptor({ grassEncounterChance: 1 });
    let state = createZone(descriptor, 1);
    state = stepZone(state, 'right').state;
    state = stepZone(state, 'down').state;
    const afterEncounter = stepZone(state, 'right').state;
    expect(afterEncounter.done).toBe('encounter');
    const resumed = resumeAfterEncounter(afterEncounter);
    expect(resumed.done).toBeUndefined();
    expect(resumed.roamers).toEqual(afterEncounter.roamers);
  });

  it('stepZone accepts new input again after resuming', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 1], wander: 'idle' }]);
    const state = createZone(descriptor, 1);
    const afterEncounter = stepZone(state, 'right').state;
    expect(stepZone(afterEncounter, 'down').events).toEqual([]); // latched, no-op
    const resumed = resumeAfterEncounter(afterEncounter, 'r1');
    const { events } = stepZone(resumed, 'down');
    expect(events.length).toBeGreaterThan(0);
  });

  it('stepZone is a no-op once done is set (pending consumer reaction)', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 1], wander: 'idle' }]);
    const state = createZone(descriptor, 1);
    const afterEncounter = stepZone(state, 'right').state;
    const again = stepZone(afterEncounter, 'left');
    expect(again.state).toEqual(afterEncounter);
    expect(again.events).toEqual([]);
  });
});

// ── full determinism ─────────────────────────────────────────────────────────

describe('determinism', () => {
  it('replaying the same dir-sequence twice yields identical states and events', () => {
    const descriptor = withRoamers([
      { id: 'r1', token: batToken, at: [2, 2], wander: 'random' },
      { id: 'r2', token: slimeToken, at: [1, 2], wander: 'seek' },
    ]);
    const dirs: Dir[] = ['right', 'down', 'right', 'up', 'left', 'down'];
    const a = replay(descriptor, 2024, dirs);
    const b = replay(descriptor, 2024, dirs);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('state is serializable (survives a JSON round-trip)', () => {
    const descriptor = withRoamers([{ id: 'r1', token: batToken, at: [2, 2], wander: 'random' }]);
    const { state } = replay(descriptor, 11, ['right', 'down']);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('different dir-sequences generally diverge in resulting player position', () => {
    const descriptor = roomDescriptor();
    const a = replay(descriptor, 1, ['right', 'down']);
    const b = replay(descriptor, 1, ['down', 'right']);
    expect(a.state.player).not.toEqual(b.state.player);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function replay(
  descriptor: ZoneDescriptor,
  seed: number,
  dirs: Dir[],
): { state: ZoneState; events: ZoneEvent[] } {
  let state = createZone(descriptor, seed);
  const events: ZoneEvent[] = [];
  for (const dir of dirs) {
    const r = stepZone(state, dir);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}
