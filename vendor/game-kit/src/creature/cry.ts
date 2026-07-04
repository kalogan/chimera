/**
 * creature/cry — the SIGNATURE FEATURE: a unique procedural VOICE derived
 * deterministically from a creature's identity token, exactly like its goober
 * body. Family sets the timbre (waveform + brightness), size/rank set the pitch
 * register (small = high/chirpy, big = low/growly), and the token hash draws the
 * melodic contour. Same token → same voice; a bred creature (new token whose id
 * mixes both parents + whose family is a combination of theirs) gets a NEW voice
 * that plausibly blends its parents'. The anti-sameness thesis, in sound.
 *
 * PURE + THREE-FREE: no audio context here — this only DERIVES the spec. The
 * synthesis (crySpec → sound) lives in `spatial-audio` / `audio`, which turns
 * this into an AudioRecipe. Kept pure so determinism is unit-testable headless.
 */

import { createRng, hashStringToSeed } from '../prng/index.js';
import type { AudioWave } from '../audio/recipe.js';
import type { Family } from './types.js';

/**
 * A creature's voice, as data. `spatial-audio`/`audio` turns this into a short
 * AudioRecipe (one tone per contour note, following the intervals from baseHz).
 */
export interface CrySpec {
  /** Base timbre — from the creature's family. */
  wave: AudioWave;
  /** Register root in Hz — from size + rank (small/low-rank = higher). */
  baseHz: number;
  /** Melodic contour: semitone offsets from baseHz, in order. 3–5 notes. */
  intervals: number[];
  /** Per-note duration in seconds. */
  noteDur: number;
  /** 0..1 warble/character amount (adds a subtle detuned partial). */
  vibrato: number;
  /** 0..1 brightness — adds an octave harmonic so a voice reads brighter/darker. */
  brightness: number;
}

/** Family → base waveform + brightness bias. The felt "grain" of the voice. */
const FAMILY_VOICE: Record<Family, { wave: AudioWave; brightness: number }> = {
  beast: { wave: 'sawtooth', brightness: 0.35 },
  bird: { wave: 'triangle', brightness: 0.9 },
  dragon: { wave: 'sawtooth', brightness: 0.5 },
  slime: { wave: 'sine', brightness: 0.55 },
  aquatic: { wave: 'sine', brightness: 0.7 },
  nature: { wave: 'triangle', brightness: 0.6 },
  golem: { wave: 'square', brightness: 0.25 },
  spirit: { wave: 'triangle', brightness: 0.8 },
};

/** Rank → a small downward pitch nudge (higher rank feels a touch more imposing). */
function rankDrop(rankIdx: number): number {
  return rankIdx * 22; // Hz shaved per rank step (F=0 … S=6)
}

/**
 * Derive a creature's cry from its token id, family, size (0..1), and rank index.
 * Deterministic. baseHz: small creatures chirp high (~600Hz), big creatures growl
 * low (~150Hz); rank shaves a little more off the top.
 */
export function cryFromToken(
  id: string,
  family: Family,
  size: number,
  rankIdx: number,
): CrySpec {
  const rng = createRng(hashStringToSeed(`${id}:cry:${family}`));
  const voice = FAMILY_VOICE[family];

  const clampedSize = Math.max(0, Math.min(1, size));
  // small (size→0) = high; big (size→1) = low.
  let baseHz = 600 - clampedSize * 430 - rankDrop(rankIdx);
  // per-token jitter so two same-size same-family creatures still differ.
  baseHz += (rng.next() - 0.5) * 60;
  baseHz = Math.max(90, Math.min(660, baseHz));

  // Contour: 3–5 semitone offsets. First note always the root (0) so the voice
  // "lands" on its register, then a small melodic gesture.
  const noteCount = rng.range(3, 5);
  const palette = [-7, -5, -3, 0, 2, 3, 5, 7, 10, 12];
  const intervals: number[] = [0];
  for (let i = 1; i < noteCount; i++) {
    intervals.push(rng.pick(palette));
  }

  const noteDur = 0.08 + rng.next() * 0.09; // 80–170ms per note
  const vibrato = rng.next() * 0.6;
  const brightness = Math.max(0, Math.min(1, voice.brightness + (rng.next() - 0.5) * 0.3));

  return { wave: voice.wave, baseHz, intervals, noteDur, vibrato, brightness };
}
