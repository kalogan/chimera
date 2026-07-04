/**
 * CHIMERA — the pause overlay.
 *
 * Esc (or the touch ⏸ button) opens this over party/zone/battle: Resume ·
 * Settings · Return to Title. The caller (App.tsx) owns WHEN this is mounted —
 * it stops the zone's movement loop while paused (see App.tsx's `paused` gate
 * around ZoneScreen's key/step handling) so pausing never fights the overworld
 * input.
 */
import { useEffect, useState } from "react";
import { audio } from "../audio.js";
import { SettingsPanel } from "./settings.js";

export interface PauseOverlayProps {
  onResume: () => void;
  onReturnToTitle: () => void;
}

export function PauseOverlay({ onResume, onReturnToTitle }: PauseOverlayProps) {
  const [showSettings, setShowSettings] = useState(false);

  // Esc: close Settings if open (back to the pause menu), else Resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      if (showSettings) {
        setShowSettings(false);
      } else {
        audio().playUi("back");
        onResume();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [showSettings, onResume]);

  return (
    <div className="overlay pause-dock">
      {showSettings ? (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      ) : (
        <div className="panel pause-panel">
          <h2>Paused</h2>
          <div className="pause-menu">
            <button className="act primary" onClick={() => { audio().playUi("confirm"); onResume(); }}>
              Resume
            </button>
            <button className="act" onClick={() => { audio().playUi("select"); setShowSettings(true); }}>
              Settings
            </button>
            <button className="act" onClick={() => { audio().playUi("back"); onReturnToTitle(); }}>
              Return to Title
            </button>
          </div>
          <div className="hint">Esc — resume</div>
        </div>
      )}
    </div>
  );
}
