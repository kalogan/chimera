/**
 * save — CHIMERA's persisted-progress store (Wave 5). Wraps the kit's
 * versioned + checksummed `game-kit/save` module (see
 * `vendor/game-kit/src/save/index.ts`) rather than hand-rolling localStorage
 * reads, mirroring the shell's `settings-store.ts` pattern one layer down
 * (settings forward-merges over defaults; a save is an opaque, all-or-nothing
 * snapshot — a version/checksum mismatch is treated as "no save", never a
 * crash or a partially-applied state).
 *
 * `SaveData` is the PERSISTENT subset of `GameState`: roster (party/storage/
 * dex), economy, rivals (their full off-screen sim state — so a rival's
 * roster/dex/history survives a reload too), the encounter/breed rng seeds,
 * the unlocked-zones list, and (Aldercradle) `heartseeds` — the recovered
 * Heartseed record (world id -> true) that drives the world-tree's bloom
 * stage. Explicitly EXCLUDED (transient, screen-local): `screen`, `battle`,
 * `wildToken`, `log`, `outcome`, `zone`, `zoneReturnRoamerId`, `cradlePick`,
 * `newborn`, `lastBreed`, `rivalBattleId`, `guardianBattleWorldId` — a load
 * always resumes at the Town, never mid-battle or mid-zone.
 *
 * `heartseeds` is OPTIONAL on the wire (`heartseeds?:`) so an OLDER save blob
 * (persisted before this field existed) still passes `isSaveData` and loads
 * cleanly — `loadGame` below forward-fills a missing field to `{}` (no seeds)
 * rather than bumping `SAVE_VERSION` and discarding old saves wholesale; the
 * shape is purely additive, so there's nothing to migrate away from.
 */
import type { RosterState } from "game-kit/roster";
import type { EconomyState } from "game-kit/economy";
import { createSaveStore } from "game-kit/save";
import type { PlacedRival } from "./rivals.js";
import { createHeartseeds, type Heartseeds } from "./worldtree.js";

export interface SaveData {
  roster: RosterState;
  economy: EconomyState;
  rivals: PlacedRival[];
  encounterSeed: number;
  breedSeed: number;
  unlockedZones: string[];
  /** Optional so an older (pre-Aldercradle) save blob still validates. */
  heartseeds?: Heartseeds;
}

const SAVE_KEY = "chimera.save";
// Bump when SaveData's shape changes incompatibly — an old save then loads as
// "no save" (never crashes on a stale shape) rather than partially applying.
// `heartseeds` was added ADDITIVELY (optional field, forward-filled below) —
// no bump needed for it.
const SAVE_VERSION = 1;

const store = createSaveStore<SaveData>({ key: SAVE_KEY, version: SAVE_VERSION });

/** The minimal shape check a parsed save must pass before we trust it further. */
function isSaveData(data: unknown): data is SaveData {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<SaveData>;
  return (
    !!d.roster &&
    Array.isArray(d.roster.party) &&
    Array.isArray(d.roster.storage) &&
    !!d.economy &&
    typeof d.economy.gold === "number" &&
    Array.isArray(d.rivals) &&
    typeof d.encounterSeed === "number" &&
    typeof d.breedSeed === "number" &&
    Array.isArray(d.unlockedZones)
    // `heartseeds` is intentionally NOT required here — see the module note.
  );
}

/** Persist the PERSISTENT subset of a GameState. Best-effort — never throws. */
export function saveGame(g: {
  roster: RosterState;
  economy: EconomyState;
  rivals: PlacedRival[];
  encounterSeed: number;
  breedSeed: number;
  unlockedZones: string[];
  heartseeds: Heartseeds;
}): void {
  try {
    const data: SaveData = {
      roster: g.roster,
      economy: g.economy,
      rivals: g.rivals,
      encounterSeed: g.encounterSeed,
      breedSeed: g.breedSeed,
      unlockedZones: g.unlockedZones,
      heartseeds: g.heartseeds,
    };
    store.save(data);
  } catch {
    // Persisting is best-effort; a failed save should never break play.
  }
}

/**
 * Load the last save, or null if absent / corrupt / version-mismatched /
 * malformed. Never throws — a bad save is treated identically to no save.
 */
export function loadGame(): SaveData | null {
  try {
    const data = store.load();
    if (!isSaveData(data)) return null;
    // Forward-fill an older save's missing `heartseeds` to "no seeds yet"
    // rather than leaving it undefined for every downstream reader.
    return { ...data, heartseeds: data.heartseeds ?? createHeartseeds() };
  } catch {
    return null;
  }
}

/** Whether a save exists (syntactically) — drives the "Continue" affordance. */
export function hasSave(): boolean {
  try {
    return store.exists();
  } catch {
    return false;
  }
}

/** Remove any persisted save (used by "New Game" flows, if ever exposed). */
export function clearSave(): void {
  try {
    store.clear();
  } catch {
    // best-effort
  }
}
