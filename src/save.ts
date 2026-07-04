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
 * and the unlocked-zones list. Explicitly EXCLUDED (transient, screen-local):
 * `screen`, `battle`, `wildToken`, `log`, `outcome`, `zone`,
 * `zoneReturnRoamerId`, `cradlePick`, `newborn`, `lastBreed`, `rivalBattleId`
 * — a load always resumes at the Sanctuary, never mid-battle or mid-zone.
 */
import type { RosterState } from "game-kit/roster";
import type { EconomyState } from "game-kit/economy";
import { createSaveStore } from "game-kit/save";
import type { PlacedRival } from "./rivals.js";

export interface SaveData {
  roster: RosterState;
  economy: EconomyState;
  rivals: PlacedRival[];
  encounterSeed: number;
  breedSeed: number;
  unlockedZones: string[];
}

const SAVE_KEY = "chimera.save";
// Bump when SaveData's shape changes incompatibly — an old save then loads as
// "no save" (never crashes on a stale shape) rather than partially applying.
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
}): void {
  try {
    const data: SaveData = {
      roster: g.roster,
      economy: g.economy,
      rivals: g.rivals,
      encounterSeed: g.encounterSeed,
      breedSeed: g.breedSeed,
      unlockedZones: g.unlockedZones,
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
    return data;
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
