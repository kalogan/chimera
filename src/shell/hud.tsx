/**
 * CHIMERA — the shared HUD chrome: a cohesive top bar (title/subtitle + Dex/
 * party/box counters) plus a small party name-strip, used across the Sanctuary
 * and Meadowmere screens. Elevates the old ad hoc `.banner` markup that used to
 * live duplicated in App.tsx into one component so every screen reads as the
 * same polished shell. A DOM overlay OUTSIDE the Canvas (the established
 * pattern) — this never touches game.ts or the Screen router.
 *
 * Mobile: on narrow viewports (see `.hud-top` media query in styles.css) the
 * subtitle is hidden and the title shrinks so the stats pill + button cluster
 * never get crowded — see the CONTEXT notes in the mobile-HUD task that added
 * `onSettings` + the `⚙` gear alongside the existing `⏸` pause button.
 */
import type { Creature } from "game-kit/creature";
import { audio } from "../audio.js";

export interface HudBarProps {
  title: string;
  subtitle?: string;
  dexText: string;
  /** Party members to show as small name/rank chips (Sanctuary/Meadowmere). */
  party?: Creature[];
  /** Show the single ☰ menu button — opens the pause menu (Resume · Settings ·
   *  Return to Title), the merged home for what used to be separate ⏸ + ⚙ icons.
   *  Omit on screens that host their own menu button (the walkable Town/Zone put
   *  it in the bottom-right thumb cluster instead). */
  onMenu?: () => void;
}

export function HudBar({ title, subtitle, dexText, party, onMenu }: HudBarProps) {
  return (
    <div className="hud-top">
      <div className="banner">
        <div className="hud-titles">
          <div className="title">{title}</div>
          {subtitle && <div className="subtitle">{subtitle}</div>}
        </div>
        <div className="hud-right">
          <div className="dex">{dexText}</div>
          {onMenu && (
            <button
              className="hud-pause"
              aria-label="Menu"
              title="Menu (Esc)"
              onClick={() => { audio().playUi("select"); onMenu(); }}
            >
              ☰
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
