/**
 * title — the studio-ident + title-screen DOM views (react). Named `r3f.tsx` to
 * match the kit's "React view" slot; the views are plain DOM (no three).
 *
 *  - <StudioIdent>  — a skippable, wall-clock-timed brand ident. You nest your
 *                     brand art as children (self-animating via its own CSS, the
 *                     way CHIMERA's SVG goober does); the kit owns the timing,
 *                     the skip affordance, the audio-cue hook, reduced-motion,
 *                     and the fade → onDone hand-off.
 *  - <TitleScreen>  — a title over a slotted backdrop: wordmark + subtitle + a
 *                     list of menu options, with a mount fade-in and a
 *                     select→fade-out→handler flow, plus a first-gesture hook to
 *                     unlock audio.
 *
 * All brand/content (wordmark, art, backdrop, colors, which options) is props;
 * the flow logic is the kit. Requires the react peer dep (optional).
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { DEFAULT_IDENT_TIMING, type IdentTiming, type MenuOption } from './index.js';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const fullscreen: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const skipBtn: CSSProperties = {
  position: 'absolute',
  right: 'calc(16px + env(safe-area-inset-right, 0px))',
  bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
  minHeight: 40,
  padding: '8px 16px',
  border: 'none',
  borderRadius: 999,
  cursor: 'pointer',
  background: 'var(--title-skip-bg, rgba(247,239,226,0.7))',
  color: 'var(--title-skip-fg, #6b4a30)',
  font: 'inherit',
  fontSize: 13,
  letterSpacing: '0.06em',
};

export interface StudioIdentProps {
  /** Brand wordmark (e.g. "WOVENWILD"). */
  wordmark: string;
  /** Small tagline under the wordmark (e.g. "games"). */
  tagline?: string;
  /** Brand art (SVG/anything), centered above the wordmark. Bring your own CSS
   *  animation — the kit doesn't drive per-frame progress (so it runs even in a
   *  backgrounded tab, like CSS keyframes do). */
  children?: ReactNode;
  /** Timing (defaults to DEFAULT_IDENT_TIMING). */
  timing?: Partial<IdentTiming>;
  /** Fired once when the ident finishes or is skipped — hand off to the title. */
  onDone: () => void;
  /** Fired once at `timing.cueMs` (e.g. a soft chime as the mark reads as alive).
   *  Safe if the AudioContext is still suspended on a cold first load (no-op). */
  onCue?: () => void;
  /** CSS background for the ident (color or gradient). */
  background?: string;
  /** Wordmark color. */
  wordmarkColor?: string;
  /** Respect prefers-reduced-motion (skip the fade). Default true. */
  respectReducedMotion?: boolean;
}

/** A skippable, wall-clock-timed studio ident. */
export function StudioIdent({
  wordmark,
  tagline,
  children,
  timing,
  onDone,
  onCue,
  background = 'radial-gradient(circle at 50% 42%, #fbf3e2 0%, #efe0c2 58%, #e4d0a8 100%)',
  wordmarkColor = '#c9762e',
  respectReducedMotion = true,
}: StudioIdentProps) {
  const durationMs = timing?.durationMs ?? DEFAULT_IDENT_TIMING.durationMs;
  const cueMs = timing?.cueMs ?? DEFAULT_IDENT_TIMING.cueMs;
  const reduced = respectReducedMotion && prefersReducedMotion();

  const doneRef = useRef(false);
  const [opacity, setOpacity] = useState(reduced ? 1 : 0);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Wall-clock hand-off + cue — fire even if the tab is backgrounded (rAF wouldn't).
  useEffect(() => {
    const timers: number[] = [];
    if (!reduced) {
      timers.push(window.setTimeout(() => setOpacity(1), 20)); // fade in
      timers.push(window.setTimeout(() => setOpacity(0), Math.max(0, durationMs - 400))); // fade out
    }
    timers.push(window.setTimeout(finish, durationMs));
    if (onCue) {
      const cued = { done: false };
      timers.push(
        window.setTimeout(() => {
          if (cued.done) return;
          cued.done = true;
          onCue();
        }, cueMs),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onPointerDown={finish}
      style={{ ...fullscreen, zIndex: 100, background, opacity, transition: reduced ? undefined : 'opacity 400ms ease' }}
    >
      {children}
      <div style={{ textAlign: 'center', marginTop: 24, pointerEvents: 'none' }}>
        <div
          style={{
            fontSize: 'clamp(30px, 10vw, 60px)',
            fontWeight: 800,
            letterSpacing: '0.16em',
            color: wordmarkColor,
            textShadow: '0 2px 0 rgba(255,255,255,0.6), 0 8px 22px rgba(43,36,64,0.18)',
          }}
        >
          {wordmark}
        </div>
        {tagline && (
          <div
            style={{
              marginTop: 8,
              fontSize: 'clamp(11px, 3.4vw, 15px)',
              letterSpacing: '0.5em',
              textTransform: 'uppercase',
              color: '#8a6a3f',
              opacity: 0.75,
            }}
          >
            {tagline}
          </div>
        )}
      </div>
      <button style={skipBtn} onClick={(e) => { e.stopPropagation(); finish(); }}>
        skip ›
      </button>
    </div>
  );
}

export interface TitleScreenProps {
  /** Full-screen visual behind the overlay (a <Canvas>, a CSS motif, an <img>). */
  backdrop?: ReactNode;
  /** Game wordmark (e.g. "CHIMERA"). */
  title: string;
  /** One-line premise under the title. */
  subtitle?: string;
  /** Menu options, top to bottom (typically 2–4). */
  options: readonly MenuOption[];
  /** Wordmark color. */
  titleColor?: string;
  /** Mount fade-in duration (ms). Default 800. */
  fadeInMs?: number;
  /** Leave fade-out duration (ms). Default 240. */
  fadeOutMs?: number;
  /** Delay after an option is chosen before its handler runs (lets the fade +
   *  any confirm audio play). Default 260. */
  leaveDelayMs?: number;
  /** Fired once on the first pointer gesture — unlock audio / start title music. */
  onFirstGesture?: () => void;
  /** Fired when any option is chosen, before the fade (e.g. a confirm sfx). */
  onSelect?: (option: MenuOption) => void;
  className?: string;
}

/** A title screen: a slotted backdrop + wordmark + subtitle + a menu of options. */
export function TitleScreen({
  backdrop,
  title,
  subtitle,
  options,
  titleColor = '#c9762e',
  fadeInMs = 800,
  fadeOutMs = 240,
  leaveDelayMs = 260,
  onFirstGesture,
  onSelect,
  className,
}: TitleScreenProps) {
  const [opacity, setOpacity] = useState(0);
  const leaving = useRef(false);
  const gestured = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => setOpacity(1), 20);
    return () => window.clearTimeout(t);
  }, []);

  const firstGesture = () => {
    if (gestured.current) return;
    gestured.current = true;
    onFirstGesture?.();
  };

  const choose = (opt: MenuOption) => {
    if (leaving.current || opt.disabled) return;
    onSelect?.(opt);
    // Non-leaving options (e.g. Settings) open something over the title — run
    // immediately, no fade, and stay so the player can come back.
    if (opt.leaves === false) {
      opt.onSelect();
      return;
    }
    leaving.current = true;
    setOpacity(0);
    window.setTimeout(opt.onSelect, leaveDelayMs);
  };

  return (
    <div
      className={className}
      onPointerDown={firstGesture}
      style={{ ...fullscreen, justifyContent: 'flex-end', opacity, transition: `opacity ${opacity ? fadeInMs : fadeOutMs}ms ease` }}
    >
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>{backdrop}</div>
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: '10vh', padding: 16 }}>
        <div
          style={{
            fontSize: 'clamp(40px, 13vw, 84px)',
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: titleColor,
            textShadow: '0 2px 0 rgba(255,255,255,0.5), 0 10px 30px rgba(43,36,64,0.22)',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ marginTop: 10, fontStyle: 'italic', color: '#6b5a44', fontSize: 'clamp(13px, 3.6vw, 18px)' }}>
            {subtitle}
          </div>
        )}
        <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {options.map((opt) => (
            <button
              key={opt.label}
              disabled={opt.disabled}
              onClick={() => choose(opt)}
              style={{
                appearance: 'none',
                border: '1px solid rgba(60,45,30,0.18)',
                borderRadius: 'var(--title-btn-radius, 14px)',
                padding: '14px 26px',
                minHeight: 52,
                font: 'inherit',
                fontWeight: opt.primary ? 800 : 600,
                cursor: opt.disabled ? 'default' : 'pointer',
                opacity: opt.disabled ? 0.45 : 1,
                touchAction: 'none',
                userSelect: 'none',
                boxShadow: '0 3px 10px rgba(43,36,64,0.16)',
                background: opt.primary ? 'var(--title-accent, #e8a84c)' : 'var(--title-btn-bg, rgba(247,239,226,0.92))',
                color: opt.primary ? 'var(--title-accent-fg, #3a2a14)' : 'var(--title-btn-fg, #4a3a24)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
