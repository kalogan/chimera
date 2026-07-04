/**
 * field-menu — CHIMERA's old-school (DQM-style) FIELD MENU: a command +
 * party-stats overlay layered over the map (town/zone), NOT a full-screen
 * route. Reuses the same `paused` gate App.tsx already threads through
 * town/zone movement — this component is just what renders while paused on
 * the field (see App.tsx's swap: town/zone → FieldMenu, battle → PauseOverlay).
 *
 * STYLE: warm parchment (matches .panel/.act chrome + --panel/--warm/
 * --warm-deep/--parchment/--ink/--bond tokens in styles.css) with a retro
 * NOD — chunkier framed double borders + a monospace stat readout (NOT a full
 * pixel reskin). Reuses creature-dex.ts's ELEMENT_COLOR/RARITY_COLOR/
 * FAMILY_COLOR so badges match the Dex (that file stays READ-ONLY).
 *
 * Sub-views (internal state, no new Screen/route):
 *   menu (top level) -> status (per-goober full page) | items (bag) | settings
 * Esc closes the current sub-view, or calls onClose at the top level — capture-
 * phase + stopPropagation, mirroring shell/pause.tsx, so App's own Esc→pause
 * listener never double-fires while this overlay is up.
 */
import { useEffect, useState } from "react";
import type { Creature, Element } from "game-kit/creature";
import { itemDef } from "game-kit/economy";
import { audio } from "./audio.js";
import { saveGame } from "./save.js";
import { SettingsPanel } from "./shell/settings.js";
import { ELEMENT_COLOR, RANK_RARITY, RARITY_COLOR, FAMILY_COLOR } from "./creature-dex.js";
import { partyCreatures, type GameState } from "./game.js";
import "./field-menu.css";

export interface FieldMenuProps {
  game: GameState;
  setGame: (g: GameState) => void;
  onClose: () => void;
  onReturnToTitle: () => void;
}

type SubView = "menu" | "status" | "items" | "settings";

// `setGame` is part of the required prop contract (App.tsx wires it through
// unconditionally, matching FieldMenu's spec'd signature) but this component
// is currently read-only against `game` — Save/Items/Party/Status/Settings
// all just READ state; nothing here mutates the roster/economy in place. Kept
// in the signature (not dropped) so a future write-path (e.g. an in-field
// item action) can adopt it without a prop-shape change; prefixed per the
// existing `_onMove`-style convention (town-scene.tsx) to satisfy
// noUnusedParameters.
export function FieldMenu({ game, setGame: _setGame, onClose, onReturnToTitle }: FieldMenuProps) {
  const [view, setView] = useState<SubView>("menu");
  const [statusId, setStatusId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const party = partyCreatures(game);

  const backToMenu = () => { setView("menu"); setStatusId(null); };

  // Esc: close the current sub-view, or Resume at the top level. Capture +
  // stopPropagation so App's own Esc listener (which opens `paused`) doesn't
  // also see this keypress — mirrors shell/pause.tsx exactly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      if (view !== "menu") {
        audio().playUi("back");
        backToMenu();
      } else {
        audio().playUi("back");
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, onClose]);

  const openStatus = (tokenId: string) => {
    audio().playUi("select");
    setStatusId(tokenId);
    setView("status");
  };

  const doSave = () => {
    audio().playUi("confirm");
    saveGame(game);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1400);
  };

  const statusCreature = statusId ? party.find((c) => c.token.id === statusId) ?? null : null;

  return (
    <div className="overlay fieldmenu-dock">
      <div className="fieldmenu-gold" title="Gold">
        ◈ <span className="fieldmenu-mono">{game.economy.gold}</span>
      </div>

      {view === "menu" && (
        <FieldMenuHome
          game={game}
          party={party}
          onOpenParty={() => {
            audio().playUi("select");
            if (party[0]) openStatus(party[0].token.id);
          }}
          onOpenRow={openStatus}
          onOpenItems={() => { audio().playUi("select"); setView("items"); }}
          onSave={doSave}
          savedFlash={savedFlash}
          onSettings={() => { audio().playUi("select"); setView("settings"); }}
          onReturnToTitle={() => { audio().playUi("back"); onReturnToTitle(); }}
          onClose={() => { audio().playUi("back"); onClose(); }}
        />
      )}

      {view === "status" && statusCreature && (
        <StatusPage
          creature={statusCreature}
          party={party}
          onPick={openStatus}
          onBack={backToMenu}
        />
      )}

      {view === "items" && <ItemsBag game={game} onBack={backToMenu} />}

      {view === "settings" && <SettingsPanel onClose={backToMenu} />}
    </div>
  );
}

// ── The top-level menu: command grid + party strip ─────────────────────────

function FieldMenuHome({
  game,
  party,
  onOpenParty,
  onOpenRow,
  onOpenItems,
  onSave,
  savedFlash,
  onSettings,
  onReturnToTitle,
  onClose,
}: {
  game: GameState;
  party: Creature[];
  onOpenParty: () => void;
  onOpenRow: (tokenId: string) => void;
  onOpenItems: () => void;
  onSave: () => void;
  savedFlash: boolean;
  onSettings: () => void;
  onReturnToTitle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fieldmenu-panel">
      <div className="fieldmenu-head">
        <h2>Field Menu</h2>
        <button className="act close" onClick={onClose} title="Resume (Esc)">✕</button>
      </div>

      <div className="fieldmenu-grid">
        <button className="fieldmenu-cmd" onClick={onOpenParty} disabled={party.length === 0}>
          Party
        </button>
        <button className="fieldmenu-cmd" onClick={onOpenItems}>Items</button>
        <button className="fieldmenu-cmd" onClick={onSave}>
          {savedFlash ? "Saved ✓" : "Save"}
        </button>
        <button className="fieldmenu-cmd" onClick={onSettings}>Settings</button>
        <button className="fieldmenu-cmd fieldmenu-cmd-warn" onClick={onReturnToTitle}>
          Return to Title
        </button>
        <button className="fieldmenu-cmd fieldmenu-cmd-primary" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="fieldmenu-partystrip">
        {party.length === 0 && <div className="hint">No companions in your party.</div>}
        {party.map((c) => (
          <button key={c.token.id} className="fieldmenu-row" onClick={() => onOpenRow(c.token.id)}>
            <span className="fieldmenu-row-name">{c.name}</span>
            <RankBadge rank={c.rank} />
            <span className="fieldmenu-row-stats">
              <span className="fieldmenu-mono fieldmenu-hp">HP {c.stats.hp}</span>
              <span className="fieldmenu-mono fieldmenu-mp">MP {c.stats.mp}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="hint fieldmenu-hint">◈ {game.economy.gold} gold · Esc to close</div>
    </div>
  );
}

function RankBadge({ rank }: { rank: Creature["rank"] }) {
  const color = RARITY_COLOR[RANK_RARITY[rank]];
  return (
    <span className="fieldmenu-rankbadge fieldmenu-mono" style={{ borderColor: color, color }}>
      {rank}
    </span>
  );
}

function ElementBadge({ element }: { element: Element }) {
  return (
    <span className="fieldmenu-elembadge" style={{ color: ELEMENT_COLOR[element], borderColor: ELEMENT_COLOR[element] }}>
      {element}
    </span>
  );
}

// ── Full status page (drill-down from a party row) ──────────────────────────

const STAT_ROWS: { key: keyof Creature["stats"]; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "mp", label: "MP" },
  { key: "atk", label: "ATK" },
  { key: "def", label: "DEF" },
  { key: "agi", label: "AGI" },
  { key: "wis", label: "WIS" },
];

function StatusPage({
  creature,
  party,
  onPick,
  onBack,
}: {
  creature: Creature;
  party: Creature[];
  onPick: (tokenId: string) => void;
  onBack: () => void;
}) {
  const maxStat = Math.max(creature.stats.hp, creature.stats.mp, 60);
  const familyColor = FAMILY_COLOR[creature.family];
  const parentIds = creature.token.parents;
  // Parents may be storage members, not necessarily current party — resolve
  // names from whatever's on hand (party is all we have here); fall back to
  // a generic label rather than guessing at storage lookups this view lacks.
  const parentNames = (parentIds ?? []).map(
    (id) => party.find((p) => p.token.id === id)?.name ?? "a lost companion",
  );

  return (
    <div className="fieldmenu-panel fieldmenu-status">
      <div className="fieldmenu-head">
        <h2>{creature.name}</h2>
        <button className="act close" onClick={onBack} title="Back (Esc)">✕</button>
      </div>

      {/* Quick-switch tabs when there's more than one party member. */}
      {party.length > 1 && (
        <div className="fieldmenu-tabs">
          {party.map((c) => (
            <button
              key={c.token.id}
              className={`fieldmenu-tab ${c.token.id === creature.token.id ? "on" : ""}`}
              onClick={() => onPick(c.token.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="fieldmenu-status-badges">
        <span className="dex-badge2" style={{ background: familyColor }}>{creature.family}</span>
        <RankBadge rank={creature.rank} />
        {creature.elements.map((e) => <ElementBadge key={e} element={e} />)}
      </div>

      <div className="fieldmenu-section-title">Stats</div>
      {STAT_ROWS.map(({ key, label }) => (
        <div key={key} className="fieldmenu-stat-row">
          <div className="fieldmenu-stat-label">{label}</div>
          <div className="bar fieldmenu-stat-bar">
            <i style={{ width: `${Math.max(0, Math.min(100, (creature.stats[key] / maxStat) * 100))}%` }} />
          </div>
          <div className="fieldmenu-mono fieldmenu-stat-value">{creature.stats[key]}</div>
        </div>
      ))}

      <div className="fieldmenu-section-title">Skills</div>
      <div className="fieldmenu-skills">
        {creature.skills.length === 0 && <div className="hint">No skills known.</div>}
        {creature.skills.map((s) => (
          <div key={s.id} className="fieldmenu-skill">
            <span>{s.name}</span>
            <span className="fieldmenu-mono">{s.mpCost}mp</span>
          </div>
        ))}
      </div>

      <div className="fieldmenu-section-title">Bloodline</div>
      <div className="hint">
        Generation {creature.token.generation}
        {creature.token.plus > 0 ? ` · +${creature.token.plus}` : ""}
        {parentIds ? ` · woven from ${parentNames.join(" + ")}` : " · an authored companion"}
      </div>
    </div>
  );
}

// ── Items bag (view-only) ───────────────────────────────────────────────────

function ItemsBag({ game, onBack }: { game: GameState; onBack: () => void }) {
  const entries = Object.entries(game.economy.items).filter(([, count]) => count > 0);
  return (
    <div className="fieldmenu-panel fieldmenu-items">
      <div className="fieldmenu-head">
        <h2>Items</h2>
        <button className="act close" onClick={onBack} title="Back (Esc)">✕</button>
      </div>
      {entries.length === 0 ? (
        <div className="hint">Your bag is empty.</div>
      ) : (
        <div className="fieldmenu-itemlist">
          {entries.map(([id, count]) => {
            const def = itemDef(id);
            if (!def) return null;
            return (
              <div key={id} className="fieldmenu-item-row">
                <div className="fieldmenu-item-info">
                  <div className="fieldmenu-item-name">{def.name}</div>
                  <div className="hint">{def.desc}</div>
                </div>
                <div className="fieldmenu-mono fieldmenu-item-count">&times;{count}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
