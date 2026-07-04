/**
 * CHIMERA — the shell's persisted settings.
 *
 * Uses the game-kit `createSettingsStore` (localStorage-backed, schema-versioned,
 * forward-merge over defaults) rather than hand-rolled localStorage reads.
 *
 * Consumers subscribe via `useSettings()` (a thin React hook over the store's
 * subscribe/get) so any panel writing a patch re-renders every reader live —
 * this is how the settings panel's sliders apply to the running game (audio
 * bus volumes, reduced motion) without a page reload.
 */
import { useEffect, useState } from "react";
import { createSettingsStore, type SettingsStore } from "game-kit/settings";

export interface ChimeraSettings {
  /** Bus volumes, 0..1 — mirrored onto the shared SpatialAudio rig's buses. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  criesVolume: number;
  /** Trims/removes ambient motion (drifting splash backdrop, etc). */
  reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: ChimeraSettings = {
  masterVolume: 1,
  musicVolume: 0.8,
  sfxVolume: 0.8,
  criesVolume: 0.9,
  reducedMotion: false,
};

const SETTINGS_KEY = "chimera.settings";
const SETTINGS_VERSION = 1;

export const settingsStore: SettingsStore<ChimeraSettings> = createSettingsStore<ChimeraSettings>({
  key: SETTINGS_KEY,
  defaults: DEFAULT_SETTINGS,
  version: SETTINGS_VERSION,
});

/** Live-subscribed settings + a patch setter. Re-renders on ANY change (own or elsewhere). */
export function useSettings(): [ChimeraSettings, (patch: Partial<ChimeraSettings>) => void] {
  const [state, setState] = useState<ChimeraSettings>(() => settingsStore.get());
  useEffect(() => settingsStore.subscribe(setState), []);
  return [state, (patch) => settingsStore.set(patch)];
}
