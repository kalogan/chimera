import { describe, it, expect } from 'vitest';
import { createAudioManager, renderRecipeSamples, type AudioRecipe } from '../audio/index.js';
import { cryFromToken, type CrySpec, type Element, ELEMENTS } from '../creature/index.js';
import {
  cryToRecipe,
  newbornChime,
  impactRecipe,
  skillRecipe,
  faintRecipe,
  scoutRecipe,
  levelUpRecipe,
  uiTick,
  ambientPad,
  createSpatialAudio,
} from './index.js';

/** Sum of squared samples — a headless "is it audible?" energy probe. */
function energy(recipe: AudioRecipe): number {
  const s = renderRecipeSamples(recipe);
  let e = 0;
  for (let i = 0; i < s.length; i++) e += (s[i] ?? 0) * (s[i] ?? 0);
  return e;
}

function sampleCry(id = 'cry-seed'): CrySpec {
  return cryFromToken(id, 'beast', 0.4, 2);
}

describe('cryToRecipe — the signature voice', () => {
  it('is deterministic: same CrySpec → deep-equal recipe', () => {
    const cry = sampleCry('det');
    expect(cryToRecipe(cry)).toStrictEqual(cryToRecipe({ ...cry, intervals: [...cry.intervals] }));
  });

  it('different crySpecs give different recipes', () => {
    const a = cryToRecipe(cryFromToken('voice-a', 'bird', 0.2, 0));
    const b = cryToRecipe(cryFromToken('voice-b', 'golem', 0.9, 5));
    expect(a).not.toStrictEqual(b);
  });

  it('renders non-silent samples (non-zero energy)', () => {
    expect(energy(cryToRecipe(sampleCry()))).toBeGreaterThan(0);
  });

  it('places one fundamental per interval, sequentially', () => {
    const cry: CrySpec = {
      wave: 'triangle',
      baseHz: 440,
      intervals: [0, 12],
      noteDur: 0.1,
      vibrato: 0,
      brightness: 0,
    };
    const r = cryToRecipe(cry);
    // vibrato 0 + brightness 0 → exactly one tone per interval.
    expect(r.events).toHaveLength(2);
    expect(r.events[0]?.freq).toBeCloseTo(440, 5);
    expect(r.events[1]?.freq).toBeCloseTo(880, 5); // +12 semitones = octave
    expect(r.events[1]?.startSec).toBeCloseTo(0.1, 5);
  });

  it('brightness + vibrato add partials (more events)', () => {
    const base: CrySpec = {
      wave: 'sine',
      baseHz: 300,
      intervals: [0, 3, 7],
      noteDur: 0.12,
      vibrato: 0,
      brightness: 0,
    };
    const plain = cryToRecipe(base);
    const rich = cryToRecipe({ ...base, vibrato: 0.8, brightness: 0.9 });
    expect(rich.events.length).toBeGreaterThan(plain.events.length);
  });
});

describe('moment factories — valid, non-empty, audible recipes', () => {
  const cases: Array<[string, AudioRecipe]> = [
    ['newbornChime (bare)', newbornChime()],
    ['newbornChime (+cry)', newbornChime(sampleCry('newborn'))],
    ['impact low', impactRecipe(5, 'water')],
    ['impact heavy', impactRecipe(80, 'fire')],
    ['faint', faintRecipe()],
    ['scout success', scoutRecipe(true)],
    ['scout fail', scoutRecipe(false)],
    ['levelUp', levelUpRecipe()],
    ['ui select', uiTick('select')],
    ['ui confirm', uiTick('confirm')],
    ['ui back', uiTick('back')],
    ['ambientPad', ambientPad('zone:fading-glade')],
  ];

  for (const [name, recipe] of cases) {
    it(`${name} is a valid, non-empty, audible recipe`, () => {
      expect(recipe.sampleRate).toBeGreaterThan(0);
      expect(recipe.events.length).toBeGreaterThan(0);
      for (const e of recipe.events) {
        expect(e.durationSec).toBeGreaterThan(0);
        expect(e.gain).toBeGreaterThan(0);
      }
      expect(energy(recipe)).toBeGreaterThan(0);
    });
  }

  it('skillRecipe covers every element and stays audible', () => {
    for (const el of ELEMENTS) {
      const r = skillRecipe(el);
      expect(r.events.length).toBeGreaterThan(0);
      expect(energy(r)).toBeGreaterThan(0);
    }
  });

  it('impact scales timbre/pitch with damage (heavy lands lower than light)', () => {
    const light = impactRecipe(2, 'earth');
    const heavy = impactRecipe(90, 'earth');
    const lightThump = light.events.find((e) => e.type === 'tone')?.freq ?? 0;
    const heavyThump = heavy.events.find((e) => e.type === 'tone')?.freq ?? 0;
    expect(heavyThump).toBeLessThan(lightThump);
  });

  it('newbornChime with a cry leads into that voice (longer than bare)', () => {
    expect(newbornChime(sampleCry()).events.length).toBeGreaterThan(newbornChime().events.length);
  });
});

describe('ambientPad — deterministic per token, differs across tokens', () => {
  it('same token → deep-equal recipe', () => {
    expect(ambientPad('zone:hollow')).toStrictEqual(ambientPad('zone:hollow'));
  });

  it('different tokens → different recipes', () => {
    expect(ambientPad('zone:hollow')).not.toStrictEqual(ambientPad('zone:summit'));
  });

  it('is warm + low (root below ~450Hz) and sustained', () => {
    const r = ambientPad('zone:meadow');
    const lowest = Math.min(...r.events.map((e) => e.freq ?? Infinity));
    expect(lowest).toBeLessThan(450);
    expect(Math.max(...r.events.map((e) => e.durationSec))).toBeGreaterThan(1);
  });
});

describe('createSpatialAudio — headless-safe (no AudioContext, must not throw)', () => {
  function headless() {
    return createAudioManager({ channels: ['master', 'music', 'sfx', 'cries'] });
  }

  it('every play method is a clean no-op headless', () => {
    const sa = createSpatialAudio(headless());
    const cry = sampleCry();
    expect(() => {
      sa.playCry(cry);
      sa.playCry(cry, { pan: -0.8, distance: 5, gain: 0.5 });
      sa.playNewborn();
      sa.playNewborn(cry, { pan: 0.4 });
      sa.playImpact(40, 'fire', { distance: 3 });
      sa.playSkill('light');
      sa.playFaint();
      sa.playScout(true);
      sa.playScout(false);
      sa.playLevelUp();
      sa.playUi('select');
      sa.playUi('confirm');
      sa.playUi('back');
      sa.playAt(impactRecipe(10, 'wind'), { pan: 1, distance: 2 });
      sa.startAmbient('zone:a');
      sa.startAmbient('zone:a'); // idempotent
      sa.stopAmbient();
      sa.startAmbient('zone:b');
    }).not.toThrow();
  });

  it('playMoment dispatches every moment without throwing', () => {
    const sa = createSpatialAudio(headless());
    const els: Element[] = ['fire', 'water'];
    expect(() => {
      sa.playMoment('newborn', sampleCry());
      sa.playMoment('impact', 55, els[0]);
      sa.playMoment('faint');
      sa.playMoment('scout', true);
      sa.playMoment('levelUp');
      sa.playMoment('ui', 'confirm');
    }).not.toThrow();
  });

  it('bus volumes route through the manager channels', () => {
    const sa = createSpatialAudio(headless());
    sa.setBusVolume('cries', 0.5);
    sa.setBusVolume('music', 0.25);
    sa.setBusVolume('sfx', 0.75);
    sa.setBusVolume('master', 0.9);
    expect(sa.getBusVolume('cries')).toBeCloseTo(0.5, 5);
    expect(sa.getBusVolume('music')).toBeCloseTo(0.25, 5);
    expect(sa.getBusVolume('sfx')).toBeCloseTo(0.75, 5);
    expect(sa.getBusVolume('master')).toBeCloseTo(0.9, 5);
  });
});
