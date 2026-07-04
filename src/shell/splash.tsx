/**
 * CHIMERA — the splash / title screen.
 *
 * The first thing on load: title CHIMERA, a wistful subtitle, and a Start
 * button. The backdrop is SplashScene — the Aldercradle Tree of Life with a
 * few goobers bouncing in front of it (see ../splash-scene.tsx) — so the
 * title reads as "the same warm world" rather than a separate splash canvas.
 *
 * On Start: unlock audio (resumeAudio, mirroring App's existing first-gesture
 * pattern), start a soft ambient pad, then hand off to the Sanctuary.
 *
 * TITLE MUSIC: a warm looping melody (see ../splash-audio.ts) plays under the
 * title. THE AUTOPLAY-POLICY BUG THIS FIXES: the AudioContext is SUSPENDED
 * until the first user gesture, so a mount-time `startAmbient`/melody call is
 * a silent no-op on a cold load — and the old onPointerDown here only called
 * `resumeAudio()`, unlocking the context but never (re)starting anything, so
 * the splash stayed silent even after tapping. Fix: start the melody on mount
 * (covers audio already being unlocked from a prior gesture this session,
 * e.g. returning to the title) AND again once `resumeAudio()` resolves on the
 * first pointer/gesture (covers the cold-load case) — guarded by a ref so the
 * gesture-triggered start only ever (re)arms once.
 */
import { useEffect, useRef, useState } from "react";
import { SplashScene } from "../splash-scene.js";
import { audio, resumeAudio } from "../audio.js";
import { startSplashMelody, stopSplashMelody } from "../splash-audio.js";

export interface SplashProps {
  /** Begin a fresh playthrough (→ the intro cutscene → the town). */
  onNewGame: () => void;
  /** Load the last save straight into the game — present only when a save exists. */
  onContinue?: () => void;
  /** Open the settings panel over the title screen. */
  onSettings: () => void;
}

export function Splash({ onNewGame, onContinue, onSettings }: SplashProps) {
  const [leaving, setLeaving] = useState(false);
  const committed = useRef(false);

  // Fade the splash IN on mount so the studio -> splash hand-off reads as a slow
  // dissolve (both fade over the shared parchment backdrop; see studio-logo.css),
  // not an abrupt cut. A tick after mount so the initial opacity:0 paints first.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setEntered(true), 30);
    return () => window.clearTimeout(id);
  }, []);

  // Splash gets its own soft ambient the moment audio unlocks, plus the title
  // melody (see ../splash-audio.ts). Torn down on unmount so neither bleeds
  // into the Sanctuary's own ambient (PartyScreen starts its own via
  // startAmbient there). This mount-time start is a no-op on a COLD load (the
  // AudioContext is still suspended pre-gesture — see file header) but does
  // cover returning to the title once audio is already unlocked this session.
  useEffect(() => {
    audio().startAmbient("splash-aldercradle");
    startSplashMelody();
    return () => {
      audio().stopAmbient();
      stopSplashMelody();
    };
  }, []);

  // First-gesture unlock + (re)arm: on a cold load the mount-time start above
  // was a no-op, so once resumeAudio() actually resolves the context, kick the
  // melody again here. startSplashMelody is idempotent (a module-level latch),
  // so this is safe to fire alongside the mount-time call with no double-start
  // / overlap. The armed ref just avoids re-awaiting resumeAudio() on every
  // subsequent tap once we've already done it once.
  const armedRef = useRef(false);
  const armAudio = () => {
    if (armedRef.current) return;
    armedRef.current = true;
    void resumeAudio().then(startSplashMelody);
  };

  // New Game / Continue both leave the splash with a soft fade; Settings opens
  // its panel over the title (handled by the caller) without leaving.
  const leaveWith = (action: () => void) => {
    if (committed.current) return;
    committed.current = true;
    audio().playUi("confirm");
    armAudio();
    setLeaving(true);
    window.setTimeout(action, 260);
  };

  return (
    <div
      className="splash-wrap"
      style={{ opacity: leaving ? 0 : entered ? 1 : 0, transition: `opacity ${leaving ? 240 : 800}ms ease` }}
      onPointerDown={armAudio}
    >
      <SplashScene />
      <div className="overlay splash-overlay">
        <div className="splash-titleblock">
          <div className="splash-title">CHIMERA</div>
          <div className="splash-subtitle">Aldercradle is fading. Weave it back to life.</div>
        </div>
        <div className="actionbar splash-actions">
          <button className="act primary" onClick={() => leaveWith(onNewGame)}>
            New Game →
          </button>
          {onContinue && (
            <button className="act bond" onClick={() => leaveWith(onContinue)}>
              Continue ↺
            </button>
          )}
          <button className="act" onClick={() => { audio().playUi("select"); onSettings(); }}>
            Settings ⚙
          </button>
        </div>
      </div>
    </div>
  );
}
