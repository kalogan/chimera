/**
 * dex — CHIMERA's creature compendium (Polymatrix-style bestiary), rebuilt
 * MOBILE-FIRST: a responsive card grid you tap into a details view (a
 * full-screen overlay on narrow phones, a 62/38 side panel on wide screens —
 * mirroring Polymatrix's BestiaryHUD split).
 *
 * Entries still come straight from `roster.dex` (`game-kit/roster`'s
 * `DexEntry` map) — the kit's own seen/scouted/bred/owned tracking, not
 * re-derived here. A `DexEntry` doesn't carry the full `CreatureToken`, so we
 * prefer the REAL token from the player's party/storage when owned, and fall
 * back to `seedToken(entry.id)` for species only ever seen/scouted in the
 * wild (every wild encounter token IS an authored seed token to begin with).
 *
 * The extra bestiary fields (rarity/title/lore/habitat/drops/matchups) are
 * DERIVED, never authored, via `./creature-dex.js` — see that module for how
 * they're computed from the token/family/rank/elements.
 *
 * PERF: the grid renders CHEAP 2D swatches (a radial-gradient div), never a
 * live Canvas per card — we just fixed mobile perf and a grid of 20-50 R3F
 * canvases would undo that instantly. The single selected creature in the
 * details view is the only place a real goober (GooberStage) is mounted.
 */
import { useMemo, useState } from "react";
import { creatureFromToken, seedToken, type Creature, type CreatureToken, type Element } from "game-kit/creature";
import type { DexEntry, DexStatus } from "game-kit/roster";
import { deriveDex, ELEMENT_COLOR, type DerivedDex } from "./creature-dex.js";
import { GooberStage } from "./GooberStage.js";
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

/** Only entries at this status or below get full detail — species merely
 *  "seen" in the wild stay a locked silhouette, like Polymatrix's bestiary. */
const LOCKED_STATUSES = new Set<DexStatus>(["seen"]);

const FAMILY_OPTIONS = ["beast", "bird", "dragon", "slime", "aquatic", "nature", "golem", "spirit"] as const;
const RARITY_OPTIONS = ["common", "uncommon", "rare", "epic", "legendary"] as const;
const STATUS_OPTIONS: DexStatus[] = ["seen", "scouted", "owned", "bred"];

function rgbCss([r, g, b]: readonly [number, number, number]): string {
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/** Deterministic "?????" placeholder for a locked/unseen-detail name — same
 *  length as the real name, so the silhouette reads as "a name-shaped
 *  redaction" rather than a fixed generic string. */
function scramble(name: string): string {
  return "?".repeat(Math.max(4, name.length));
}

/** A cheap 2D "swatch" standing in for a goober thumbnail: two soft radial
 *  blobs (base + an accent ball color, if any) on a rounded tile — reads as a
 *  little creature-colored orb without a single WebGL draw call. Used in the
 *  GRID (perf-critical); the details view uses a real GooberStage instead. */
function DexSwatch({ creature, locked }: { creature: Creature; locked: boolean }) {
  const base = rgbCss(creature.gooberSpec.baseColor);
  const accent = creature.gooberSpec.balls.find((b) => b.color !== creature.gooberSpec.baseColor)?.color;
  const accentCss = accent ? rgbCss(accent) : base;
  return (
    <div
      className={`dex-swatch${locked ? " dex-swatch-locked" : ""}`}
      style={locked ? undefined : { background: `radial-gradient(circle at 32% 30%, ${accentCss}, ${base} 65%)` }}
      aria-hidden
    />
  );
}

interface DexRow {
  entry: DexEntry;
  creature: Creature;
  derived: DerivedDex;
  locked: boolean;
}

/** Resolve the best-available token for a dex entry: the real owned token if
 *  the player has it (party or storage), else a reconstructed seed token. */
function resolveToken(entry: DexEntry, owned: CreatureToken[]): CreatureToken {
  return owned.find((t) => t.id === entry.id) ?? seedToken(entry.id);
}

function buildRows(game: GameState): DexRow[] {
  const owned = [...game.roster.party, ...game.roster.storage];
  const entries = Object.values(game.roster.dex);
  const rows: DexRow[] = entries.map((entry) => {
    const creature = creatureFromToken(resolveToken(entry, owned));
    return { entry, creature, derived: deriveDex(creature), locked: LOCKED_STATUSES.has(entry.status) };
  });
  rows.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.entry.status] - STATUS_ORDER[b.entry.status];
    if (byStatus !== 0) return byStatus;
    return a.creature.name.localeCompare(b.creature.name);
  });
  return rows;
}

function ElementPill({ element }: { element: Element }) {
  return (
    <span className="dex-elem-pill" style={{ color: ELEMENT_COLOR[element], borderColor: ELEMENT_COLOR[element] }}>
      {element}
    </span>
  );
}

function StatBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="dex-stat-row">
      <div className="dex-stat-label">{label}</div>
      <div className="bar dex-stat-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="dex-stat-value">{value}</div>
    </div>
  );
}

/** The rich details body shared by both the mobile overlay and the desktop
 *  side panel — only its wrapper chrome differs by layout. */
function DexDetails({ row }: { row: DexRow }) {
  const { entry, creature, derived, locked } = row;
  const maxStat = Math.max(creature.stats.hp, creature.stats.mp, 60);

  return (
    <div className="dex-details-body">
      <div className="dex-details-stage">
        <GooberStage
          placed={[{ id: creature.token.id, spec: creature.gooberSpec, position: [0, 0, 0] }]}
          cameraPos={[0, 3, 9]}
          fov={32}
        />
        {locked && <div className="dex-stage-veil" aria-hidden />}
      </div>

      <div className="dex-details-id">#{entry.id.slice(0, 8)}</div>
      <div className="dex-details-name">{locked ? scramble(creature.name) : creature.name}</div>
      {!locked && <div className="dex-details-title">{derived.title}</div>}

      <div className="dex-details-badges">
        <span className="dex-badge2" style={{ background: derived.familyColor }}>
          {creature.family}
        </span>
        <span className="dex-badge2" style={{ background: derived.rarityColor }}>
          {derived.rarity}
        </span>
        <span className={`dex-badge dex-badge-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
      </div>

      {locked ? (
        <div className="hint dex-locked-hint">Encounter this creature in the wild to learn more.</div>
      ) : (
        <>
          <div className="dex-section">
            <div className="dex-section-title">Matchups</div>
            <div className="dex-matchup-row">
              <span className="dex-matchup-label">Weak to</span>
              {derived.matchups.weakTo.length === 0 ? (
                <span className="hint">—</span>
              ) : (
                derived.matchups.weakTo.map((e) => <ElementPill key={e} element={e} />)
              )}
            </div>
            <div className="dex-matchup-row">
              <span className="dex-matchup-label">Resists</span>
              {derived.matchups.resists.length === 0 ? (
                <span className="hint">—</span>
              ) : (
                derived.matchups.resists.map((e) => <ElementPill key={e} element={e} />)
              )}
            </div>
          </div>

          <div className="dex-section">
            <div className="dex-section-title">Ecology</div>
            <div className="dex-eco-row">
              <span className="dex-eco-label">Habitat</span>
              <span>{derived.habitat}</span>
            </div>
            <div className="dex-eco-row">
              <span className="dex-eco-label">Drops</span>
              <span>{derived.drops.join(", ")}</span>
            </div>
          </div>

          <div className="dex-section">
            <div className="dex-section-title">Lore</div>
            <div className="dex-lore">{derived.flavorText}</div>
          </div>

          <div className="dex-section">
            <div className="dex-section-title">Base stats</div>
            <StatBar label="HP" value={creature.stats.hp} max={maxStat} />
            <StatBar label="MP" value={creature.stats.mp} max={maxStat} />
            <StatBar label="ATK" value={creature.stats.atk} max={maxStat} />
            <StatBar label="DEF" value={creature.stats.def} max={maxStat} />
            <StatBar label="AGI" value={creature.stats.agi} max={maxStat} />
            <StatBar label="WIS" value={creature.stats.wis} max={maxStat} />
          </div>
        </>
      )}
    </div>
  );
}

export function DexScreen({ game, onBack }: { game: GameState; onBack: () => void }) {
  const rows = useMemo(() => buildRows(game), [game]);

  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<string>("all");
  const [rarity, setRarity] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ entry, creature, derived }) => {
      if (q && !creature.name.toLowerCase().includes(q) && !entry.id.toLowerCase().includes(q)) return false;
      if (family !== "all" && creature.family !== family) return false;
      if (rarity !== "all" && derived.rarity !== rarity) return false;
      if (status !== "all" && entry.status !== status) return false;
      return true;
    });
  }, [rows, search, family, rarity, status]);

  const selected = selectedId ? rows.find((r) => r.entry.id === selectedId) ?? null : null;

  const openCard = (id: string) => {
    audio().playUi("select");
    setSelectedId(id);
  };
  const closeDetails = () => {
    audio().playUi("back");
    setSelectedId(null);
  };

  return (
    <div className="overlay dex-screen">
      <div className="banner">
        <div>
          <div className="title">The Dex</div>
          <div className="subtitle">Every companion you've met, befriended, or woven into being.</div>
        </div>
        <div className="dex">{rows.length} discovered</div>
      </div>

      <div className="dex-filterbar">
        <input
          className="dex-search"
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="dex-select" value={family} onChange={(e) => setFamily(e.target.value)}>
          <option value="all">All families</option>
          {FAMILY_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select className="dex-select" value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="all">All rarities</option>
          {RARITY_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select className="dex-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className={`dex-body${selected ? " dex-body-split" : ""}`}>
        <div className="dex-grid">
          {filtered.length === 0 && (
            <div className="hint" style={{ padding: 16 }}>
              {rows.length === 0 ? "Nothing seen yet — head out and meet some goobers." : "No creatures match your filters."}
            </div>
          )}
          {filtered.map((row) => {
            const { entry, creature, derived, locked } = row;
            const isSelected = entry.id === selectedId;
            return (
              <button
                key={entry.id}
                type="button"
                className={`dex-card dex-${entry.status}${isSelected ? " dex-card-selected" : ""}`}
                style={{ ["--dex-rarity" as string]: derived.rarityColor }}
                onClick={() => openCard(entry.id)}
              >
                <DexSwatch creature={creature} locked={locked} />
                <div className="dex-info">
                  <div className="dex-name">{locked ? scramble(creature.name) : creature.name}</div>
                  <div className="hint">
                    {locked ? "???" : creature.family} · rank {locked ? "?" : creature.rank}
                  </div>
                  <div className={`dex-badge dex-badge-${entry.status}`}>{STATUS_LABEL[entry.status]}</div>
                </div>
                <div className="dex-rarity-strip" style={{ background: locked ? undefined : derived.rarityColor }} />
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="dex-details-panel">
            <div className="dex-details-head">
              <div className="dex-details-head-title">Details</div>
              <button className="act close dex-details-close" onClick={closeDetails} aria-label="Close details">
                ✕
              </button>
            </div>
            <DexDetails row={selected} />
          </div>
        )}
      </div>

      <div className="actionbar">
        <button className="act" onClick={() => { audio().playUi("back"); onBack(); }}>
          ← Back
        </button>
      </div>
    </div>
  );
}
