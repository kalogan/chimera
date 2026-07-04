/**
 * dex — CHIMERA's creature compendium (Wave 5): a scrollable grid of every
 * species the player has met, each shown with a small procedural colour
 * swatch (derived straight from its `gooberSpec.baseColor` — no metaball/
 * MarchingCubes render, which would be far too heavy for 20-50 grid cells at
 * once — see `Goober.tsx`/`GooberStage.tsx` for the "real" 3D render used
 * elsewhere), name, family, rank, and DEX STATUS (seen / scouted / owned /
 * bred).
 *
 * Entries come straight from `roster.dex` (`game-kit/roster`'s `DexEntry`
 * map) — the kit's own seen/scouted/bred/owned tracking, not re-derived here.
 * A `DexEntry` doesn't carry the full `CreatureToken` (no `plus`/`parents`
 * beyond lineage ids), so for display we prefer the REAL token from the
 * player's party/storage when the creature is owned (exact stats/name), and
 * fall back to `seedToken(entry.id)` for species only ever seen/scouted in
 * the wild — which is exactly correct for those, since every wild encounter
 * token IS an authored seed token (plus=0, no parents) to begin with.
 */
import { useMemo } from "react";
import { creatureFromToken, seedToken, type Creature, type CreatureToken } from "game-kit/creature";
import type { DexEntry, DexStatus } from "game-kit/roster";
import { audio } from "./audio.js";
import type { GameState } from "./game.js";

const STATUS_LABEL: Record<DexStatus, string> = {
  seen: "Seen",
  scouted: "Scouted",
  owned: "Owned",
  bred: "Bred",
};

// Precedence for sort/badge tinting only (roster.ts owns the real upgrade rule).
const STATUS_ORDER: Record<DexStatus, number> = { bred: 0, owned: 1, scouted: 2, seen: 3 };

function rgbCss([r, g, b]: readonly [number, number, number]): string {
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/** A cheap 2D "swatch" standing in for a goober thumbnail: two soft radial
 *  blobs (base + an accent ball color, if any) on a rounded tile — reads as a
 *  little creature-colored orb without a single WebGL draw call. */
function DexSwatch({ creature }: { creature: Creature }) {
  const base = rgbCss(creature.gooberSpec.baseColor);
  const accent = creature.gooberSpec.balls.find((b) => b.color !== creature.gooberSpec.baseColor)?.color;
  const accentCss = accent ? rgbCss(accent) : base;
  return (
    <div
      className="dex-swatch"
      style={{
        background: `radial-gradient(circle at 32% 30%, ${accentCss}, ${base} 65%)`,
      }}
      aria-hidden
    />
  );
}

interface DexRow {
  entry: DexEntry;
  creature: Creature;
}

/** Resolve the best-available token for a dex entry: the real owned token if
 *  the player has it (party or storage), else a reconstructed seed token. */
function resolveToken(entry: DexEntry, owned: CreatureToken[]): CreatureToken {
  return owned.find((t) => t.id === entry.id) ?? seedToken(entry.id);
}

function buildRows(game: GameState): DexRow[] {
  const owned = [...game.roster.party, ...game.roster.storage];
  const entries = Object.values(game.roster.dex);
  const rows: DexRow[] = entries.map((entry) => ({
    entry,
    creature: creatureFromToken(resolveToken(entry, owned)),
  }));
  rows.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.entry.status] - STATUS_ORDER[b.entry.status];
    if (byStatus !== 0) return byStatus;
    return a.creature.name.localeCompare(b.creature.name);
  });
  return rows;
}

export function DexScreen({ game, onBack }: { game: GameState; onBack: () => void }) {
  const rows = useMemo(() => buildRows(game), [game]);

  return (
    <div className="overlay dex-screen">
      <div className="banner">
        <div>
          <div className="title">The Dex</div>
          <div className="subtitle">Every companion you've met, befriended, or woven into being.</div>
        </div>
        <div className="dex">{rows.length} discovered</div>
      </div>
      <div className="dex-grid">
        {rows.length === 0 && (
          <div className="hint" style={{ padding: 16 }}>
            Nothing seen yet — head out and meet some goobers.
          </div>
        )}
        {rows.map(({ entry, creature }) => (
          <div key={entry.id} className={`dex-card dex-${entry.status}`}>
            <DexSwatch creature={creature} />
            <div className="dex-info">
              <div className="dex-name">{creature.name}</div>
              <div className="hint">{creature.family} · rank {creature.rank}</div>
              <div className={`dex-badge dex-badge-${entry.status}`}>{STATUS_LABEL[entry.status]}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="actionbar">
        <button className="act" onClick={() => { audio().playUi("back"); onBack(); }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
