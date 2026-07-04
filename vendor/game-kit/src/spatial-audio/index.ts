/**
 * spatial-audio — the SOUND layer for CHIMERA. Every sound is PROCEDURAL SYNTH:
 * zero audio files, zero samples, zero paid generation. Sounds are described as
 * portable {@link AudioRecipe}s (the same shape the `audio` module plays live or
 * bakes to WAV) and produced from PARAMETERS alone.
 *
 * Two halves:
 *   1. PURE recipe factories (the deterministic heart, unit-tested headless) —
 *      same input → same AudioRecipe. The signature is {@link cryToRecipe}: a
 *      creature's {@link CrySpec} → its VOICE. Around it sit the emotional
 *      "moments" of a monster-collector (breeding reveal, impact, faint, scout,
 *      level-up, UI ticks, a per-zone ambient pad) — all warm/tender/wistful
 *      (DQM charm + Ghibli tenderness, cute never harsh).
 *   2. A thin runtime wrapper ({@link createSpatialAudio}) over the `audio`
 *      module's AudioManager that routes each recipe through the right bus and
 *      adds a positional cue (stereo pan + distance attenuation). It is a clean
 *      NO-OP with no AudioContext (node / SSR / headless) and NEVER throws.
 *
 * THREE-FREE / DOM-OPTIONAL: the factories never touch a DOM API and never use
 * Math.random / Date.now (variation comes from the seeded `prng`), so they're
 * fully deterministic. Only the runtime wrapper touches Web-Audio, and only when
 * a context actually exists.
 */

import type { AudioManager, Channel } from '../audio/index.js';
import type { AudioEvent, AudioRecipe, AudioWave } from '../audio/recipe.js';
import type { CrySpec, Element } from '../creature/index.js';
import { createRng, hashStringToSeed, type Rng } from '../prng/index.js';

// ── shared constants + tiny helpers ─────────────────────────────────────────────

/** Standard sample rate for every recipe (matches the `audio` module's presets). */
const SR = 44100;

/** Clamp into [0, 1]; NaN → 0 (same semantics as the audio module's clamp01). */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Semitone offset → frequency ratio (equal temperament). */
function semi(offset: number): number {
  return Math.pow(2, offset / 12);
}

/** A tone event with sensible defaults — keeps the factories terse + readable. */
function tone(
  freq: number,
  startSec: number,
  durationSec: number,
  gain: number,
  wave: AudioWave = 'sine',
): AudioEvent {
  return { type: 'tone', freq, startSec, durationSec, gain, wave };
}

/** A noise burst event. */
function noise(startSec: number, durationSec: number, gain: number): AudioEvent {
  return { type: 'noise', startSec, durationSec, gain };
}

// ── THE SIGNATURE: a creature's cry → its voice ─────────────────────────────────

/**
 * PURE: turn a creature's {@link CrySpec} into its VOICE as an {@link AudioRecipe}.
 *
 * One tone per contour interval, sequential (`startSec = i * noteDur`), each at
 * `baseHz * 2^(semitone/12)` in the family waveform. Two characterful layers, both
 * derived deterministically from the spec:
 *   - `brightness` adds a quieter octave-up sine partial per note (a voice reads
 *     brighter/airier the higher it is);
 *   - `vibrato` adds a soft, slightly-detuned partial per note (a gentle warble/
 *     chorus — warm, never a harsh beat).
 *
 * Envelopes are short + gentle (the shared renderer's click-free attack/release).
 * Deterministic: same CrySpec → deep-equal recipe. Never silent (every note
 * carries the fundamental at audible gain).
 */
export function cryToRecipe(cry: CrySpec): AudioRecipe {
  const dur = Math.max(0.03, cry.noteDur);
  const noteBody = dur * 0.92; // small gap between notes so they read as separate
  const bright = clamp01(cry.brightness);
  const vib = clamp01(cry.vibrato);
  const events: AudioEvent[] = [];

  const intervals = cry.intervals.length > 0 ? cry.intervals : [0];
  intervals.forEach((offset, i) => {
    const freq = cry.baseHz * semi(offset);
    const startSec = i * dur;
    // Fundamental — always present so the voice is never silent.
    events.push(tone(freq, startSec, noteBody, 0.55, cry.wave));
    // Brightness: a quieter octave-up sine sparkle.
    if (bright > 0.01) {
      events.push(tone(freq * 2, startSec, noteBody, 0.1 + bright * 0.18, 'sine'));
    }
    // Vibrato: a soft detuned twin — gentle chorus/warble, not a harsh beat.
    if (vib > 0.01) {
      events.push(tone(freq * semi(vib * 0.18), startSec, noteBody, 0.09 + vib * 0.13, cry.wave));
    }
  });

  return { sampleRate: SR, masterGain: 0.85, events };
}

// ── moment factories (PURE + deterministic, warm/tender/wistful) ─────────────────

/**
 * PURE: the CRADLE / breeding reveal — a warm, magical "new life" chime. A soft
 * ascending major-pentatonic arpeggio (sine + a touch of triangle warmth) that
 * blooms gently. This is the emotional PEAK of the loop. If given the newborn's
 * cry, it LEADS INTO that first cry (the chime resolves, then the creature speaks
 * for the first time) — the reveal and the voice fused into one cue.
 */
export function newbornChime(cry?: CrySpec): AudioRecipe {
  // C-major pentatonic bloom (C5 D5 E5 G5 A5 C6) — pure, tender, hopeful.
  const roots = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  const step = 0.13;
  const events: AudioEvent[] = [];
  roots.forEach((freq, i) => {
    const startSec = i * step;
    // Notes overlap + swell slightly (a chime rings, it doesn't tick).
    events.push(tone(freq, startSec, 0.5, 0.32, 'sine'));
    events.push(tone(freq, startSec, 0.5, 0.12, 'triangle')); // warmth
  });
  // A soft shimmer partial on the final note (the "magic" tail).
  const tail = roots.length * step;
  events.push(tone(1046.5 * 2, (roots.length - 1) * step, 0.6, 0.06, 'sine'));

  if (cry) {
    // Lead INTO the first cry: append the voice just after the chime settles.
    const voice = cryToRecipe(cry);
    const lead = tail + 0.12;
    for (const e of voice.events) {
      events.push({ ...e, startSec: e.startSec + lead });
    }
  }

  return { sampleRate: SR, masterGain: 0.8, events };
}

/** Per-element timbre flavour for combat cues. Warm-leaning, never abrasive. */
const ELEMENT_FLAVOR: Record<Element, { wave: AudioWave; tone: number; noise: number }> = {
  fire: { wave: 'sawtooth', tone: 1.0, noise: 0.5 },
  water: { wave: 'sine', tone: 0.85, noise: 0.22 },
  earth: { wave: 'square', tone: 0.6, noise: 0.38 },
  wind: { wave: 'triangle', tone: 1.2, noise: 0.42 },
  light: { wave: 'sine', tone: 1.5, noise: 0.12 },
  dark: { wave: 'sawtooth', tone: 0.72, noise: 0.24 },
};

/**
 * PURE: an attack IMPACT. Timbre + pitch + weight scale with `damage` (a bigger
 * hit lands lower + heavier + a touch louder), flavoured by `element` (waveform,
 * register, and how much noise "crack" it carries). Kept punchy but not harsh —
 * a satisfying thud, not a violent one.
 */
export function impactRecipe(damage: number, element: Element): AudioRecipe {
  const flav = ELEMENT_FLAVOR[element] ?? ELEMENT_FLAVOR.earth;
  const mag = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  const norm = Math.min(1, mag / 60); // 0 (chip) … 1 (heavy)
  // Heavier hits land LOWER (more weight) and a little longer.
  const thump = (200 - norm * 120) * flav.tone;
  const body = 0.1 + norm * 0.12;
  const events: AudioEvent[] = [
    // Transient crack — element decides how much.
    noise(0, 0.045 + norm * 0.03, flav.noise * (0.4 + norm * 0.4)),
    // Low thump body.
    tone(thump, 0, body, 0.45 + norm * 0.2, flav.wave),
    // A short mid partial so it reads as "connected", not just a boom.
    tone(thump * 2.02, 0, body * 0.6, 0.18 + norm * 0.1, 'sine'),
  ];
  return { sampleRate: SR, masterGain: 0.85, events };
}

/**
 * PURE: a SKILL cast — a short rising shimmer in the element's timbre + register
 * (a spell "winds up" and releases). Gentle and characterful per element.
 */
export function skillRecipe(element: Element): AudioRecipe {
  const flav = ELEMENT_FLAVOR[element] ?? ELEMENT_FLAVOR.light;
  const root = 330 * flav.tone;
  const rise = [0, 4, 7, 12]; // a bright arpeggiated wind-up
  const step = 0.06;
  const events: AudioEvent[] = [];
  rise.forEach((s, i) => {
    events.push(tone(root * semi(s), i * step, 0.12, 0.3, flav.wave));
    events.push(tone(root * semi(s), i * step, 0.12, 0.1, 'sine')); // softening body
  });
  // A soft breath of noise under the cast for texture (element-scaled).
  events.push(noise(0, rise.length * step, flav.noise * 0.18));
  return { sampleRate: SR, masterGain: 0.8, events };
}

/**
 * PURE: a FAINT — a soft, DESCENDING "aww". Creatures faint, they never die, so
 * this is tender and deflating, not violent: a gentle three-note fall (sine) with
 * a warm triangle underlay that sighs downward.
 */
export function faintRecipe(): AudioRecipe {
  const fall = [880.0, 698.46, 587.33, 493.88]; // A5 → F5 → D5 → B4, a soft sigh
  const step = 0.14;
  const events: AudioEvent[] = [];
  fall.forEach((freq, i) => {
    const g = 0.34 - i * 0.05; // fades as it falls
    events.push(tone(freq, i * step, 0.22, Math.max(0.12, g), 'sine'));
    events.push(tone(freq, i * step, 0.24, Math.max(0.05, g * 0.4), 'triangle'));
  });
  return { sampleRate: SR, masterGain: 0.78, events };
}

/**
 * PURE: a SCOUT result. On success a hopeful RISING three-note chime — the warm
 * "a bond formed" sound; on failure a single gentle down-note (a soft "not this
 * time", never a harsh buzzer).
 */
export function scoutRecipe(success: boolean): AudioRecipe {
  if (success) {
    const rise = [523.25, 659.25, 880.0]; // C5 → E5 → A5, hopeful
    const step = 0.11;
    const events: AudioEvent[] = [];
    rise.forEach((freq, i) => {
      events.push(tone(freq, i * step, 0.2, 0.34, 'sine'));
      events.push(tone(freq, i * step, 0.2, 0.12, 'triangle'));
    });
    // A little octave sparkle to seal the bond.
    events.push(tone(880.0 * 2, 2 * step, 0.24, 0.07, 'sine'));
    return { sampleRate: SR, masterGain: 0.82, events };
  }
  // Failure: a soft two-note down, gentle and forgiving.
  const events: AudioEvent[] = [
    tone(587.33, 0, 0.16, 0.28, 'sine'),
    tone(466.16, 0.14, 0.22, 0.24, 'sine'),
    tone(466.16, 0.14, 0.22, 0.08, 'triangle'),
  ];
  return { sampleRate: SR, masterGain: 0.78, events };
}

/**
 * PURE: a LEVEL-UP flourish — bright + happy, a four-note ascending run that ends
 * on an octave sparkle. Warm (triangle body under square sparkle), celebratory
 * without being shrill.
 */
export function levelUpRecipe(): AudioRecipe {
  const run = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6, a major climb
  const step = 0.09;
  const events: AudioEvent[] = [];
  run.forEach((freq, i) => {
    events.push(tone(freq, i * step, 0.13, 0.34, 'triangle'));
    events.push(tone(freq, i * step, 0.13, 0.14, 'square')); // bright edge
  });
  // Final sparkle: an octave above the last note, ringing a touch longer.
  events.push(tone(1046.5 * 2, run.length * step - 0.02, 0.26, 0.12, 'sine'));
  events.push(tone(1318.51, run.length * step + 0.06, 0.22, 0.14, 'triangle')); // E6 lift
  return { sampleRate: SR, masterGain: 0.82, events };
}

/**
 * PURE: soft menu ticks. `select` is a single bare high blip; `confirm` a warm
 * two-note lift; `back` a gentle two-note fall. All quiet — a courtesy, never a
 * toolkit clack.
 */
export function uiTick(kind: 'select' | 'confirm' | 'back'): AudioRecipe {
  switch (kind) {
    case 'confirm':
      return {
        sampleRate: SR,
        masterGain: 0.7,
        events: [
          tone(659.25, 0, 0.06, 0.28, 'sine'),
          tone(987.77, 0.06, 0.09, 0.28, 'sine'),
        ],
      };
    case 'back':
      return {
        sampleRate: SR,
        masterGain: 0.7,
        events: [
          tone(659.25, 0, 0.06, 0.26, 'sine'),
          tone(493.88, 0.06, 0.1, 0.26, 'sine'),
        ],
      };
    case 'select':
    default:
      return {
        sampleRate: SR,
        masterGain: 0.6,
        events: [tone(1318.51, 0, 0.045, 0.2, 'sine')],
      };
  }
}

/**
 * PURE: a gentle procedural AMBIENT PAD for a zone, derived DETERMINISTICALLY
 * from the zone's `token` string (same token → same pad; different tokens → a
 * different pad). Warm, wistful, hopeful — the tone of "The Fading". A low root
 * with a soft chord above it, each voice a slightly-detuned pair for a slow chorus
 * shimmer, all sustained and overlapping so it breathes rather than plays.
 *
 * Determinism comes from the seeded `prng` (hashStringToSeed → createRng) — no
 * Math.random / Date.now.
 */
export function ambientPad(token: string): AudioRecipe {
  const rng: Rng = createRng(hashStringToSeed(`${token}:ambient-pad`));

  // Root in a low, warm register (A2 ≈ 110Hz … A3 ≈ 220Hz).
  const root = 110 * semi(rng.range(0, 12));
  // A wistful chord shape drawn from the seed: root + fifth + one colour tone.
  const colourPalette = [3, 4, 7, 9, 10, 12, 14, 16]; // minor/major thirds, ninths…
  const chord = [0, 7, rng.pick(colourPalette)];
  const dur = 2.0 + rng.next() * 1.5; // a long, slow bed (~2–3.5s)
  const detune = 0.004 + rng.next() * 0.006; // a few cents of slow chorus

  const events: AudioEvent[] = [];
  chord.forEach((s, i) => {
    const freq = root * semi(s);
    const start = i * (0.12 + rng.next() * 0.1); // voices enter softly, staggered
    const g = 0.2 - i * 0.03; // upper voices sit back
    // Detuned pair per voice → slow, warm chorus shimmer.
    events.push(tone(freq * (1 - detune), start, dur, Math.max(0.08, g), 'sine'));
    events.push(tone(freq * (1 + detune), start, dur, Math.max(0.06, g * 0.8), 'triangle'));
  });
  return { sampleRate: SR, masterGain: 0.55, events };
}

// ── runtime wrapper: positional playback over AudioManager (headless-safe) ───────

/** Bus names the wrapper drives. Map onto the manager's channels. */
export type SpatialBus = 'music' | 'sfx' | 'cries';

/** The emotional moments the wrapper can play by name (for a BattleEvent stream). */
export type MomentName = 'newborn' | 'impact' | 'faint' | 'scout' | 'levelUp' | 'ui';

/** A positional cue: stereo pan (−1 left … +1 right) + distance (0 = at listener). */
export interface PlayCueOpts {
  /** Stereo pan, −1 (hard left) … +1 (hard right). Defaults to 0 (centre). */
  pan?: number;
  /** Distance from the listener (≥ 0). Louder near, quieter far. Defaults to 0. */
  distance?: number;
  /** Extra per-play linear gain (0..1). Defaults to 1. */
  gain?: number;
}

export interface SpatialAudioOptions {
  /** Channel a creature cry routes through. Defaults to 'cries'. */
  cryChannel?: Channel;
  /** Channel combat/UI SFX route through. Defaults to 'sfx'. */
  sfxChannel?: Channel;
  /** Channel the ambient pad routes through. Defaults to 'music'. */
  musicChannel?: Channel;
  /** How sharply gain falls with distance (per unit). Defaults to 0.35. */
  distanceFalloff?: number;
}

export interface SpatialAudio {
  /** Play a creature's VOICE with an optional positional cue, on the cries bus. */
  playCry(cry: CrySpec, opts?: PlayCueOpts): void;
  /** Play an emotional moment by name (routes to the right bus). */
  playMoment(name: MomentName, ...args: unknown[]): void;
  /** The breeding-reveal chime (optionally leading into the newborn's first cry). */
  playNewborn(cry?: CrySpec, opts?: PlayCueOpts): void;
  /** An attack impact (damage + element), on the sfx bus. */
  playImpact(damage: number, element: Element, opts?: PlayCueOpts): void;
  /** A skill cast (per element), on the sfx bus. */
  playSkill(element: Element, opts?: PlayCueOpts): void;
  /** The soft descending faint "aww", on the sfx bus. */
  playFaint(opts?: PlayCueOpts): void;
  /** The scout result chime (rising on success, gentle down on failure). */
  playScout(success: boolean, opts?: PlayCueOpts): void;
  /** The level-up flourish, on the sfx bus. */
  playLevelUp(opts?: PlayCueOpts): void;
  /** A soft menu tick, on the sfx bus. */
  playUi(kind: 'select' | 'confirm' | 'back'): void;
  /** Start a zone's ambient pad (deterministic from its token), on the music bus. */
  startAmbient(token: string): void;
  /** Stop the ambient pad (clears the active token; see notes on true looping). */
  stopAmbient(): void;
  /** Positional play of ANY recipe: stereo pan + distance attenuation. */
  playAt(recipe: AudioRecipe, opts?: PlayCueOpts): void;
  /** Set a bus volume (maps to the underlying manager channel), clamped 0..1. */
  setBusVolume(bus: SpatialBus | 'master', level: number): void;
  /** Read a bus volume (0..1). */
  getBusVolume(bus: SpatialBus | 'master'): number;
}

/**
 * Create the runtime wrapper over an {@link AudioManager}. Every method is a clean
 * NO-OP when there's no AudioContext (the manager no-ops, and the positional path
 * bails on a null context) and NEVER throws — call sites need no guards.
 *
 * The manager SHOULD be created with a 'cries' channel, e.g.
 * `createAudioManager({ channels: ['master','music','sfx','cries'] })`; if it
 * lacks a channel the manager simply ignores plays on it (still safe).
 */
export function createSpatialAudio(
  manager: AudioManager,
  opts: SpatialAudioOptions = {},
): SpatialAudio {
  const cryChannel = opts.cryChannel ?? 'cries';
  const sfxChannel = opts.sfxChannel ?? 'sfx';
  const musicChannel = opts.musicChannel ?? 'music';
  const falloff = opts.distanceFalloff ?? 0.35;

  /** Distance → linear attenuation in (0..1]. Near = 1, far → 0. */
  function distanceGain(distance?: number): number {
    const d = distance !== undefined && distance > 0 ? distance : 0;
    return 1 / (1 + falloff * d);
  }

  const busFor: Record<SpatialBus, () => Channel> = {
    music: () => musicChannel,
    sfx: () => sfxChannel,
    cries: () => cryChannel,
  };

  /**
   * Render a recipe LIVE through a StereoPannerNode so the sound is truly panned,
   * respecting the target channel's (approximate) volume read at play time. Only
   * used when a context AND StereoPannerNode exist; otherwise the caller falls
   * back to the manager's own bus play. Mirrors AudioManager.playRecipe's
   * per-event synth + envelope. NEVER throws.
   */
  function playPanned(
    recipe: AudioRecipe,
    channel: Channel,
    pan: number,
    extraGain: number,
  ): boolean {
    const ctx = manager.getContext();
    if (!ctx) return false;
    const PannerCtor = (ctx as unknown as { createStereoPanner?: () => StereoPannerNode })
      .createStereoPanner;
    if (typeof PannerCtor !== 'function') return false;
    if (recipe.events.length === 0) return true; // "handled" — nothing to play

    // Approximate the bus by reading the channel × master volume at play time.
    const busVol = clamp01(manager.getVolume(channel)) * clamp01(manager.getVolume('master'));
    const recipeMaster = recipe.masterGain === undefined ? 1 : clamp01(recipe.masterGain);
    const mix = clamp01(recipeMaster * clamp01(extraGain) * busVol);
    if (mix <= 0) return true;

    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(ctx.destination);

    for (const e of recipe.events) {
      if (e.durationSec <= 0) continue;
      const peak = clamp01(clamp01(e.gain) * mix);
      if (peak <= 0) continue;
      const startAt = now + Math.max(0, e.startSec);
      const dur = e.durationSec;
      const ramp = Math.min(0.01, dur / 2);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, startAt);
      env.gain.linearRampToValueAtTime(peak, startAt + ramp);
      env.gain.setValueAtTime(peak, startAt + Math.max(ramp, dur - ramp));
      env.gain.linearRampToValueAtTime(0, startAt + dur);
      env.connect(panner);

      if (e.type === 'noise') {
        const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(env);
        src.start(startAt);
        src.stop(startAt + dur);
        src.onended = () => {
          try {
            src.disconnect();
            env.disconnect();
          } catch {
            /* already gone */
          }
        };
      } else {
        const osc = ctx.createOscillator();
        osc.type = (e.wave ?? 'sine') as AudioWave;
        osc.frequency.value = e.freq ?? 440;
        osc.connect(env);
        osc.start(startAt);
        osc.stop(startAt + dur);
        osc.onended = () => {
          try {
            osc.disconnect();
            env.disconnect();
          } catch {
            /* already gone */
          }
        };
      }
    }
    return true;
  }

  /**
   * Route a recipe to a bus with a positional cue. If a real pan is requested and
   * a StereoPanner is available, render panned; otherwise (centre pan, or headless)
   * fold distance into a gain and let the manager play it through the bus. Both
   * paths are no-ops without a context, and neither throws.
   */
  function route(recipe: AudioRecipe, channel: Channel, cue?: PlayCueOpts): void {
    const pan = cue?.pan ?? 0;
    const gain = clamp01((cue?.gain ?? 1) * distanceGain(cue?.distance));
    if (Math.abs(pan) > 0.001) {
      if (playPanned(recipe, channel, pan, gain)) return;
    }
    manager.playRecipe(recipe, { channel, gain });
  }

  /** The token of the ambient pad currently "active" (see stopAmbient notes). */
  let activeAmbient: string | null = null;

  return {
    playCry(cry: CrySpec, cue?: PlayCueOpts): void {
      route(cryToRecipe(cry), cryChannel, cue);
    },

    playMoment(name: MomentName, ...args: unknown[]): void {
      switch (name) {
        case 'newborn':
          this.playNewborn(args[0] as CrySpec | undefined, args[1] as PlayCueOpts | undefined);
          return;
        case 'impact':
          this.playImpact(
            (args[0] as number) ?? 0,
            (args[1] as Element) ?? 'earth',
            args[2] as PlayCueOpts | undefined,
          );
          return;
        case 'faint':
          this.playFaint(args[0] as PlayCueOpts | undefined);
          return;
        case 'scout':
          this.playScout(Boolean(args[0]), args[1] as PlayCueOpts | undefined);
          return;
        case 'levelUp':
          this.playLevelUp(args[0] as PlayCueOpts | undefined);
          return;
        case 'ui':
          this.playUi((args[0] as 'select' | 'confirm' | 'back') ?? 'select');
          return;
        default:
          return;
      }
    },

    playNewborn(cry?: CrySpec, cue?: PlayCueOpts): void {
      route(newbornChime(cry), musicChannel, cue);
    },

    playImpact(damage: number, element: Element, cue?: PlayCueOpts): void {
      route(impactRecipe(damage, element), sfxChannel, cue);
    },

    playSkill(element: Element, cue?: PlayCueOpts): void {
      route(skillRecipe(element), sfxChannel, cue);
    },

    playFaint(cue?: PlayCueOpts): void {
      route(faintRecipe(), sfxChannel, cue);
    },

    playScout(success: boolean, cue?: PlayCueOpts): void {
      route(scoutRecipe(success), sfxChannel, cue);
    },

    playLevelUp(cue?: PlayCueOpts): void {
      route(levelUpRecipe(), sfxChannel, cue);
    },

    playUi(kind: 'select' | 'confirm' | 'back'): void {
      manager.playRecipe(uiTick(kind), { channel: sfxChannel });
    },

    startAmbient(token: string): void {
      // Idempotent: re-starting the SAME zone's pad doesn't re-trigger it.
      if (activeAmbient === token) return;
      activeAmbient = token;
      manager.playRecipe(ambientPad(token), { channel: musicChannel });
    },

    stopAmbient(): void {
      // NOTE: the manager exposes no handle to stop an in-flight recipe, so this
      // clears the active token (so startAmbient can re-trigger) rather than
      // hard-cutting the current bed. See the report — true loop/stop is owed and
      // wants a manager-level hook (out of this module's scope).
      activeAmbient = null;
    },

    playAt(recipe: AudioRecipe, cue?: PlayCueOpts): void {
      route(recipe, sfxChannel, cue);
    },

    setBusVolume(bus: SpatialBus | 'master', level: number): void {
      const channel = bus === 'master' ? 'master' : busFor[bus]();
      manager.setVolume(channel, level);
    },

    getBusVolume(bus: SpatialBus | 'master'): number {
      const channel = bus === 'master' ? 'master' : busFor[bus]();
      return manager.getVolume(channel);
    },
  };
}
