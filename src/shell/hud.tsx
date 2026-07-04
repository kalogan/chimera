/**
 * CHIMERA — the shared HUD chrome: a cohesive top bar (title/subtitle + Dex/
 * party/box counters) plus a small party name-strip, used across the Sanctuary
 * and Meadowmere screens. Elevates the old ad hoc `.banner` markup that used to
 * live duplicated in App.tsx into one component so every screen reads as the
 * same polished shell. A DOM overlay OUTSIDE the Canvas (the established
 * pattern) — this never touches game.ts or the Screen router.
 */
import type { Creature } from "game-kit/creature";
import { audio } from "../audio.js";

export interface HudBarProps {
  title: string;
  subtitle?: string;
  dexText: string;
  /** Party members to show as small name/rank chips (Sanctuary/Meadowmere). */
  party?: Creature[];
  /** Show the touch pause (⏸) button — omit on screens with no pause (e.g. reveal). */
  onPause?: () => void;
}

export function HudBar({ title, subtitle, dexText, party, onPause }: HudBarProps) {
  return (
    <div className="hud-top">
      <div className="banner">
        <div>
          <div className="title">{title}</div>
          {subtitle && <div className="subtitle">{subtitle}</div>}
        </div>
        <div className="hud-right">
          <div className="dex">{dexText}</div>
          {onPause && (
            <button
              className="hud-pause"
              aria-label="Pause"
              title="Pause (Esc)"
              onClick={() => { audio().playUi("select"); onPause(); }}
            >
              ⏸
            </button>
          )}
        </div>
      </div>
      {party && party.length > 0 && (
        <div className="hud-party-strip">
          {party.map((c) => (
            <div key={c.token.id} className="hud-party-chip">
              <span className="hud-party-name">{c.name}</span>
              <span className="hud-party-rank">{c.rank}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
