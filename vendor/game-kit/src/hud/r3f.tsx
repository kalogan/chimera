/**
 * hud — the bottom-bar DOM view (react). Named `r3f.tsx` to match the kit's
 * "React view" slot convention, though this view is plain DOM (no three):
 *
 *  - <DPad>       — a 4-way directional pad (bottom-left), emits Dir4 on press.
 *  - <ActionBar>  — a right-side column of action buttons + an optional menu button.
 *  - <BottomHud>  — composes both into the standard bottom bar.
 *
 * All game logic (labels, which buttons show, enabled state, what they do) is
 * passed in as props — the components only render + wire input. Styling is inline
 * with a small set of CSS custom properties (below) so a game can re-theme by
 * setting them on any ancestor; every one has a sensible default.
 *
 * Theme vars: --hud-btn-bg, --hud-btn-fg, --hud-btn-border, --hud-accent,
 * --hud-accent-fg, --hud-radius, --hud-inset.
 *
 * Requires the react peer dep (optional in package.json).
 */
import { type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { DIR4, DIR4_GLYPH, type Dir4, type HudAction } from './index.js';

// Inset from the screen edges, plus the device safe area (notch / home bar).
const INSET = 'calc(var(--hud-inset, 20px) + env(safe-area-inset-bottom, 0px))';
const INSET_L = 'calc(var(--hud-inset, 20px) + env(safe-area-inset-left, 0px))';
const INSET_R = 'calc(var(--hud-inset, 20px) + env(safe-area-inset-right, 0px))';

const btnBase: CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--hud-btn-border, rgba(60,45,30,0.18))',
  background: 'var(--hud-btn-bg, rgba(247,239,226,0.92))',
  color: 'var(--hud-btn-fg, #4a3a24)',
  borderRadius: 'var(--hud-radius, 14px)',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  touchAction: 'none',
  boxShadow: '0 2px 6px rgba(43,36,64,0.14)',
};

/** Fire `fn` on pointer-down (snappier than click) without letting the press
 *  scroll the page, select text, or steal focus. */
function press(fn: () => void) {
  return (e: ReactPointerEvent) => {
    e.preventDefault();
    fn();
  };
}

const PAD_POS: Record<Dir4, CSSProperties> = {
  up: { top: 0, left: '33.33%' },
  left: { top: '33.33%', left: 0 },
  right: { top: '33.33%', right: 0 },
  down: { bottom: 0, left: '33.33%' },
};

export interface DPadProps {
  /** Fired with the pressed direction. */
  onPress: (dir: Dir4) => void;
  /** Override the per-direction glyphs (defaults to ▲◀▶▼). */
  glyphs?: Partial<Record<Dir4, string>>;
  /** Pad edge length in px (each button is a third of this). Default 150. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** A 4-way directional pad, anchored bottom-left. */
export function DPad({ onPress, glyphs, size = 150, className, style }: DPadProps) {
  const third = size / 3;
  return (
    <div
      className={className}
      style={{ position: 'absolute', left: INSET_L, bottom: INSET, width: size, height: size, ...style }}
    >
      {DIR4.map((dir) => (
        <button
          key={dir}
          aria-label={dir}
          onPointerDown={press(() => onPress(dir))}
          style={{
            ...btnBase,
            position: 'absolute',
            width: third,
            height: third,
            fontSize: third * 0.42,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...PAD_POS[dir],
          }}
        >
          {glyphs?.[dir] ?? DIR4_GLYPH[dir]}
        </button>
      ))}
    </div>
  );
}

export interface ActionBarProps {
  /** Action buttons, rendered top-to-bottom. */
  actions?: readonly HudAction[];
  /** Optional menu/pause button, rendered at the bottom of the column. */
  menu?: { label?: string; title?: string; onPress: () => void };
  className?: string;
  style?: CSSProperties;
}

/** A right-side, bottom-anchored column of action buttons (+ optional menu). */
export function ActionBar({ actions = [], menu, className, style }: ActionBarProps) {
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        right: INSET_R,
        bottom: INSET,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 10,
        ...style,
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          title={a.title ?? a.label}
          disabled={a.disabled}
          onClick={a.disabled ? undefined : a.onPress}
          style={{
            ...btnBase,
            minHeight: 52,
            padding: '10px 20px',
            opacity: a.disabled ? 0.45 : 1,
            cursor: a.disabled ? 'default' : 'pointer',
            ...(a.primary
              ? {
                  background: 'var(--hud-accent, #e8a84c)',
                  color: 'var(--hud-accent-fg, #3a2a14)',
                  fontWeight: 800,
                }
              : null),
          }}
        >
          {a.label}
        </button>
      ))}
      {menu && (
        <button
          title={menu.title ?? 'Menu'}
          onClick={menu.onPress}
          style={{ ...btnBase, minHeight: 52, padding: '10px 20px' }}
        >
          {menu.label ?? 'Menu'}
        </button>
      )}
    </div>
  );
}

export interface BottomHudProps {
  /** D-pad config; omit to hide the d-pad. */
  dpad?: Omit<DPadProps, 'className' | 'style'>;
  /** Action buttons; omit for none. */
  actions?: readonly HudAction[];
  /** Menu/pause button; omit to hide. */
  menu?: ActionBarProps['menu'];
  /** Class on the full-screen overlay root (a good place to set the theme vars). */
  className?: string;
}

/**
 * The standard mobile bottom bar: a d-pad on the left, an action/menu column on
 * the right, over a non-blocking full-screen overlay (only the buttons capture
 * pointer events, so the game underneath stays interactive).
 */
export function BottomHud({ dpad, actions, menu, className }: BottomHudProps) {
  return (
    <div
      className={className}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {/* Children re-enable pointer events on themselves. */}
      {dpad && <DPad {...dpad} style={{ pointerEvents: 'auto' }} />}
      {(actions?.length || menu) && (
        <ActionBar actions={actions} menu={menu} style={{ pointerEvents: 'auto' }} />
      )}
    </div>
  );
}
