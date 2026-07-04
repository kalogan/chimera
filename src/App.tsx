import { useEffect, useMemo, useRef, useState } from "react";
import { creatureFromToken } from "game-kit/creature";
import type { BattleState, Combatant } from "game-kit/battle";
import type { Dir } from "game-kit/world-runtime";
import { GooberStage, type Placed } from "./GooberStage.js";
import { ZoneScene } from "./ZoneScene.js";
import { specForToken } from "./goober-cache.js";
import { DexScreen } from "./dex.js";
import { audio, resumeAudio } from "./audio.js";
import { playBattleEvents } from "./battle-audio.js";
import { Splash } from "./shell/splash.js";
import { PauseOverlay } from "./shell/pause.js";
import { SettingsPanel } from "./shell/settings.js";
import { HudBar } from "./shell/hud.js";
import { itemDef, shopFor, SELL_FRACTION } from "game-kit/economy";
import { ZONE_LABELS } from "./zone.js";
import { hasSave, loadGame } from "./save.js";
import { TownScene } from "./town-scene.js";
import { TownDialogue } from "./town-dialogue.js";
import { villagerById, TOWN_DIRECTION_DELTA, type TownAction, type TownDirection } from "./town.js";
import { TradeScreen } from "./trade.js";
import { progressOf } from "game-kit/quest";
import {
  newGame,
  applySave,
  partyCreatures,
  collectionCreatures,
  dexTotal,
  enterZone,
  zoneStep,
  startEncounterWith,
  startRivalBattle,
  returnToZone,
  travelPortal,
  activeActor,
  defaultTargetId,
  stepBattle,
  leaveBattle,
  openCradle,
  togglePick,
  breedPicked,
  backToParty,
  openShop,
  openDex,
  buyItem,
  sellItem,
  usableBattleItems,
  itemTargetId,
  useItemInBattle,
  enterTown,
  leaveTown,
  moveInTown,
  openTrade,
  offeredQuests,
  acceptGameQuest,
  GAME_QUESTS,
  type GameState,
} from "./game.js";

// Shell layer state — SEPARATE from game.ts's `Screen` type on purpose (that's
// the game-logic router; splash/pause are a shell concern layered on top of
// whatever screen the game is currently on). "splash" gates the whole app
// before any game state is shown; "playing" reveals the normal screen router.
type ShellPhase = "splash" | "playing";

export function App() {
  const [game, setGame] = useState<GameState>(() => newGame());
  const [shellPhase, setShellPhase] = useState<ShellPhase>("splash");
  const [paused, setPaused] = useState(false);
  // A direct HUD-gear → Settings path, independent of Pause (Pause still has
  // its own Settings entry too — both are fine, this is just a shorter route
  // the Director asked for since Settings used to be buried two taps deep).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const resumedRef = useRef(false);
  // A save the player hasn't yet chosen to load/dismiss this session. Splash
  // (shell/splash.tsx) is NOT ours to edit and always starts a fresh game —
  // so "Continue" is offered as a Sanctuary affordance instead: computed once
  // at mount, cleared the moment the player either loads it or starts playing
  // for real (any transition away from a freshly-started Sanctuary).
  const [saveOffer] = useState(() => (hasSave() ? loadGame() : null));
  const [saveConsumed, setSaveConsumed] = useState(false);

  // Unlock procedural audio on the first user gesture (browser autoplay policy).
  const unlock = () => {
    if (!resumedRef.current) {
      resumedRef.current = true;
      void resumeAudio();
    }
  };

  // The HUD gear (⚙) route to Settings — a direct one-tap entry, in addition to
  // the pause→Settings path.
  const openSettings = () => setSettingsOpen(true);

  // Esc opens/closes the pause overlay while playing (not on the splash, which
  // has no pause concept, and not while a settings/pause panel already governs
  // Esc itself — PauseOverlay stops propagation on its own Esc handler, and
  // SettingsPanel does the same for the HUD-gear path below).
  useEffect(() => {
    if (shellPhase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || paused || settingsOpen) return;
      e.preventDefault();
      audio().playUi("select");
      setPaused(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shellPhase, paused, settingsOpen]);

  if (shellPhase === "splash") {
    return (
      <div style={{ position: "fixed", inset: 0 }}>
        <Splash
          onStart={() => {
            resumedRef.current = true;
            setShellPhase("playing");
          }}
        />
      </div>
    );
  }

  const canContinue = !saveConsumed && !!saveOffer;
  const doContinue = () => {
    if (!saveOffer) return;
    setSaveConsumed(true);
    audio().playUi("confirm");
    setGame((g) => applySave(g, saveOffer));
  };
  // Diving into ANY Sanctuary action without loading retires the offer — it
  // should only ever appear on a truly fresh boot, never linger once the
  // player has started a fresh playthrough for real.
  const dismissSaveOffer = () => setSaveConsumed(true);

  return (
    <div onPointerDown={unlock} style={{ position: "fixed", inset: 0 }}>
      {game.screen === "party" && (
        <PartyScreen
          game={game}
          setGame={setGame}
          onPause={() => setPaused(true)}
          onSettings={openSettings}
          canContinue={canContinue}
          onContinue={doContinue}
          onDismissContinue={dismissSaveOffer}
        />
      )}
      {game.screen === "zone" && <ZoneScreen game={game} setGame={setGame} onPause={() => setPaused(true)} onSettings={openSettings} paused={paused} />}
      {game.screen === "battle" && <BattleScreen game={game} setGame={setGame} onPause={() => setPaused(true)} onSettings={openSettings} />}
      {game.screen === "cradle" && <CradleScreen game={game} setGame={setGame} />}
      {game.screen === "shop" && <ShopScreen game={game} setGame={setGame} />}
      {game.screen === "dex" && <DexScreen game={game} onBack={() => setGame(backToParty(game))} />}
      {game.screen === "newborn" && <NewbornScreen game={game} setGame={setGame} />}
      {game.screen === "town" && <TownScreen game={game} setGame={setGame} onPause={() => setPaused(true)} onSettings={openSettings} paused={paused} />}
      {game.screen === "trade" && (
        <TradeScreen game={game} setGame={setGame} onBack={() => setGame({ ...game, screen: "town" })} />
      )}
      {paused && (
        <PauseOverlay
          onResume={() => setPaused(false)}
          onReturnToTitle={() => {
            setPaused(false);
            setGame(newGame());
            setShellPhase("splash");
          }}
        />
      )}
      {settingsOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(20,16,10,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", zIndex: 60, overflowY: "auto" }}
          onClick={() => setSettingsOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

type ScreenProps = { game: GameState; setGame: (g: GameState) => void };

// ── Sanctuary / party ─────────────────────────────────────────────────────────
function PartyScreen({
  game,
  setGame,
  onPause,
  onSettings,
  canContinue,
  onContinue,
  onDismissContinue,
}: ScreenProps & {
  onPause: () => void;
  onSettings: () => void;
  canContinue?: boolean;
  onContinue?: () => void;
  onDismissContinue?: () => void;
}) {
  const party = useMemo(() => partyCreatures(game), [game]);
  const placed: Placed[] = party.map((c, i) => ({
    id: c.token.id,
    spec: c.gooberSpec,
    position: [(i - (party.length - 1) / 2) * 7, 2.5, 0],
    facing: 0,
    seed: i * 37 + 5,
  }));
  const [zonePicker, setZonePicker] = useState(false);
  useEffect(() => {
    audio().startAmbient("sanctuary-aldercradle");
    return () => audio().stopAmbient();
  }, []);
  const goTo = (zoneId: string) => {
    onDismissContinue?.();
    audio().playUi("confirm");
    setGame(enterZone(game, zoneId));
  };
  return (
    <>
      <GooberStage placed={placed} cameraPos={[0, 6, 34]} fov={28} />
      <div className="overlay">
        <HudBar
          title="CHIMERA · The Sanctuary"
          subtitle="Aldercradle is fading — scout, bond, and breed new life."
          dexText={`◈ ${game.economy.gold} · Dex ${dexTotal(game)} · Party ${game.roster.party.length}/3 · Box ${game.roster.storage.length}`}
          party={party}
          onPause={onPause} onSettings={onSettings}
        />
        <div className="actionbar">
          {canContinue && (
            <button className="act bond" onClick={onContinue}>
              Continue (load last save) ↺
            </button>
          )}
          {!zonePicker ? (
            <button className="act primary" onClick={() => setZonePicker(true)}>
              Explore →
            </button>
          ) : (
            game.unlockedZones.map((zoneId) => (
              <button key={zoneId} className="act primary" onClick={() => goTo(zoneId)}>
                {ZONE_LABELS[zoneId] ?? zoneId} →
              </button>
            ))
          )}
          <button className="act bond" disabled={game.roster.party.length + game.roster.storage.length < 2}
            onClick={() => { onDismissContinue?.(); audio().playUi("confirm"); setGame(openCradle(game)); }}>
            The Cradle (breed)
          </button>
          <button className="act" onClick={() => { onDismissContinue?.(); audio().playUi("confirm"); setGame(openShop(game)); }}>
            The Market ◈
          </button>
          <button className="act" onClick={() => { onDismissContinue?.(); audio().playUi("confirm"); setGame(openDex(game)); }}>
            Dex 📖
          </button>
          <button className="act primary" onClick={() => { onDismissContinue?.(); audio().playUi("confirm"); setGame(enterTown(game)); }}>
            Enter the Town →
          </button>
        </div>
        <QuestLog game={game} />
      </div>
    </>
  );
}

// A small always-visible active-quest readout (title + a progress bar per
// active quest) — shown on the Sanctuary HUD, since HudBar itself is a
// decoupled shell component this task doesn't own. Purely a read of
// game.quests; Old Tamsin's TownDialogue is still where quests are ACCEPTED.
function QuestLog({ game }: { game: GameState }) {
  const activeIds = Object.keys(game.quests.active);
  if (activeIds.length === 0) return null;
  const defs = GAME_QUESTS.filter((d) => activeIds.includes(d.id));
  return (
    <div
      className="quest-log"
      style={{
        position: "absolute",
        top: 92,
        right: 12,
        width: 240,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      {defs.map((def) => {
        const { done, target } = progressOf(def, game.quests);
        const pct = target > 0 ? Math.min(100, (done / target) * 100) : 0;
        return (
          <div
            key={def.id}
            style={{
              background: "rgba(247,239,226,0.88)",
              border: "1px solid #c9762e",
              borderRadius: 10,
              padding: "6px 10px",
              fontSize: 11,
            }}
          >
            <div style={{ fontWeight: 700 }}>{def.title}</div>
            <div style={{ height: 5, background: "rgba(0,0,0,0.12)", borderRadius: 999, marginTop: 4 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "#6fb98f", borderRadius: 999 }} />
            </div>
            <div style={{ opacity: 0.7, marginTop: 2 }}>{done}/{target}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Overworld: Meadowmere (Wave 2) ─────────────────────────────────────────────
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

function ZoneScreen({ game, setGame, onPause, onSettings, paused }: ScreenProps & { onPause: () => void; onSettings: () => void; paused: boolean }) {
  const zone = game.zone;
  const zoneId = zone?.descriptor.id ?? "meadowmere";
  // Stable per-token spec (see goober-cache): a fresh spec object each step is
  // what used to rebuild the player's metaball mesh on every walk step.
  const lead = game.roster.party[0];
  const playerSpec = lead ? specForToken(lead) : undefined;
  const busy = useRef(false); // locked while an encounter/portal transition plays
  const lastStep = useRef(0);

  useEffect(() => {
    audio().startAmbient(`${zoneId}-ambient`);
    return () => audio().stopAmbient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId]);

  // One step per press, rate-limited so a held key can't outrun the hop. Also
  // gated on `paused` so neither the touch d-pad nor the keydown listener below
  // can step the zone while the pause overlay is up.
  const onStep = (dir: Dir) => {
    if (busy.current || paused) return;
    const now = performance.now();
    if (now - lastStep.current < 135) return;
    lastStep.current = now;

    const { game: g2, events, pending } = zoneStep(game, dir);
    for (const ev of events) {
      if (ev.type === "moved") audio().playUi("select");
      else if (ev.type === "blocked") audio().playUi("back");
    }
    setGame(g2);

    if (pending?.kind === "encounter") {
      busy.current = true;
      audio().playCry(creatureFromToken(pending.token).crySpec);
      window.setTimeout(() => setGame(startEncounterWith(g2, pending.token, pending.roamerId)), 340);
    } else if (pending?.kind === "rival") {
      busy.current = true;
      audio().playUi("confirm");
      const found = g2.rivals.find((p) => p.rival.id === pending.rivalId);
      const lead = found?.rival.roster.party[0];
      if (lead) audio().playCry(creatureFromToken(lead).crySpec);
      window.setTimeout(() => {
        if (found) setGame(startRivalBattle(g2, found.rival));
      }, 340);
    } else if (pending?.kind === "portal") {
      busy.current = true;
      audio().playUi("confirm");
      const to = pending.to;
      window.setTimeout(() => setGame(travelPortal(g2, to)), 260);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return; // the pause overlay owns Esc/input while it's up
      const dir = KEY_DIR[e.code];
      if (dir) { e.preventDefault(); onStep(dir); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, paused]);

  if (!zone || !playerSpec) return null;

  const inZoneRivals = useMemo(
    () => game.rivals.filter((p) => p.placement.zone === zone?.descriptor.id),
    [game.rivals, zone?.descriptor.id],
  );

  return (
    <>
      <ZoneScene zone={zone} playerSpec={playerSpec} rivals={inZoneRivals} />
      <div className="overlay">
        <HudBar
          title={ZONE_LABELS[zoneId] ?? zoneId}
          subtitle="Wild goobers roam, and a rival or two are about — walk into one to meet it."
          dexText={`Dex ${dexTotal(game)} · Party ${game.roster.party.length}/3`}
          onPause={onPause} onSettings={onSettings}
        />
        <div className="hint" style={{ position: "absolute", bottom: 116, left: 0, right: 0, textAlign: "center" }}>
          ↑↓←→ / WASD to walk · reach a golden ring to travel onward
        </div>
        <div className="dpad">
          <button className="pad up" onClick={() => onStep("up")}>▲</button>
          <button className="pad left" onClick={() => onStep("left")}>◀</button>
          <button className="pad right" onClick={() => onStep("right")}>▶</button>
          <button className="pad down" onClick={() => onStep("down")}>▼</button>
        </div>
      </div>
    </>
  );
}

// ── TOWN (walkable plaza hub) ────────────────────────────────────────────────
const TOWN_KEY_DIR: Record<string, TownDirection> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

function TownScreen({ game, setGame, onPause, onSettings, paused }: ScreenProps & { onPause: () => void; onSettings: () => void; paused: boolean }) {
  const [nearId, setNearId] = useState<string | null>(null);
  const [dialogueVillagerId, setDialogueVillagerId] = useState<string | null>(null);
  const lastStep = useRef(0);

  useEffect(() => {
    audio().startAmbient("town-plaza");
    return () => audio().stopAmbient();
  }, []);

  // One step per press, same 135ms rate-limit ZoneScreen's onStep uses — no
  // "busy" transition lock needed here (the town has no encounters/portals to
  // animate through, just a plain grid walk), but movement is still gated
  // while paused OR while the dialogue overlay has focus.
  const onStep = (dir: TownDirection) => {
    if (paused || dialogueVillagerId) return;
    const now = performance.now();
    if (now - lastStep.current < 135) return;
    lastStep.current = now;
    const [dx, dy] = TOWN_DIRECTION_DELTA[dir];
    const g2 = moveInTown(game, dx, dy);
    if (g2 !== game) audio().playUi("select");
    setGame(g2);
  };

  const tryTalk = () => {
    if (paused || !nearId || dialogueVillagerId) return;
    audio().playUi("confirm");
    setDialogueVillagerId(nearId);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return; // the pause overlay owns input while it's up
      if (dialogueVillagerId) return; // TownDialogue's own listeners own focus/Esc
      const dir = TOWN_KEY_DIR[e.code];
      if (dir) { e.preventDefault(); onStep(dir); return; }
      if (e.code === "KeyE") { e.preventDefault(); tryTalk(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, paused, nearId, dialogueVillagerId]);

  const villager = dialogueVillagerId ? villagerById(dialogueVillagerId) : undefined;

  const handleAction = (action: TownAction) => {
    if (action.kind === "talk") return; // pure banter — stay in the dialogue
    // 'quests' has no role BUTTON in town-dialogue.tsx (ROLE_BUTTON_LABEL.
    // questgiver is undefined) — the offered-quests list + Accept buttons ARE
    // the affordance, rendered inline while the dialogue stays open. Every
    // other target routes to a real screen, closing the dialogue first.
    if (action.target === "quests") return;
    setDialogueVillagerId(null);
    audio().playUi("confirm");
    switch (action.target) {
      case "shop": setGame(openShop(game)); break;
      case "cradle": setGame(openCradle(game)); break;
      case "dex": setGame(openDex(game)); break;
      case "trade": setGame(openTrade(game)); break;
    }
  };

  return (
    <>
      <TownScene playerTile={game.townPlayerTile} onMove={onStep} onApproach={setNearId} showApproachHint={!dialogueVillagerId} />
      <div className="overlay">
        <HudBar
          title="CHIMERA · The Town"
          subtitle="Walk up to a villager and press E to talk."
          dexText={`◈ ${game.economy.gold} · Dex ${dexTotal(game)} · Party ${game.roster.party.length}/3`}
          onPause={onPause} onSettings={onSettings}
        />
        <QuestLog game={game} />
        {!dialogueVillagerId && (
          <>
            <div className="hint" style={{ position: "absolute", bottom: 116, left: 0, right: 0, textAlign: "center" }}>
              ↑↓←→ / WASD to walk · E to talk
            </div>
            <div className="dpad">
              <button className="pad up" onClick={() => onStep("up")}>▲</button>
              <button className="pad left" onClick={() => onStep("left")}>◀</button>
              <button className="pad right" onClick={() => onStep("right")}>▶</button>
              <button className="pad down" onClick={() => onStep("down")}>▼</button>
            </div>
            <button
              className="act bond"
              disabled={!nearId}
              style={{ position: "absolute", right: 16, bottom: 16 }}
              onClick={tryTalk}
            >
              Talk (E)
            </button>
            <button
              className="act"
              style={{ position: "absolute", left: 16, top: 78 }}
              onClick={() => { audio().playUi("back"); setGame(leaveTown(game)); }}
            >
              ← Leave the Town
            </button>
          </>
        )}
      </div>
      {villager && (
        <TownDialogue
          villager={villager}
          onAction={handleAction}
          onClose={() => setDialogueVillagerId(null)}
          offeredQuests={villager.role === "questgiver" ? offeredQuests(game) : undefined}
          onAcceptQuest={(id) => { audio().playUi("confirm"); setGame(acceptGameQuest(game, id)); }}
        />
      )}
    </>
  );
}

// ── Battle ────────────────────────────────────────────────────────────────────
function battlePlaced(b: BattleState): Placed[] {
  const players = b.playerTeam.map((c, i) => placedFrom(c, [(i - (b.playerTeam.length - 1) / 2) * 6, 2.5, 6], Math.PI, i * 17 + 3));
  const enemies = b.enemyTeam.map((c, i) => placedFrom(c, [(i - (b.enemyTeam.length - 1) / 2) * 6, 2.5, -7], 0, i * 29 + 11));
  return [...players, ...enemies];
}
function placedFrom(c: Combatant, position: [number, number, number], facing: number, seed: number): Placed {
  const spec = creatureFromToken(c.token).gooberSpec;
  return { id: c.id, spec, position, facing, fainted: !c.alive, seed };
}

function Bar({ kind, cur, max }: { kind: "hp" | "mp"; cur: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return (
    <div className={`bar ${kind}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
function CombatantCard({ c, active }: { c: Combatant; active: boolean }) {
  return (
    <div className={`card ${c.alive ? "" : "fainted"} ${active ? "pick" : ""}`}>
      <div className="nm">
        <span>{c.name}</span>
        <span className="rank">{active ? "▶" : ""}</span>
      </div>
      <Bar kind="hp" cur={c.currentHp} max={c.maxHp} />
      <Bar kind="mp" cur={c.currentMp} max={c.maxMp} />
    </div>
  );
}

function BattleScreen({ game, setGame, onPause, onSettings }: ScreenProps & { onPause: () => void; onSettings: () => void }) {
  const b = game.battle;
  if (!b) return null;
  const actor = activeActor(b);
  const placed = battlePlaced(b);
  const rival = game.rivalBattleId ? game.rivals.find((p) => p.rival.id === game.rivalBattleId) : undefined;

  const doAction = (act: Parameters<typeof stepBattle>[1]) => {
    audio().playUi("select");
    const { game: g2, events } = stepBattle(game, act);
    playBattleEvents(audio(), events);
    setGame(g2);
  };
  const target = defaultTargetId(b);
  const [itemMenu, setItemMenu] = useState(false);
  const items = usableBattleItems(game);
  const doItem = (itemId: string) => {
    const tid = itemTargetId(b, itemId);
    if (!tid) return;
    audio().playUi("confirm");
    const { game: g2, events } = useItemInBattle(game, itemId, tid);
    playBattleEvents(audio(), events);
    setGame(g2);
    setItemMenu(false);
  };

  return (
    <>
      <GooberStage placed={placed} cameraPos={[3, 7, 21]} fov={32} bg="#a9d9c0" ground="#cfe6a8" />
      <div className="overlay">
        <HudBar
          title={rival ? `Rival battle · ${rival.rival.name}` : "Encounter"}
          subtitle={rival ? `${rival.rival.name} challenges you with the team their journey has built.` : undefined}
          dexText={game.outcome ? game.outcome.toUpperCase() : b.phase}
          onPause={onPause} onSettings={onSettings}
        />
        <div className="cards enemy">
          {b.enemyTeam.map((c) => <CombatantCard key={c.id} c={c} active={actor?.id === c.id} />)}
        </div>
        <div className="cards player">
          {b.playerTeam.map((c) => <CombatantCard key={c.id} c={c} active={actor?.id === c.id} />)}
        </div>
        <div className="log">
          {game.log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
        <div className="actionbar">
          {game.outcome ? (
            <button className="act primary" onClick={() => setGame(game.zone ? returnToZone(game) : leaveBattle(game))}>
              {game.zone ? `Back to ${ZONE_LABELS[game.zone.descriptor.id] ?? "the zone"} →` : "Return to the Sanctuary →"}
            </button>
          ) : actor && target ? (
            itemMenu ? (
              <>
                {items.length === 0 && <div className="hint">No usable items.</div>}
                {items.map((it) => (
                  <button key={it.id} className="act" onClick={() => doItem(it.id)}>
                    {it.name} <small>×{it.count}</small>
                  </button>
                ))}
                <button className="act" onClick={() => setItemMenu(false)}>← Back</button>
              </>
            ) : (
              <>
                <button className="act primary" onClick={() => doAction({ type: "attack", targetId: target })}>Attack</button>
                {actor.skills.slice(0, 3).map((s) => (
                  <button key={s.id} className="act" disabled={actor.currentMp < s.mpCost}
                    onClick={() => doAction({ type: "skill", skillId: s.id, targetId: target })}>
                    {s.name} <small>({s.mpCost})</small>
                  </button>
                ))}
                <button className="act bond" onClick={() => doAction({ type: "scout", targetId: target })}>Scout 🤝</button>
                <button className="act" disabled={items.length === 0} onClick={() => setItemMenu(true)}>Items 🎒</button>
                <button className="act" onClick={() => doAction({ type: "defend" })}>Defend</button>
                <button className="act" onClick={() => doAction({ type: "flee" })}>Flee</button>
              </>
            )
          ) : (
            <div className="hint">…resolving…</div>
          )}
        </div>
      </div>
    </>
  );
}

// ── The Cradle (breeding) ───────────────────────────────────────────────────
function CradleScreen({ game, setGame }: ScreenProps) {
  const coll = useMemo(() => collectionCreatures(game), [game]);
  const placed: Placed[] = coll.map((c, i) => ({
    id: c.token.id,
    spec: c.gooberSpec,
    position: [(i - (coll.length - 1) / 2) * 6, 2.5, 0],
    facing: 0,
    seed: i * 23 + 2,
  }));
  const canBreed = game.cradlePick.length === 2;
  return (
    <>
      <GooberStage placed={placed} cameraPos={[0, 6, Math.max(28, coll.length * 6)]} fov={30} bg="#d8c6ee" ground="#b9d79a" />
      <div className="overlay">
        <div className="banner">
          <div>
            <div className="title">The Cradle</div>
            <div className="subtitle">Weave two companions into a new life.</div>
          </div>
          <div className="dex">Pick 2 · {game.cradlePick.length}/2</div>
        </div>
        <div className="cards player" style={{ position: "absolute", bottom: 84, left: 8, right: 8, justifyContent: "center" }}>
          {coll.map((c) => (
            <button key={c.token.id} className={`card ${game.cradlePick.includes(c.token.id) ? "pick" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => { audio().playUi("select"); setGame(togglePick(game, c.token.id)); }}>
              <div className="nm"><span>{c.name}</span><span className="rank">{c.rank}</span></div>
              <div className="hint">{c.family}</div>
            </button>
          ))}
        </div>
        <div className="actionbar">
          <button className="act" onClick={() => { audio().playUi("back"); setGame(backToParty(game)); }}>← Back</button>
          <button className="act primary" disabled={!canBreed}
            onClick={() => { audio().playUi("confirm"); setGame(breedPicked(game)); }}>
            Weave new life ✦
          </button>
        </div>
      </div>
    </>
  );
}

// ── The Market (Wave 3) ──────────────────────────────────────────────────────
function ShopScreen({ game, setGame }: ScreenProps) {
  const stock = shopFor(0); // early tier for Meadowmere
  const gold = game.economy.gold;
  const owned = (id: string) => game.economy.items[id] ?? 0;
  return (
    <>
      <GooberStage placed={[]} cameraPos={[0, 5, 20]} fov={30} bg="#efe0c2" ground="#d8c49a" />
      <div className="overlay">
        <div className="banner">
          <div>
            <div className="title">The Market</div>
            <div className="subtitle">Stock up before you wander — the wild is generous, but not kind.</div>
          </div>
          <div className="dex">◈ {gold} gold</div>
        </div>
        <div className="shop-list">
          {stock.map((id) => {
            const def = itemDef(id);
            if (!def) return null;
            const canBuy = gold >= def.price;
            return (
              <div key={id} className="shop-row">
                <div className="shop-info">
                  <div className="shop-name">{def.name} {owned(id) > 0 && <small>×{owned(id)}</small>}</div>
                  <div className="hint">{def.desc}</div>
                </div>
                <div className="shop-buy">
                  <button className="act" disabled={owned(id) === 0}
                    onClick={() => { audio().playUi("back"); setGame(sellItem(game, id)); }}>
                    Sell ◈{Math.floor(def.price * SELL_FRACTION)}
                  </button>
                  <button className="act primary" disabled={!canBuy}
                    onClick={() => { audio().playUi("confirm"); setGame(buyItem(game, id)); }}>
                    Buy ◈{def.price}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="actionbar">
          <button className="act" onClick={() => { audio().playUi("back"); setGame(backToParty(game)); }}>← Back</button>
        </div>
      </div>
    </>
  );
}

// ── Newborn reveal (the money moment) ────────────────────────────────────────
function NewbornScreen({ game, setGame }: ScreenProps) {
  const nb = game.newborn;
  const parents = game.lastBreed?.childToken.parents ?? null;
  useEffect(() => {
    if (nb) {
      // The emotional peak: a warm "new life" chime leading into the newborn's FIRST CRY.
      audio().playNewborn(nb.crySpec);
    }
  }, [nb]);
  if (!nb) return null;
  const placed: Placed[] = [{ id: nb.token.id, spec: nb.gooberSpec, position: [0, 2.5, 0], facing: 0, seed: 7 }];
  // Resolve the real parent tokens from the roster (they're still party/storage).
  const allTokens = [...game.roster.party, ...game.roster.storage];
  const parentNames = (parents ?? []).map((id) => {
    const t = allTokens.find((tk) => tk.id === id);
    return t ? creatureFromToken(t).name : "a lost friend";
  });
  return (
    <>
      <GooberStage placed={placed} cameraPos={[0, 4, 16]} fov={30} bg="#f4e3c4" ground="#cfe6a8" />
      <div className="overlay">
        <div className="modal">
          <div className="panel">
            <h2>A new life is born</h2>
            <div className="reveal-name">{nb.name}</div>
            <div className="hint">{nb.family} · rank {nb.rank} · gen {nb.token.generation} {nb.token.plus > 0 ? `· +${nb.token.plus}` : ""}</div>
            <div className="stat-row">
              <span>HP {nb.stats.hp}</span><span>MP {nb.stats.mp}</span><span>ATK {nb.stats.atk}</span>
              <span>DEF {nb.stats.def}</span><span>AGI {nb.stats.agi}</span><span>WIS {nb.stats.wis}</span>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              woven from {parentNames.join(" + ")}
            </div>
            <div className="stat-row">
              {nb.skills.slice(0, 4).map((s) => <span key={s.id}>{s.name}</span>)}
            </div>
          </div>
        </div>
        <div className="actionbar">
          <button className="act primary" onClick={() => { audio().playUi("confirm"); setGame(backToParty(game)); }}>
            Welcome it home →
          </button>
        </div>
      </div>
    </>
  );
}
