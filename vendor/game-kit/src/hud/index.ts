/**
 * hud — the on-screen bottom-bar controls for a mobile game: a directional
 * d-pad + an action-button cluster (+ an optional menu button).
 *
 * This `index.ts` is the THREE-free, React-free core: the shared TYPES and the
 * one bit of real logic worth testing (`keyToDir4`, so a game maps its on-screen
 * d-pad and its hardware keys through ONE table). The DOM view — `<DPad>`,
 * `<ActionBar>`, `<BottomHud>` — lives in `r3f.tsx` (the kit's "React view" slot,
 * even though this view is plain DOM, matching the `touch` module).
 *
 * Distilled from CHIMERA (which hand-rolled a d-pad + Talk/Menu cluster in
 * App.tsx + styles.css) and GYRE (kit `touch` stick + a separate pause button) —
 * the shared shape is: buttons that just fire callbacks, with ALL game logic
 * (labels, which buttons show, enabled state, hint text) passed in as props.
 *
 * (Supersedes the earlier unused `LayerRegistry` stub — it had no consumers.)
 */

/** A 4-way direction — the d-pad's output and the grid-walk vocabulary. */
export type Dir4 = 'up' | 'down' | 'left' | 'right';

/** All four directions, in a stable render order (up, left, right, down). */
export const DIR4: readonly Dir4[] = ['up', 'left', 'right', 'down'];

/** The default glyph shown on each d-pad button. */
export const DIR4_GLYPH: Readonly<Record<Dir4, string>> = {
  up: '▲',
  left: '◀',
  right: '▶',
  down: '▼',
};

/** An action button in the HUD's right-side cluster. Pure data + a callback —
 *  the game owns what it says, whether it's enabled, and what it does. */
export interface HudAction {
  /** Stable id (React key). */
  id: string;
  /** Visible label (may be context-dependent, e.g. "Talk (E)" → "Enter Home (E)"). */
  label: string;
  /** Fired on press. */
  onPress: () => void;
  /** Grayed out + non-interactive when true. */
  disabled?: boolean;
  /** Tooltip / accessibility label. */
  title?: string;
  /** Optional emphasis flag — the view can render the primary action stronger. */
  primary?: boolean;
}

// Keyboard keys (KeyboardEvent.key, lower-cased) → direction. Arrow keys + WASD,
// the two conventions both shipped games use.
const KEY_TO_DIR4: Readonly<Record<string, Dir4>> = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
};

/**
 * Map a keyboard key (`KeyboardEvent.key`, case-insensitive) to a {@link Dir4},
 * or `null` if it isn't a movement key. Lets a game route its on-screen d-pad
 * and its hardware keys through one mapping instead of two divergent ones.
 */
export function keyToDir4(key: string): Dir4 | null {
  return KEY_TO_DIR4[key.toLowerCase()] ?? null;
}
