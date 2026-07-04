/**
 * CHIMERA — "The Fading": the intro cutscene component.
 *
 * SELF-CONTAINED seam: `<IntroScene onDone={..} onSkip={..} />` reads no game
 * state, renders full-screen (position:fixed inset:0), and calls `onDone()`
 * exactly once when the sequence finishes OR the player taps Skip. Plays
 * AFTER the splash, BEFORE the player lands in town — see this file's own
 * header for what it owns vs. what the Architect wires around it.
 *
 * VISUAL TECHNIQUE: pure DOM/CSS + a single lightweight <canvas> for the
 * drifting motes, NOT react-three-fiber. Reasoning: this plays for ~8.5s
 * before the player has done anything else in the app — an R3F Canvas here
 * would spin up a whole WebGL context (shader compiles, GPU init) just to
 * show a gradient and some captions, competing with the splash's own
 * GooberStage for warm-up time on a phone. A 2D canvas + CSS gradient is
 * instant, costs nothing on low-end devices, and reads exactly as well full-
 * screen on mobile. `getReducedMotion()` (read-only import) tones the mote
 * drift down to a gentle fade when set.
 *
 * DRIVE: steps `createCutscenePlayer(INTRO_SEQUENCE)` on a rAF loop with real
 * dt (not useFrame — there's no Canvas driving frames here), exactly mirroring
 * the pattern school-eclipse.tsx documents (step every tick, forward
 * ramps/events, call onDone once `frame.done`). `caption` events become
 * fading DOM text overlays; a `sting` event plays a soft guarded chime via
 * the project's SpatialAudio rig. Skip calls the player's `skipAll()` (fires
 * remaining events in authored order per the core's contract, though nothing
 * meaningfully depends on that here) then finishes immediately.
 */
import { useEffect, useRef, useState } from "react";
import { createCutscenePlayer, type CutscenePlayer } from "game-kit/cutscene";
import type { AudioRecipe } from "game-kit/audio";
import { INTRO_SEQUENCE } from "./intro-cutscene.js";
import { audio } from "./audio.js";
import { getReducedMotion } from "./quality.js";
import "./intro.css";

export interface IntroSceneProps {
  onDone: () => void;
  onSkip?: () => void;
}

// A soft rising chime for the "one spark remains" beat — short, subtle
// (masterGain well under 1), mirrors the shape of GYRE's eclipse stings.
// Guarded at the call site: audio() never throws even pre-unlock.
const SPARK_STING: AudioRecipe = {
  sampleRate: 44100,
  masterGain: 0.32,
  events: [
    { type: "tone", wave: "sine", freq: 660, startSec: 0, durationSec: 1.1, gain: 0.22 },
    { type: "tone", wave: "sine", freq: 990, startSec: 0.15, durationSec: 1.3, gain: 0.14 },
  ],
};

export function IntroScene({ onDone, onSkip }: IntroSceneProps) {
  const [caption, setCaption] = useState<string>("");
  const [captionVisible, setCaptionVisible] = useState(false);
  const [glow, setGlow] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<CutscenePlayer | null>(null);
  const doneRef = useRef(false);
  const captionTimerRef = useRef<number | null>(null);

  if (!playerRef.current) playerRef.current = createCutscenePlayer(INTRO_SEQUENCE);

  const finish = (viaSkip: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (viaSkip) onSkip?.();
    onDone();
  };

  // rAF drive loop — real dt, no game state read. Steps the pure cutscene
  // core, forwards ramps -> `glow` state, events -> captions/stings, and
  // finishes once the frame reports done.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const reduced = getReducedMotion();

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const player = playerRef.current;
      if (!player) return;

      const frame = player.step(dt);
      const g = frame.ramps.glow;
      if (typeof g === "number") setGlow(reduced ? Math.min(1, g * 0.6 + 0.2) : g);

      for (const ev of frame.events) {
        if (ev.name === "caption" && typeof ev.data === "string") {
          setCaption(ev.data);
          setCaptionVisible(true);
          if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
          captionTimerRef.current = window.setTimeout(() => setCaptionVisible(false), 2000);
        } else if (ev.name === "sting" && ev.data === "spark") {
          try {
            audio().playAt(SPARK_STING);
          } catch {
            // guarded — never blocks the cutscene on audio
          }
        }
      }

      if (frame.done) {
        finish(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drifting motes — a handful of soft circles rising slowly, drawn on a
  // small 2D canvas. Cheap: no WebGL, no shaders, scales with devicePixelRatio
  // but capped so it never taxes a low-end phone. Skips entirely (static single
  // frame) under reduced motion.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = getReducedMotion();

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const MOTE_COUNT = 14;
    const motes = Array.from({ length: MOTE_COUNT }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.4 + Math.random() * 2.6,
      speed: 0.015 + Math.random() * 0.02,
      phase: (i / MOTE_COUNT) * Math.PI * 2,
    }));

    let raf = 0;
    let t = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        const y = ((m.y - t * m.speed) % 1 + 1) % 1;
        const x = m.x + Math.sin(t * 0.6 + m.phase) * 0.02;
        const twinkle = 0.5 + 0.5 * Math.sin(t * 1.7 + m.phase);
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 244, 214, ${(0.25 + 0.45 * twinkle).toFixed(3)})`;
        ctx.arc(x * w, y * h, m.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced) t += 0.016;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handleSkip = () => {
    try {
      audio().playUi("back");
    } catch {
      // guarded
    }
    playerRef.current?.skipAll();
    finish(true);
  };

  return (
    <div
      className="intro-wrap"
      style={{ ["--glow" as string]: glow.toFixed(3) }}
      onPointerDown={(e) => {
        // Tapping anywhere also serves as an early audio-unlock gesture,
        // mirroring Splash's onPointerDown — never required, just convenient.
        void e;
      }}
    >
      <canvas ref={canvasRef} className="intro-motes" />
      <div className="intro-caption-wrap">
        <div className={`intro-caption ${captionVisible ? "visible" : ""}`}>{caption}</div>
      </div>
      <button
        type="button"
        className="intro-skip"
        onClick={handleSkip}
        aria-label="Skip intro"
      >
        Skip ›
      </button>
    </div>
  );
}
