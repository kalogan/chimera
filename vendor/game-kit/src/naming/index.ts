/**
 * naming — procedural creature names from an identity token.
 *
 * THREE-FREE + PURE: no three, no Math.random, no Date.now. Same (id, family)
 * always yields the same name; different tokens diverge. Names are built from
 * FAMILY-FLAVOURED syllable pools (a beast growls, a bird lilts, a spirit sighs)
 * so a generated name reads as belonging to its family — the anti-sameness thesis
 * carried into text. A bred creature's family (a combination of its parents')
 * pulls from that family's pool, so hybrids get plausibly-blended names for free.
 */

import { createRng, hashStringToSeed, type Rng } from '../prng/index.js';

/** The eight monster families. Kept in sync with `creature`'s `Family` union. */
export type NameFamily =
  | 'beast'
  | 'bird'
  | 'dragon'
  | 'slime'
  | 'aquatic'
  | 'nature'
  | 'golem'
  | 'spirit';

/** Onset syllables per family — the flavour lives here. */
const ONSETS: Record<NameFamily, readonly string[]> = {
  beast: ['Gnar', 'Brak', 'Ruff', 'Fang', 'Grr', 'Mor', 'Thak', 'Bram'],
  bird: ['Ael', 'Pil', 'Kee', 'Vol', 'Cirr', 'Zeph', 'Lir', 'Pee'],
  dragon: ['Vor', 'Dra', 'Zar', 'Gron', 'Ith', 'Kaal', 'Ryn', 'Aur'],
  slime: ['Blib', 'Squ', 'Glo', 'Mo', 'Plip', 'Goo', 'Wub', 'Nim'],
  aquatic: ['Wav', 'Nix', 'Mer', 'Cor', 'Tid', 'Bru', 'Sel', 'Lun'],
  nature: ['Bram', 'Fern', 'Mos', 'Thorn', 'Sprig', 'Vin', 'Rue', 'Bar'],
  golem: ['Grom', 'Bould', 'Karn', 'Obs', 'Ferr', 'Slag', 'Cair', 'Dur'],
  spirit: ['Wis', 'Shae', 'Nul', 'Eth', 'Umbr', 'Vael', 'Sil', 'Mour'],
};

/** Shared nucleus + coda pools — vary the tail, keep it pronounceable. */
const NUCLEI: readonly string[] = ['a', 'o', 'i', 'u', 'e', 'ae', 'oo', 'y'];
const CODAS: readonly string[] = [
  'x',
  'th',
  'k',
  'sh',
  'n',
  'll',
  'sk',
  'm',
  'p',
  'ss',
  'rr',
  'g',
];
/** Optional gentle suffixes that make a two-part name feel like a species. */
const SUFFIXES: readonly string[] = ['ling', 'kin', 'wyrm', 'mote', 'ox', 'ux', 'ora', 'im'];

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Build a species name from a token id + family. Deterministic. Two or three
 * fragments: an onset (family-flavoured) + a middle, sometimes a soft suffix.
 */
export function nameFromToken(id: string, family: NameFamily): string {
  const rng: Rng = createRng(hashStringToSeed(`${id}:name:${family}`));
  const onset = rng.pick(ONSETS[family]);
  const nucleus = rng.pick(NUCLEI);
  const coda = rng.pick(CODAS);

  let name = `${onset}${nucleus}${coda}`;
  // ~45% of the time append a soft suffix for a longer, species-y name.
  if (rng.next() < 0.45) {
    name += rng.pick(SUFFIXES);
  }
  return cap(name.toLowerCase());
}
