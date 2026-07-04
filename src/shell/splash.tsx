/**
 * CHIMERA — the splash / title screen.
 *
 * The first thing on load: title CHIMERA, a wistful subtitle, and a Start
 * button. A single cute goober idles on a soft parchment-sky backdrop via the
 * existing GooberStage (current props only — bg/ground/cameraPos/fov), so the
 * title reads as "the same warm world" rather than a separate splash canvas.
 *
 * On Start: unlock audio (resumeAudio, mirroring App's existing first-gesture
 * pattern), start a soft ambient pad, then hand off to the Sanctuary.
 */
import { useEffect, useRef, useState } from "react";
import { creatureFromToken, seedToken } from "game-kit/creature";
import { GooberStage, type Placed } from "../GooberStage.js";
import { audio, resumeAudio } from "../audio.js";

export interface SplashProps {
  onStart: () => void;
}

// A single warm, friendly starter goober idling on the splash — s16 matches
// PartyScreen's first STARTER_ID in game.ts (kept in sync by eye; if the
// starter roster changes there this purely-decorative pick can drift without
// breaking anything, since it never touches game state).
const SPLASH_TOKEN_ID = "s16";

export function Splash({ onStart }: SplashProps) {
  const [leaving, setLeaving] = useState(false);
  const committed = useRef(false);

  const placed: Placed[] = (() => {
    try {
      const spec = creatureFromToken(seedToken(SPLASH_TOKEN_ID)).gooberSpec;
      return [{ id: "splash", spec, position: [0, 2.2, 0], facing: 0, seed: 11 }];
    } catch {
      return [];
    }
  })();

  // Splash gets its own soft ambient the moment audio unlocks (first tap
  // anywhere on the splash), matching App's existing resumeAudio-on-gesture
  // pattern. Torn down on unmount so it never bleeds into the Sanctuary's own
  // ambient (PartyScreen starts its own via startAmbient there).
  useEffect(() => {
    audio().startAmbient("splash-aldercradle");
    return () => audio().stopAmbient();
  }, []);

  const handleStart = () => {
    if (committed.current) return;
    committed.current = true;
    audio().playUi("confirm");
    void resumeAudio();
    setLeaving(true);
    window.setTimeout(onStart, 260);
  };

  return (
    <div className={`splash-wrap ${leaving ? "leaving" : ""}`} onPointerDown={() => void resumeAudio()}>
      <GooberStage placed={placed} cameraPos={[0, 4.5, 13]} fov={26} bg="#f0dcb8" ground="#cfe6a8" />
      <div className="overlay splash-overlay">
        <div className="splash-titleblock">
          <div className="splash-title">CHIMERA</div>
          <div className="splash-subtitle">Aldercradle is fading. Weave it back to life.</div>
        </div>
        <div className="actionbar splash-actions">
          <button className="act primary" onClick={handleStart}>
            Start →
          </button>
        </div>
      </div>
    </div>
  );
}
