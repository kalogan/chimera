/**
 * Device-adaptive render quality, overridable from Settings.
 *
 * The goobers are MarchingCubes metaball meshes (heavy) rendered at the phone's
 * full DPR (2.5–3× → 4–9× the pixels), which tanked mobile frame rate (input felt
 * laggy, the fresnel rim speckled). The tier resolves from the persisted Settings
 * `qualityTier` — 'auto' falls back to `game-kit/perf`'s `detectDeviceTier`
 * (which also honours a `?tier=low|mid|high` URL override). It maps to the three
 * levers that matter: DPR cap, MarchingCubes resolution, and the rim shell.
 * A change applies when a scene next mounts (canvases/goobers re-read on mount).
 */
import { detectDeviceTier, type DeviceTier } from "game-kit/perf";
import { settingsStore } from "./shell/settings-store.js";

export interface QualitySettings {
  /** Clamp devicePixelRatio — the single biggest mobile win. */
  dprCap: number;
  /** MarchingCubes field resolution per goober (48 was desktop-only). */
  gooberRes: number;
  /** The additive fresnel rim shell — an extra draw call per goober; the
   *  "glitchy shader" on mobile. High tier only. */
  rim: boolean;
}

const TIER: Record<DeviceTier, QualitySettings> = {
  low: { dprCap: 1.25, gooberRes: 22, rim: false },
  mid: { dprCap: 1.5, gooberRes: 32, rim: false },
  high: { dprCap: 2, gooberRes: 46, rim: true },
};

function resolveTier(): DeviceTier {
  const pref = settingsStore.get().qualityTier;
  if (pref === "low" || pref === "mid" || pref === "high") return pref;
  return typeof window === "undefined" ? "high" : detectDeviceTier();
}

// Cache the resolved snapshot; invalidate whenever Settings change so a new
// scene mount picks up the change without re-reading the store every frame.
let _quality: QualitySettings | null = null;
let _reducedMotion = false;
let _tier: DeviceTier | null = null;

function refresh(): void {
  _tier = resolveTier();
  _quality = TIER[_tier];
  _reducedMotion = settingsStore.get().reducedMotion;
}
if (typeof window !== "undefined") {
  settingsStore.subscribe(() => {
    _quality = null;
  });
}

export function getQuality(): QualitySettings {
  if (!_quality) refresh();
  return _quality!;
}

/** The resolved tier (for a Settings readout like "Auto → mid"). */
export function activeDeviceTier(): DeviceTier {
  if (!_quality) refresh();
  return _tier!;
}

/** Reduced-motion accessibility flag — gates the goober idle bob + splash drift. */
export function getReducedMotion(): boolean {
  if (!_quality) refresh();
  return _reducedMotion;
}
