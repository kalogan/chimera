/**
 * CHIMERA — the splash / title-screen MELODY.
 *
 * The Director asked for "a simple melody track" on the title screen. CHIMERA's
 * tone is warm/wistful (DQM charm + Ghibli tenderness) — the opposite of a dark
 * drone — so this is a short, gentle, major-key motif that LOOPS softly under
 * the title, not a dense score. Built the same way GYRE's splash theme is built
 * (see gyre/src/shell/shell-audio.ts's `buildSplashTheme` for the technique this
 * mirrors): assemble one AudioRecipe's `events` across a short loop, then
 * re-fire that recipe on a `setInterval` cadence — playRecipe plays a finite
 * recipe once, looping is just re-scheduling.
 *
 * KEY / MOTIF: C major, pentatonic-flavoured (C D E G A) — CHIMERA's own warm
 * palette, the same pentatonic set `newbornChime` in spatial-audio/index.ts
 * uses for its "new life" bloom, so the splash's very first sound already
 * belongs to the game's harmonic world. A short 4-bar phrase: a rising call
 * (C4→E4→G4) answered by a settling response (A4→G4→E4→C4), plus a soft
 * sustained root+fifth pad underneath so the lead doesn't sit alone. Sparse —
 * long gaps between notes — because this plays under the title for as long as
 * the player lingers; a busy loop would wear thin fast.
 *
 * BUS / GAIN: routed through the shared "music" bus via `playMusicRecipe` (see
 * ../audio.ts) so it obeys the settings panel's Music slider exactly like the
 * ambient pad does — nothing here hardcodes a loud absolute level. The recipe's
 * own masterGain (0.5) plus per-note gains (0.08-0.22) keep it a quiet
 * background presence, not a foreground "track".
 *
 * ── THE AUTOPLAY-POLICY BUG THIS FIXES ──────────────────────────────────────
 * The AudioContext is SUSPENDED until the first user gesture, so nothing can
 * sound on first paint no matter what calls what. splash.tsx's mount-time
 * `startAmbient` call was therefore a silent no-op on a cold load, AND its
 * onPointerDown only called `resumeAudio()` — unlocking the context but never
 * (re)starting anything, so the splash stayed silent even after the tap. The
 * fix lives in splash.tsx: call `startSplashMelody()` on mount (covers the case
 * where audio is ALREADY unlocked, e.g. returning to the title from a prior
 * gesture this session) AND again after `resumeAudio()` resolves on the first
 * pointer/gesture (covers the cold-load case). Both call sites hit the same
 * idempotent latch below, so there's no double-start / overlap risk.
 */
import type { AudioEvent, AudioRecipe } from "game-kit/audio";
import { playMusicRecipe } from "./audio.js";

const SR = 44100;

// A gentle ~100 BPM feel — slow enough to read as "background", not a march.
const BEAT = 0.6; // seconds
const BAR = BEAT * 4; // 2.4s
const LOOP_BARS = 4;
/** One loop's length — re-fired on this cadence so the melody repeats forever. */
const LOOP_SEC = BAR * LOOP_BARS; // 9.6s

/** C-major pentatonic, the same warm palette `newbornChime` draws from. */
const HZ = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  C3: 130.81,
  G3: 196.0,
} as const;

const ev = (e: AudioEvent): AudioEvent => e;

/** Build one ~9.6s loop of the splash motif: a soft root+fifth pad under a
 *  short call-and-response pentatonic phrase. */
function buildSplashMelody(): AudioEvent[] {
  const events: AudioEvent[] = [];

  // ── Pad — a single sustained root+fifth (C3+G3), very quiet, held across the
  // whole loop so the melody has a warm floor instead of sitting in silence.
  events.push(ev({ type: "tone", wave: "sine", freq: HZ.C3, startSec: 0, durationSec: LOOP_SEC * 0.98, gain: 0.07 }));
  events.push(ev({ type: "tone", wave: "triangle", freq: HZ.G3, startSec: 0, durationSec: LOOP_SEC * 0.98, gain: 0.05 }));

  // ── Lead — a short call-and-response phrase, sparse (real space between
  // notes), one phrase per 2-bar half of the loop. [freq, startBeat, lengthBeats]
  const lead: [number, number, number][] = [
    // Call: rises gently.
    [HZ.C4, 0, 1.5],
    [HZ.E4, 2, 1.5],
    [HZ.G4, 4, 2.5],
    // Response: settles back down, resolving to the root an octave up so the
    // loop point lands somewhere warm rather than mid-phrase.
    [HZ.A4, 9, 1.5],
    [HZ.G4, 11, 1.5],
    [HZ.E4, 13, 1.5],
    [HZ.C4, 15, 2.8],
  ];
  for (const [freq, startBeat, lenBeats] of lead) {
    const startSec = startBeat * BEAT;
    const durationSec = lenBeats * BEAT * 0.9;
    // Warm triangle core, softened by a quieter sine an octave up so each note
    // blooms a little rather than snapping in — a gentle music-box read.
    events.push(ev({ type: "tone", wave: "triangle", freq, startSec, durationSec, gain: 0.2 }));
    events.push(
      ev({ type: "tone", wave: "sine", freq: freq * 2, startSec: startSec + 0.04, durationSec: durationSec * 0.8, gain: 0.06 }),
    );
  }

  // A single soft sparkle on the final held note (the "warm" in Ghibli-warm) —
  // an octave-up shimmer that fades before the loop restarts.
  events.push(ev({ type: "tone", wave: "sine", freq: HZ.C5 * 2, startSec: 16 * BEAT, durationSec: BEAT * 2, gain: 0.03 }));

  return events;
}

/** One full ~9.6s cycle of the splash melody (see buildSplashMelody). */
const SPLASH_MELODY: AudioRecipe = {
  sampleRate: SR,
  masterGain: 0.5,
  events: buildSplashMelody(),
};

let melodyInterval: number | undefined;
let melodyStarted = false;

/**
 * Start the splash melody looping. Idempotent + safe to call from multiple
 * gesture listeners racing each other, and safe to call while the AudioContext
 * is still suspended (playMusicRecipe/playRecipe no-op cleanly in that case —
 * see audio.ts / game-kit/audio's header) — it just won't be audible yet.
 *
 * HOW THE LOOP WORKS: fire the loop recipe immediately, then re-fire it every
 * LOOP_SEC via `setInterval` on the "music" bus. `stopSplashMelody` clears the
 * interval so no further loops schedule; already-scheduled notes ring out
 * naturally (a fade, not a cut).
 */
export function startSplashMelody(): void {
  if (melodyStarted) return;
  melodyStarted = true;
  const fire = () => playMusicRecipe(SPLASH_MELODY, 0.6);
  fire();
  melodyInterval = window.setInterval(fire, LOOP_SEC * 1000);
}

/**
 * Stop the splash melody. Cheap fade: rather than reaching into already-
 * scheduled envelopes, this just stops RE-ARMING new loops — the last bar's
 * notes decay via their own release ramp. Safe to call repeatedly / before
 * start (no-ops either way).
 */
export function stopSplashMelody(): void {
  if (melodyInterval !== undefined) {
    window.clearInterval(melodyInterval);
    melodyInterval = undefined;
  }
  melodyStarted = false;
}
