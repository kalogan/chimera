/**
 * CHIMERA — the settings panel.
 *
 * Master/Music/SFX/Cries volume + a reduced-motion toggle. Reads/writes through
 * the game-kit settings store (shell/settings-store.ts) and LIVE-APPLIES every
 * change straight onto the shared SpatialAudio rig's buses via `audio().setBusVolume`
 * — no extra plumbing, since `audio()` is a module-level singleton (src/audio.ts).
 *
 * Reachable from both the splash and the pause overlay — a self-contained panel,
 * not a full-screen shell itself. Matches the warm/parchment HUD chrome in
 * styles.css (.panel/.act) so it reads as one UI with the rest of the game.
 */
import { useEffect } from "react";
import { audio } from "../audio.js";
import { useSettings } from "./settings-store.js";

export interface SettingsPanelProps {
  /** Back out of the panel (Esc, ✕, or the Back button). */
  onClose: () => void;
}

const BUSES = [
  { key: "masterVolume", bus: "master", label: "Master" },
  { key: "musicVolume", bus: "music", label: "Music" },
  { key: "sfxVolume", bus: "sfx", label: "SFX" },
  { key: "criesVolume", bus: "cries", label: "Cries" },
] as const;

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useSettings();

  // Live-apply every bus volume onto the shared audio rig — including on first
  // mount, so opening Settings re-asserts the persisted levels immediately.
  useEffect(() => {
    for (const { key, bus } of BUSES) {
      audio().setBusVolume(bus, settings[key]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.masterVolume, settings.musicVolume, settings.sfxVolume, settings.criesVolume]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="panel settings-panel">
      <div className="settings-head">
        <h2>Settings</h2>
        <button className="act close" onClick={() => { audio().playUi("back"); onClose(); }} title="back (Esc)">
          ✕
        </button>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">Volume</div>
          {BUSES.map(({ key, label }) => (
            <Slider
              key={key}
              label={label}
              value={settings[key]}
              onChange={(v) => setSettings({ [key]: v } as Partial<typeof settings>)}
            />
          ))}
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Accessibility</div>
          <Toggle
            label="Reduced motion"
            checked={settings.reducedMotion}
            onChange={(v) => setSettings({ reducedMotion: v })}
          />
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="settings-slider"
      />
      <span className="settings-row-value">{Math.round(value * 100)}</span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`settings-toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-toggle-thumb" />
      </button>
      <span className="settings-row-value">{checked ? "On" : "Off"}</span>
    </label>
  );
}
