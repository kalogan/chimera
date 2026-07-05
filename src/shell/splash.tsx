/**
 * CHIMERA — the splash / title screen.
 *
 * A thin CHIMERA adapter over the shared kit `<TitleScreen>` (game-kit/title/r3f):
 * the kit owns the layout, the fade-in / select-fade-out flow, and the first-
 * gesture hook; this file supplies the BRAND — title, subtitle, the SplashScene
 * backdrop (the Aldercradle tree + bouncing goobers), the menu options, and the
 * title MUSIC lifecycle.
 *
 * TITLE MUSIC + AUTOPLAY: the AudioContext is suspended until the first user
 * gesture, so the mount-time `startAmbient`/melody is a silent no-op on a cold
 * load (but covers returning to the title once audio is unlocked this session);
 * `onFirstGesture` re-arms the melody once `resumeAudio()` resolves. Torn down on
 * unmount so neither bleeds into the town's own ambient.
 */
import { useEffect, useRef } from "react";
import { TitleScreen } from "game-kit/title/r3f";
import { type MenuOption } from "game-kit/title";
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
  // Soft ambient + title melody the moment audio is available, torn down on leave.
  useEffect(() => {
    audio().startAmbient("splash-aldercradle");
    startSplashMelody();
    return () => {
      audio().stopAmbient();
      stopSplashMelody();
    };
  }, []);

  // First gesture on a cold load: unlock the context, then (re)arm the melody
  // (idempotent latch inside). Guarded so we only await resumeAudio() once.
  const armedRef = useRef(false);
  const armAudio = () => {
    if (armedRef.current) return;
    armedRef.current = true;
    void resumeAudio().then(startSplashMelody);
  };

  const options: MenuOption[] = [
    { label: "New Game →", primary: true, onSelect: onNewGame },
    ...(onContinue ? [{ label: "Continue ↺", onSelect: onContinue } as MenuOption] : []),
    // Settings opens a panel OVER the title (caller-owned) — non-leaving.
    { label: "Settings ⚙", leaves: false, onSelect: () => { audio().playUi("select"); onSettings(); } },
  ];

  return (
    <TitleScreen
      backdrop={<SplashScene />}
      title="CHIMERA"
      subtitle="Aldercradle is fading. Weave it back to life."
      options={options}
      onFirstGesture={armAudio}
      // A soft confirm only for the leaving options (New Game / Continue);
      // Settings plays its own "select" tick.
      onSelect={(opt) => { if (opt.leaves !== false) audio().playUi("confirm"); }}
    />
  );
}
