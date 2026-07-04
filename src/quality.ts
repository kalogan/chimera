/**
 * Device-adaptive render quality. The goobers are MarchingCubes metaball meshes
 * (heavy) and the fixed camera renders at the phone's full DPR (2.5–3× → 4–9× the
 * pixels), which tanked frame rate on mobile (input felt laggy, the fresnel rim
 * speckled). This picks a tier once from `game-kit/perf`'s `detectDeviceTier`
 * (honours a `?tier=low|mid|high` override) and maps it to the three levers that
 * matter: DPR cap, MarchingCubes resolution, and whether to draw the rim shell.
 * Desktop stays full quality; phones downscale automatically.
 */
import { detectDeviceTier, type DeviceTier } from "game-kit/perf";

export const DEVICE_TIER: DeviceTier =
  typeof window === "undefined" ? "high" : detectDeviceTier();

export interface QualitySettings {
  /** Clamp devicePixelRatio — the single biggest mobile win. */
  dprCap: number;
  /** MarchingCubes field resolution per goober (48 was desktop-only). */
  gooberRes: number;
  /** The additive fresnel rim shell — an extra draw call per goober; the
   *  "glitchy shader" on mobile. Desktop only. */
  rim: boolean;
}

const TIER: Record<DeviceTier, QualitySettings> = {
  low: { dprCap: 1.25, gooberRes: 22, rim: false },
  mid: { dprCap: 1.5, gooberRes: 32, rim: false },
  high: { dprCap: 2, gooberRes: 46, rim: true },
};

export const QUALITY: QualitySettings = TIER[DEVICE_TIER];
