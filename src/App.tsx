import { useEffect, useMemo, useRef, useState } from "react";
import { creatureFromToken } from "game-kit/creature";
import type { BattleState, BattleEvent, Combatant } from "game-kit/battle";
import type { Element } from "game-kit/creature";
import type { Dir } from "game-kit/world-runtime";
import { GooberStage, type Placed } from "./GooberStage.js";
import { SlashVFX, ElementBurstVFX } from "./battle-vfx.js";
import { ZoneScene } from "./ZoneScene.js";
import { specForToken } from "./goober-cache.js";
import { IntroScene } from "./intro.js";
import { StudioLogo } from "./studio-logo.js";
import { DexScreen } from "./dex.js";
import { audio, resumeAudio } from "./audio.js";
import { playBattleEvents } from "./battle-audio.js";
import { Splash } from "./shell/splash.js";
import { PauseOverlay } from "./shell/pause.js";
import { FieldMenu } from "./field-menu.js";
import { SettingsPanel } from "./shell/settings.js";
import { HudBar } from "./shell/hud.js";
import { itemDef, shopFor, SELL_FRACTION } from "game-kit/economy";
import { ZONE_LABELS, GUARDIAN_TITLE, enemyLevelForToken } from "./zone.js";
import { levelOf } from "./leveling.js";
import { hasSave, loadGame, saveGame } from "./save.js";
import { TownScene } from "./town-scene.js";
import { TownDialogue } from "./town-dialogue.js";
import {
  villagerById,
  TOWN_DIRECTION_DELTA,
  TOWN_WORLD_PADS,
  type TownAction,
  type TownDirection,
} from "./town.js";
import { WORLDS, isHealed, isWorldUnlocked } from "./worldtree.js";
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
  townStep,
  openHome,
  leaveHome,
  swapPartyMember,
  openTrade,
  offeredQuests,
  acceptGameQuest,
  GAME_QUESTS,
  openAldercradle,
  leaveAldercradle,
  treeHealedCount,
  treeIsWhole,
  openFinale,
  leaveFinale,
  type GameState,
} from "./game.js";

// Shell layer state — SEPARATE from game.ts's `Screen` type on purpose (that's
// the game-logic router; splash/pause are a shell concern layered on top of
// whatever screen the game is currently on). "studio" plays the WOVENWILD ident;
// "splash" is the title screen (New Game / Continue / Settings); "intro" plays
// the short "The Fading" cutscene when starting fresh; "playing" reveals the
// normal screen router (a fresh game lands on game.screen === "town").
type ShellPhase = "studio" | "splash" | "intro" | "playing";

export function App() {
  const [game, setGame] = useState<GameState>(() => newGame());
  const [shellPhase, setShellPhase] = useState<ShellPhase>("studio");
  const [paused, setPaused] = useState(false);
  // Settings opened from the title screen (the splash has no pause menu of its own).
  const [splashSettingsOpen, setSplashSettingsOpen] = useState(false);
  const resumedRef = useRef(false);
  // A save the player hasn't yet chosen to load/dismiss this session. Splash
  // (shell/splash.tsx) is NOT ours to edit and always starts a fresh game —
  // so "Continue" is offered as a Home affordance instead: computed once
  // at mount, cleared the moment the player either loads it or starts playing
  // for real (any transition away from a freshly-started game).
  const [saveOffer] = useState(() => (hasSave() ? loadGame() : null));
  const [saveConsumed, setSaveConsumed] = useState(false);

  // Unlock procedural audio on the first user gesture (browser autoplay policy).
  const unlock = () => {
    if (!resumedRef.current) {
      resumedRef.current = true;
      void resumeAudio();
    }
  };

  // Esc opens the pause overlay while playing (not on the splash; once the
  // overlay is up it owns Esc itself and stops propagation).
  useEffect(() => {
    if (shellPhase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || paused) return;
      e.preventDefault();
      audio().playUi("select");
      setPaused(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shellPhase, paused]);

  if (shellPhase === "studio") {
    // The WOVENWILD studio ident — auto-advances (or tap-skips) to the title.
    return <StudioLogo onDone={() => setShellPhase("splash")} />;
  }

  if (shellPhase === "splash") {
    return (
      <div style={{ position: "fixed", inset: 0 }}>
        <Splash
          onNewGame={() => {
            // The Start tap is a valid autoplay-unlock gesture — resume the audio
            // rig so the intro's chime + the town ambient can sound.
            resumedRef.current = true;
            void resumeAudio();
            setSaveConsumed(true);
            setGame(newGame());
            setShellPhase("intro");
          }}
          onContinue={
            saveOffer
              ? () => {
                  resumedRef.current = true;
                  void resumeAudio();
                  setSaveConsumed(true);
                  setGame((g) => applySave(g, saveOffer));
                  setShellPhase("playing"); // skip the intro — jump straight back in
                }
              : undefined
          }
          onSettings={() => setSplashSettingsOpen(true)}
        />
        {splashSettingsOpen && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(20,16,10,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", zIndex: 60, overflowY: "auto" }}
            onClick={() => setSplashSettingsOpen(false)}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <SettingsPanel onClose={() => setSplashSettingsOpen(false)} />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (shellPhase === "intro") {
    // "The Fading" — a short, skippable premise cutscene; on done/skip we drop
    // into the town hub (game.screen is already "town" for a fresh game).
    return <IntroScene onDone={() => setShellPhase("playing")} />;
  }

  const canContinue = !saveConsumed && !!saveOffer;
  const doContinue = () => {
    if (!saveOffer) return;
    setSaveConsumed(true);
    audio().playUi("confirm");
    setGame((g) => applySave(g, saveOffer));
  };
  // Diving into ANY Home action without loading retires the offer — it
  // should only ever appear on a truly fresh boot, never linger once the
  // player has started a fresh playthrough for real.
  const dismissSaveOffer = () => setSaveConsumed(true);

  return (
    <div onPointerDown={unlock} style={{ position: "fixed", inset: 0 }}>
      {game.screen === "home" && (
        <HomeScreen
          game={game}
          setGame={setGame}
          onPause={() => setPaused(true)}
          canContinue={canContinue}
          onContinue={doContinue}
          onDismissContinue={dismissSaveOffer}
        />
      )}
      {game.screen === "zone" && <ZoneScreen game={game} setGame={setGame} onPause={() => setPaused(true)} paused={paused} />}
      {game.screen === "battle" && <BattleScreen game={game} setGame={setGame} onPause={() => setPaused(true)} />}
      {game.screen === "cradle" && <CradleScreen game={game} setGame={setGame} />}
      {game.screen === "shop" && <ShopScreen game={game} setGame={setGame} />}
      {game.screen === "dex" && <DexScreen game={game} onBack={() => setGame(backToParty(game))} />}
      {game.screen === "newborn" && <NewbornScreen game={game} setGame={setGame} />}
      {game.screen === "town" && <TownScreen game={game} setGame={setGame} onPause={() => setPaused(true)} paused={paused} />}
      {game.screen === "trade" && (
        <TradeScreen game={game} setGame={setGame} onBack={() => setGame({ ...game, screen: "town" })} />
      )}
      {game.screen === "aldercradle" && <AldercradleScreen game={game} setGame={setGame} />}
      {game.screen === "finale" && <FinaleScreen game={game} setGame={setGame} />}
      {paused && (game.screen === "town" || game.screen === "zone") ? (
        <FieldMenu
          game={game}
          setGame={setGame}
          onClose={() => setPaused(false)}
          onReturnToTitle={() => {
            setPaused(false);
            setGame(newGame());
            setShellPhase("splash");
          }}
        />
      ) : (
        paused && (
          <PauseOverlay
            onResume={() => setPaused(false)}
            onReturnToTitle={() => {
              setPaused(false);
              setGame(newGame());
              setShellPhase("splash");
            }}
          />
        )
      )}
    </div>
  );
}

type ScreenProps = { game: GameState; setGame: (g: GameState) => void };

// ── Home (party lineup + box management — the retired Sanctuary's successor;
// reached by walking into the Home building in town, not a landing menu) ───
function HomeScreen({
  game,
  setGame,
  onPause,
  canContinue,
  onContinue,
  onDismissContinue,
}: ScreenProps & {
  onPause: () => void;
  canContinue?: boolean;
  onContinue?: () => void;
  onDismissContinue?: () => void;
}) {
  const party = useMemo(() => partyCreatures(game), [game]);
  const box = useMemo(() => collectionCreatures(game).filter((c) => !party.some((p) => p.token.id === c.token.id)), [game, party]);
  const placed: Placed[] = party.map((c, i) => ({
    id: c.token.id,
    spec: c.gooberSpec,
    position: [(i - (party.length - 1) / 2) * 7, 2.5, 0],
    facing: 0,
    seed: i * 37 + 5,
  }));
  // Which party member a box swap will bump to storage (only asked when the
  // party is already full — swapToParty just fills an open slot otherwise).
  const [swapOutId, setSwapOutId] = useState<string | null>(null);
  useEffect(() => {
    audio().startAmbient("sanctuary-aldercradle");
    return () => audio().stopAmbient();
  }, []);
  const partyFull = party.length >= 3;
  const doSwap = (storageId: string) => {
    audio().playUi("confirm");
    setGame(swapPartyMember(game, storageId, partyFull ? (swapOutId ?? party[0]?.token.id) : undefined));
    setSwapOutId(null);
  };
  return (
    <>
      <GooberStage placed={placed} cameraPos={[0, 6, 34]} fov={28} />
      <div className="overlay">
        <HudBar
          title="CHIMERA · Home"
          subtitle="Your companions rest here — manage the party and the box."
          dexText={`◈ ${game.economy.gold} · Dex ${dexTotal(game)} · Party ${game.roster.party.length}/3 · Box ${game.roster.storage.length}`}
          party={party}
          onMenu={onPause}
        />
        {box.length > 0 && (
          <div
            className="quest-log"
            style={{ position: "absolute", top: 92, left: 12, width: 220, display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div style={{ fontWeight: 700, fontSize: 12, opacity: 0.75 }}>Box (tap to swap into party)</div>
            {box.map((c) => (
              <button
                key={c.token.id}
                className="card"
                style={{ cursor: "pointer", textAlign: "left" }}
                onClick={() => doSwap(c.token.id)}
              >
                <div className="nm"><span>{c.name}</span><span className="rank">{c.rank}</span></div>
                <div className="hint">{c.family}</div>
              </button>
            ))}
          </div>
        )}
        <div className="actionbar">
          {canContinue && (
            <button className="act bond" onClick={onContinue}>
              Continue (load last save) ↺
            </button>
          )}
          <button
            className="act"
            onClick={() => { onDismissContinue?.(); audio().playUi("confirm"); saveGame(game); }}
          >
            Save ✓
          </button>
          <button
            className="act primary"
            onClick={() => { onDismissContinue?.(); audio().playUi("back"); setGame(leaveHome(game)); }}
          >
            ← Leave home
          </button>
        </div>
        <QuestLog game={game} />
      </div>
    </>
  );
}

// A small always-visible active-quest readout (title + a progress bar per
// active quest) — shown on the Home/Town HUD, since HudBar itself is a
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

function ZoneScreen({ game, setGame, onPause, paused }: ScreenProps & { onPause: () => void; paused: boolean }) {
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

    const { game: g2, pending } = zoneStep(game, dir);
    // Walking is SILENT — the per-step d-pad tick was too noisy. UI sound is
    // reserved for menu/interact + the meaningful transitions below (an
    // encounter's cry, a portal's confirm).
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
      // Reset the gate inside the timeout (mirrors TownScreen's pad/Home/tree
      // branches below): zone->zone travel keeps `game.screen === "zone"`, so
      // React reuses this SAME ZoneScreen instance (no remount to reset the
      // ref) — leaving `busy.current` stuck `true` forever soft-locked the
      // player's movement after any in-zone portal travel.
      window.setTimeout(() => { busy.current = false; setGame(travelPortal(g2, to)); }, 260);
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
        />
        <div className="walk-hint hint">
          ↑↓←→ / WASD to walk · reach a golden ring to travel onward
        </div>
        <div className="dpad">
          <button className="pad up" onClick={() => onStep("up")}>▲</button>
          <button className="pad left" onClick={() => onStep("left")}>◀</button>
          <button className="pad right" onClick={() => onStep("right")}>▶</button>
          <button className="pad down" onClick={() => onStep("down")}>▼</button>
        </div>
        <div className="touch-actions">
          <button
            className="act"
            title="Menu (Esc)"
            onClick={() => { audio().playUi("select"); onPause(); }}
          >
            Menu
          </button>
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

function TownScreen({ game, setGame, onPause, paused }: ScreenProps & { onPause: () => void; paused: boolean }) {
  const [nearId, setNearId] = useState<string | null>(null);
  const [nearHome, setNearHome] = useState(false);
  const [nearTree, setNearTree] = useState(false);
  const [dialogueVillagerId, setDialogueVillagerId] = useState<string | null>(null);
  // A soft "still sleeps" hint shown briefly after stepping onto a dormant
  // future-world pad — cleared after a short beat (it's flavour, not a modal).
  const [dormantHint, setDormantHint] = useState<string | null>(null);
  const lastStep = useRef(0);
  // Locked while a pad/Home transition plays its short confirm beat — mirrors
  // ZoneScreen's `busy` gate so a held key can't double-fire the travel.
  const busy = useRef(false);

  useEffect(() => {
    audio().startAmbient("town-plaza");
    return () => audio().stopAmbient();
  }, []);

  // Active vs. dormant is derived FRESH from `heartseeds` every render
  // (worldtree.ts's `isWorldUnlocked`, the Aldercradle's linear chain) —
  // never a persisted flag, so a Guardian win auto-flips a pad active the
  // very next render with no extra wiring.
  const activeWorldPads = useMemo(
    () => TOWN_WORLD_PADS.filter((p) => isWorldUnlocked(game.heartseeds, p.worldId)),
    [game.heartseeds],
  );
  const dormantWorldPads = useMemo(
    () => TOWN_WORLD_PADS.filter((p) => !isWorldUnlocked(game.heartseeds, p.worldId)),
    [game.heartseeds],
  );

  // One step per press, same 135ms rate-limit ZoneScreen's onStep uses. Movement
  // is gated while paused, while the dialogue overlay has focus, or while a
  // pad/Home transition is already playing (`busy`).
  const onStep = (dir: TownDirection) => {
    if (paused || dialogueVillagerId || busy.current) return;
    const now = performance.now();
    if (now - lastStep.current < 135) return;
    lastStep.current = now;
    const [dx, dy] = TOWN_DIRECTION_DELTA[dir];
    const { game: g2, pending } = townStep(game, dx, dy);
    setGame(g2); // walking is silent (see ZoneScreen) — no per-step d-pad tick

    if (pending?.kind === "portal") {
      busy.current = true;
      audio().playUi("confirm");
      window.setTimeout(() => { busy.current = false; setGame(enterZone(g2, pending.zoneId)); }, 260);
    } else if (pending?.kind === "home") {
      busy.current = true;
      audio().playUi("confirm");
      window.setTimeout(() => { busy.current = false; setGame(openHome(g2)); }, 220);
    } else if (pending?.kind === "tree") {
      busy.current = true;
      audio().playUi("confirm");
      window.setTimeout(() => { busy.current = false; setGame(openAldercradle(g2)); }, 220);
    } else if (pending?.kind === "dormant") {
      audio().playUi("back");
      setDormantHint(pending.label);
      window.setTimeout(() => setDormantHint(null), 1800);
    }
  };

  const tryTalk = () => {
    if (paused || busy.current) return;
    if (nearTree) {
      audio().playUi("confirm");
      setGame(openAldercradle(game));
      return;
    }
    if (nearHome) {
      audio().playUi("confirm");
      setGame(openHome(game));
      return;
    }
    if (!nearId || dialogueVillagerId) return;
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
  }, [game, paused, nearId, nearHome, nearTree, dialogueVillagerId]);

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
      <TownScene
        playerTile={game.townPlayerTile}
        activePads={activeWorldPads}
        dormantPads={dormantWorldPads}
        healedCount={treeHealedCount(game)}
        onMove={onStep}
        onApproach={setNearId}
        onApproachHome={setNearHome}
        onApproachTree={setNearTree}
        showApproachHint={!dialogueVillagerId}
      />
      <div className="overlay">
        <HudBar
          title="CHIMERA · The Town"
          subtitle="Walk to a glowing pad to travel · E at the Aldercradle, the house, or a villager."
          dexText={`◈ ${game.economy.gold} · Dex ${dexTotal(game)} · Party ${game.roster.party.length}/3 · 🌱${treeHealedCount(game)}/8`}
        />
        <QuestLog game={game} />
        {dormantHint && (
          <div className="town-approach-hint" style={{ bottom: "22%" }}>
            {dormantHint} still sleeps, lost to the Fading…
          </div>
        )}
        {!dialogueVillagerId && (
          <>
            <div className="walk-hint hint">
              ↑↓←→ / WASD to walk · step onto a pad to travel · E at the Aldercradle, the house, or a villager
            </div>
            <div className="dpad">
              <button className="pad up" onClick={() => onStep("up")}>▲</button>
              <button className="pad left" onClick={() => onStep("left")}>◀</button>
              <button className="pad right" onClick={() => onStep("right")}>▶</button>
              <button className="pad down" onClick={() => onStep("down")}>▼</button>
            </div>
            <div className="touch-actions">
              <button
                className="act bond"
                disabled={!nearId && !nearHome && !nearTree}
                onClick={tryTalk}
              >
                {nearTree ? "Aldercradle (E)" : nearHome ? "Enter Home (E)" : "Talk (E)"}
              </button>
              <button
                className="act"
                title="Menu (Esc)"
                onClick={() => { audio().playUi("select"); onPause(); }}
              >
                Menu
              </button>
            </div>
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

// ── The Aldercradle (the world-tree panel — 8 worlds, X/8 Heartseeds) ───────
function AldercradleScreen({ game, setGame }: ScreenProps) {
  const healed = treeHealedCount(game);
  const whole = treeIsWhole(game);
  useEffect(() => {
    audio().startAmbient("town-plaza");
    return () => audio().stopAmbient();
  }, []);
  return (
    <>
      <GooberStage placed={[]} cameraPos={[0, 5, 20]} fov={30} bg="#f4e3c4" ground="#cfe6a8" />
      <div className="overlay">
        <div className="banner">
          <div>
            <div className="title">The Aldercradle</div>
            <div className="subtitle">
              The world-tree at the heart of the town — every Heartseed you recover coaxes it a little further from the Fading.
            </div>
          </div>
          <div className="dex">🌱 {healed} / 8 Heartseeds</div>
        </div>
        <div className="shop-list">
          {WORLDS.map((w) => {
            const done = isHealed(game.heartseeds, w.id);
            const unlocked = isWorldUnlocked(game.heartseeds, w.id);
            return (
              <div key={w.id} className="shop-row" style={{ opacity: unlocked ? 1 : 0.6 }}>
                <div className="shop-info">
                  <div className="shop-name">
                    {done ? "🌟 " : unlocked ? "🗡️ " : "💤 "}
                    {w.label}
                  </div>
                  <div className="hint">
                    {done
                      ? `${w.seedName} recovered — this world is healed.`
                      : unlocked
                        ? "A Guardian still awaits, deep in this world."
                        : "Still lost to the Fading — the path here isn't open yet."}
                  </div>
                  <div className="hint" style={{ fontStyle: "italic", opacity: 0.85 }}>{w.lore}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="actionbar">
          <button className="act" onClick={() => { audio().playUi("back"); setGame(leaveAldercradle(game)); }}>
            ← Back to town
          </button>
          {whole && (
            <button
              className="act primary"
              onClick={() => { audio().playUi("confirm"); setGame(openFinale(game)); }}
            >
              The tree is whole ✦
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── The finale (8/8 Heartseeds — Aldercradle blooms whole) ─────────────────
function FinaleScreen({ game, setGame }: ScreenProps) {
  useEffect(() => {
    audio().playNewborn();
  }, []);
  return (
    <>
      <GooberStage placed={[]} cameraPos={[0, 5, 18]} fov={30} bg="#f9ecc9" ground="#cfe6a8" />
      <div className="overlay">
        <div className="modal">
          <div className="panel">
            <h2>The Aldercradle blooms whole</h2>
            <div className="reveal-name">Every Heartseed has come home.</div>
            <div className="hint" style={{ marginTop: 10, maxWidth: 420, lineHeight: 1.5 }}>
              Eight worlds, eight Guardians, eight quiet acts of trust — and the old tree at the
              heart of the town remembers, all at once, what it means to be green. The Fading
              hasn't ended everywhere. But here, tonight, it has lost.
            </div>
          </div>
        </div>
        <div className="actionbar">
          <button className="act primary" onClick={() => { audio().playUi("confirm"); setGame(leaveFinale(game)); }}>
            Return to the Aldercradle →
          </button>
        </div>
      </div>
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

/** Look up a combatant's CURRENT world position on the battle stage (the same
 *  layout `battlePlaced` derives), by re-deriving from the pre-action battle
 *  state so VFX plays at the position the creature stood at when the hit
 *  landed, regardless of any faint/swap the post-action state introduces. */
function stagePositionOf(b: BattleState, id: string): [number, number, number] | null {
  const pi = b.playerTeam.findIndex((c) => c.id === id);
  if (pi >= 0) return [(pi - (b.playerTeam.length - 1) / 2) * 6, 2.5, 6];
  const ei = b.enemyTeam.findIndex((c) => c.id === id);
  if (ei >= 0) return [(ei - (b.enemyTeam.length - 1) / 2) * 6, 2.5, -7];
  return null;
}

/** One player action's worth of combat VFX, captured from the `BattleEvent`
 *  stream `stepBattle` returns: the attacker/target ids + world positions and
 *  what kind of hit landed (a plain attack's slash vs. a skill's elemental
 *  burst). Sequenced by `BattleScreen.doAction` — see the block comment there
 *  for the full reveal timeline. Only the FIRST damage-dealing beat in the
 *  stream is animated (the player's own action); enemy-turn follow-on damage
 *  still resolves (HP/log update once `anim` commits) even though its own
 *  hit isn't separately choreographed — see the comment at the call site. */
interface BattleAnim {
  attackerId: string;
  targetId: string;
  kind: "attack" | "skill";
  element: Element;
  attackerPos: [number, number, number];
  targetPos: [number, number, number];
}

/** How long the VFX window holds before the real state (HP bars, faint,
 *  log) commits — snappy, not sluggish. Tuned separately for a bare attack
 *  (a fast slash) vs. a skill (a slightly longer elemental burst) so the
 *  bigger effect has time to read. */
const ATTACK_ANIM_MS = 620;
const SKILL_ANIM_MS = 780;

/** Derive the BattleAnim for the player's own action from the fresh event
 *  stream + the PRE-action battle state (so positions match what's on
 *  screen right now). Returns null when there's nothing to animate (a miss,
 *  defend, scout, flee, item — those commit immediately, no VFX window). */
function deriveBattleAnim(preBattle: BattleState, events: readonly BattleEvent[]): BattleAnim | null {
  const actionEv = events.find((e): e is Extract<BattleEvent, { type: "action" }> => e.type === "action");
  if (!actionEv || (actionEv.kind !== "attack" && actionEv.kind !== "skill")) return null;
  const dmgEv = events.find(
    (e): e is Extract<BattleEvent, { type: "damage" }> => e.type === "damage" && e.sourceId === actionEv.actorId,
  );
  if (!dmgEv) return null; // a miss/whiff — resolve immediately, no VFX
  const attackerPos = stagePositionOf(preBattle, dmgEv.sourceId);
  const targetPos = stagePositionOf(preBattle, dmgEv.targetId);
  if (!attackerPos || !targetPos) return null;
  return {
    attackerId: dmgEv.sourceId,
    targetId: dmgEv.targetId,
    kind: actionEv.kind,
    element: dmgEv.element,
    attackerPos,
    targetPos,
  };
}

function Bar({ kind, cur, max }: { kind: "hp" | "mp"; cur: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return (
    <div className={`bar ${kind}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
function CombatantCard({ c, active, level }: { c: Combatant; active: boolean; level?: number }) {
  return (
    <div className={`card ${c.alive ? "" : "fainted"} ${active ? "pick" : ""}`}>
      <div className="nm">
        <span>{c.name}</span>
        {level !== undefined && <span className="hint">Lv {level}</span>}
        <span className="rank">{active ? "▶" : ""}</span>
      </div>
      <Bar kind="hp" cur={c.currentHp} max={c.maxHp} />
      <Bar kind="mp" cur={c.currentMp} max={c.maxMp} />
    </div>
  );
}

function BattleScreen({ game, setGame, onPause }: ScreenProps & { onPause: () => void }) {
  const b = game.battle;
  // `anim` sequences a player action's reveal: doAction/doItem compute the
  // NEW state + events immediately (stepBattle/useItemInBattle are pure), but
  // instead of committing right away they stash the pending result here and
  // render the VFX/reactions against the CURRENT (pre-action) state for a
  // short window. Only once the window elapses does `commit()` call
  // `setGame(pending)` — so HP bars/faint/log all update AFTER the hit lands,
  // matching what the player just watched. `playBattleEvents` (audio) fires
  // at the same moment the VFX starts, i.e. as the hit connects, not after.
  // Gate: `anim !== null` disables the command grid so a player can't spam
  // actions mid-animation; `pending` always resolves via setTimeout, so a
  // stray null attacker/target position just skips VFX and commits at once
  // (deriveBattleAnim already returns null for those cases) — never a soft-lock.
  const [anim, setAnim] = useState<{
    battleAnim: BattleAnim | null;
    pending: GameState;
  } | null>(null);
  if (!b) return null;
  const actor = activeActor(b);
  const placedBase = battlePlaced(b);
  const rival = game.rivalBattleId ? game.rivals.find((p) => p.rival.id === game.rivalBattleId) : undefined;
  const guardianTitle = game.guardianBattleWorldId && game.zone ? GUARDIAN_TITLE[game.zone.descriptor.id] : undefined;

  // Which command sub-panel is showing: the main command grid, the skills
  // submenu, or the bag. Nesting skills/items keeps the command bar tidy (a
  // clean 3-column grid) instead of a crowded wrap that overlapped the cards.
  const [sub, setSub] = useState<"main" | "skills" | "items">("main");

  const commit = (pending: GameState) => {
    setSub("main");
    setGame(pending);
    setAnim(null);
  };

  const runWithAnim = (pending: GameState, events: readonly BattleEvent[]) => {
    const battleAnim = deriveBattleAnim(b, events);
    if (!battleAnim) {
      // Nothing to animate (miss/defend/scout/flee/item) — resolve at once.
      playBattleEvents(audio(), events);
      commit(pending);
      return;
    }
    setAnim({ battleAnim, pending });
    const durationMs = battleAnim.kind === "skill" ? SKILL_ANIM_MS : ATTACK_ANIM_MS;
    // Audio fires as the hit connects — roughly mid-window, matching the VFX
    // impact rather than the lunge's start.
    window.setTimeout(() => playBattleEvents(audio(), events), Math.round(durationMs * 0.35));
    window.setTimeout(() => commit(pending), durationMs);
  };

  const doAction = (act: Parameters<typeof stepBattle>[1]) => {
    if (anim) return; // input-gated while an animation is in flight
    audio().playUi("select");
    const { game: g2, events } = stepBattle(game, act);
    runWithAnim(g2, events);
  };
  const target = defaultTargetId(b);
  const items = usableBattleItems(game);
  const doItem = (itemId: string) => {
    if (anim) return;
    const tid = itemTargetId(b, itemId);
    if (!tid) return;
    audio().playUi("confirm");
    const { game: g2, events } = useItemInBattle(game, itemId, tid);
    runWithAnim(g2, events);
  };

  // Splice the in-flight reaction/lunge/VFX onto the pre-action placement so
  // GooberStage animates the SAME positions the player saw before pressing
  // the button (see the `anim` comment above for why commit is deferred).
  const placed: Placed[] = placedBase.map((p) => {
    if (!anim?.battleAnim) return p;
    const { attackerId, targetId } = anim.battleAnim;
    if (p.id === targetId) {
      return {
        ...p,
        reaction: { active: true, awayFrom: anim.battleAnim.attackerPos, onDone: noop },
      };
    }
    if (p.id === attackerId) {
      return { ...p, lunge: { active: true, toward: anim.battleAnim.targetPos, onDone: noop } };
    }
    return p;
  });

  const vfx = anim?.battleAnim ? (
    anim.battleAnim.kind === "attack" ? (
      <SlashVFX
        key="slash"
        position={[anim.battleAnim.targetPos[0], anim.battleAnim.targetPos[1] + 1.4, anim.battleAnim.targetPos[2]]}
        onDone={noop}
      />
    ) : (
      <ElementBurstVFX
        key="burst"
        element={anim.battleAnim.element}
        position={[anim.battleAnim.targetPos[0], anim.battleAnim.targetPos[1] + 0.4, anim.battleAnim.targetPos[2]]}
        onDone={noop}
      />
    )
  ) : null;

  return (
    <>
      <GooberStage
        placed={placed}
        cameraPos={[3, 7, 21]}
        fov={32}
        bg={guardianTitle ? "#d9b96a" : "#a9d9c0"}
        ground="#cfe6a8"
        vfx={vfx}
      />
      <div className="overlay">
        <HudBar
          title={guardianTitle ? `⚔ ${guardianTitle}` : rival ? `Rival battle · ${rival.rival.name}` : "Encounter"}
          subtitle={
            guardianTitle
              ? "The world's Guardian — win to recover this world's Heartseed."
              : rival
                ? `${rival.rival.name} challenges you with the team their journey has built.`
                : undefined
          }
          dexText={game.outcome ? game.outcome.toUpperCase().replace("-", " ") : b.phase}
          onMenu={onPause}
        />
        <div className="cards enemy">
          {b.enemyTeam.map((c) => (
            <CombatantCard
              key={c.id}
              c={c}
              active={actor?.id === c.id}
              level={enemyLevelForToken(c.token, !!guardianTitle)}
            />
          ))}
        </div>
        <div className="battle-bottom">
          {game.outcome === "guardian-win" && (
            <div className="battle-victory">{guardianTitle} falls — the world's Heartseed is recovered!</div>
          )}
          {game.lastLevelUps.length > 0 && (
            <div className="battle-victory">
              {game.lastLevelUps
                .map((up) => {
                  const t = game.roster.party.find((tk) => tk.id === up.tokenId);
                  const name = t ? creatureFromToken(t).name : up.tokenId;
                  return `${name} grew to Lv ${up.to}!`;
                })
                .join(" · ")}
            </div>
          )}
          <div className="log">
            {game.log.slice(-3).map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div className="cards player">
            {b.playerTeam.map((c) => (
              <CombatantCard
                key={c.id}
                c={c}
                active={actor?.id === c.id}
                level={levelOf(game.leveling, c.token.id)}
              />
            ))}
          </div>
          <div className="battle-commands">
            {game.outcome ? (
              <button className="act primary" style={{ gridColumn: "1 / -1" }}
                onClick={() => setGame(game.zone ? returnToZone(game) : leaveBattle(game))}>
                {game.zone ? `Back to ${ZONE_LABELS[game.zone.descriptor.id] ?? "the zone"} →` : "Return to the Town →"}
              </button>
            ) : actor && target ? (
              sub === "items" ? (
                <>
                  {items.length === 0 && <div className="hint" style={{ gridColumn: "1 / -1" }}>No usable items.</div>}
                  {items.map((it) => (
                    <button key={it.id} className="act" disabled={!!anim} onClick={() => doItem(it.id)}>
                      {it.name} <small>×{it.count}</small>
                    </button>
                  ))}
                  <button className="act" disabled={!!anim} onClick={() => setSub("main")}>← Back</button>
                </>
              ) : sub === "skills" ? (
                <>
                  {actor.skills.slice(0, 5).map((s) => (
                    <button key={s.id} className="act" disabled={!!anim || actor.currentMp < s.mpCost}
                      onClick={() => doAction({ type: "skill", skillId: s.id, targetId: target })}>
                      {s.name} <small>({s.mpCost})</small>
                    </button>
                  ))}
                  <button className="act" disabled={!!anim} onClick={() => setSub("main")}>← Back</button>
                </>
              ) : (
                <>
                  <button className="act primary" disabled={!!anim} onClick={() => doAction({ type: "attack", targetId: target })}>Attack</button>
                  <button className="act" disabled={!!anim || actor.skills.length === 0}
                    onClick={() => { audio().playUi("select"); setSub("skills"); }}>Skills ▸</button>
                  {/* A Guardian is a boss, not a companion to befriend — Scout is
                      hidden for a Guardian fight so victory is the only path to
                      its Heartseed. */}
                  {!guardianTitle && (
                    <button className="act bond" disabled={!!anim} onClick={() => doAction({ type: "scout", targetId: target })}>Scout 🤝</button>
                  )}
                  <button className="act" disabled={!!anim || items.length === 0}
                    onClick={() => { audio().playUi("select"); setSub("items"); }}>Bag 🎒</button>
                  <button className="act" disabled={!!anim} onClick={() => doAction({ type: "defend" })}>Defend</button>
                  <button className="act" disabled={!!anim} onClick={() => doAction({ type: "flee" })}>Flee</button>
                </>
              )
            ) : (
              <div className="hint" style={{ gridColumn: "1 / -1" }}>…resolving…</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function noop(): void {}

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
