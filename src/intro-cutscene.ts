/**
 * CHIMERA — "The Fading": the intro cutscene's authored data.
 *
 * Pure data (game-kit/cutscene's `CutsceneSequence`), same shape GYRE's
 * school-cutscenes.ts authors against — see vendor/game-kit/src/cutscene/index.ts
 * for the core contract this file is written to (shots, camera keys, ramps,
 * one-shot events). CHIMERA has no 3D world to point a camera into here (this
 * plays before the player ever reaches the Sanctuary/town), so this sequence
 * carries NO `camera` track at all — intro.tsx is a DOM/CSS piece, not an r3f
 * scene, and only reads `ramps.glow` + the `caption` events. The `camera` field
 * stays fully optional per the core's types, so omitting it is valid, not a
 * workaround.
 *
 * ONE SHOT, ~8.5s total. Four short captions carry the whole premise — the
 * world was woven of living light, the weave is unravelling, and a spark
 * remains: the player. Tone: warm/wistful (DQM charm + Ghibli tenderness),
 * never grimdark — this is a bedtime-story cold open, not a disaster.
 * Captions echo/extend the splash's existing tagline ("Aldercradle is fading.
 * Weave it back to life.") rather than repeat it verbatim.
 *
 * RAMP: a single named ramp `glow`, 0..1, authored as a gentle rise/fall/rise —
 * intro.tsx maps it onto its background gradient warmth + the drifting mote's
 * opacity (module never touches DOM/CSS itself, same "ramps are just numbers"
 * rule the r3f shell follows for THREE objects).
 */
import type { CutsceneSequence } from 'game-kit/cutscene';

export const INTRO_SEQUENCE: CutsceneSequence = {
  shots: [
    {
      duration: 8.5,
      ramps: {
        glow: {
          keys: [
            { t: 0, value: 0 },
            { t: 2.2, value: 0.55, ease: 'easeOutCubic' },
            { t: 5.5, value: 0.3, ease: 'easeInOutQuad' },
            { t: 8.5, value: 1, ease: 'easeInOutQuad' },
          ],
        },
      },
      events: [
        { t: 0.4, name: 'caption', data: 'Once, Aldercradle was woven of living light.' },
        { t: 2.8, name: 'caption', data: 'Thread by thread, the weave is coming undone.' },
        { t: 5.4, name: 'sting', data: 'spark' },
        { t: 5.6, name: 'caption', data: 'But one spark remains.' },
        { t: 7.6, name: 'caption', data: 'Go — weave it back to life.' },
      ],
    },
  ],
};
