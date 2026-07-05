/**
 * title — the game's front door: a skippable STUDIO IDENT that plays first, then
 * a TITLE SCREEN (backdrop + wordmark + menu options), parameterized by brand.
 *
 * This `index.ts` is the THREE-free, React-free core: shared TYPES + the small
 * pure helpers worth testing. The DOM views — `<StudioIdent>`, `<TitleScreen>` —
 * live in `r3f.tsx` (the kit's "React view" slot; the views are plain DOM).
 *
 * Distilled from CHIMERA (studio-logo.tsx WOVENWILD ident → shell/splash.tsx
 * title with New Game / Continue / Settings over a 3D backdrop) and GYRE (no
 * ident; a "GYRE / a descent" title over a CSS coil). The shared PATTERN — a
 * wall-clock-timed skippable ident that hands off via onDone, and a title =
 * backdrop slot + wordmark + a list of menu options + fade — is the kit; the
 * BRAND (wordmark, art, backdrop, colors, which options) is per-game props.
 */

/** One selectable option on the title screen's menu. */
export interface MenuOption {
  /** Button text (e.g. "New Game →", "Continue ↺"). */
  label: string;
  /** Fired when chosen (after the leave-fade, so audio/animation can play). */
  onSelect: () => void;
  /** Grayed out + non-interactive when true. */
  disabled?: boolean;
  /** Emphasis flag — the view renders the primary option stronger. */
  primary?: boolean;
  /** Whether choosing this leaves the title (plays the fade-out before running
   *  `onSelect`). Default `true`. Set `false` for options that open something
   *  OVER the title (e.g. a Settings modal) so the title doesn't fade away. */
  leaves?: boolean;
}

/** Timing knobs for the studio ident (all ms). */
export interface IdentTiming {
  /** Total ident time before the auto hand-off. */
  durationMs: number;
  /** When to fire the optional audio cue (once the brand mark reads as "alive"). */
  cueMs: number;
}

/** CHIMERA-tuned ident timing: content settles ~2.9s, cue at 2.4s, ~1s linger. */
export const DEFAULT_IDENT_TIMING: IdentTiming = { durationMs: 3900, cueMs: 2400 };

/**
 * Normalized 0..1 progress of `elapsed` through `duration` (clamped). Passed to a
 * game's custom ident `render(progress)` slot so brand art can drive its own
 * draw-on without re-deriving the clock.
 */
export function progress01(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  if (elapsed <= 0) return 0;
  return elapsed >= duration ? 1 : elapsed / duration;
}
