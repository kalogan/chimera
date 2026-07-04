import { useEffect, useMemo, useRef, useState } from "react";
import { creatureFromToken } from "game-kit/creature";
import type { BattleState, Combatant } from "game-kit/battle";
import type { Dir } from "game-kit/world-runtime";
import { GooberStage, type Placed } from "./GooberStage.js";
import { ZoneScene } from "./ZoneScene.js";
import { audio, resumeAudio } from "./audio.js";
import { playBattleEvents } from "./battle-audio.js";
import {
  newGame,
  partyCreatures,
  collectionCreatures,
  dexTotal,
  enterZone,
  zoneStep,
  startEncounterWith,
  returnToZone,
  exitZone,
  activeActor,
  defaultTargetId,
  stepBattle,
  leaveBattle,
  openCradle,
  togglePick,
  breedPicked,
  backToParty,
  type GameState,
} from "./game.js";

export function App() {
  const [game, setGame] = useState<GameState>(() => newGame());
  const resumedRef = useRef(false);

  // Unlock procedural audio on the first user gesture (browser autoplay policy).
  const unlock = () => {
    if (!resumedRef.current) {
      resumedRef.current = true;
      void resumeAudio();
    }
  };

  return (
    <div onPointerDown={unlock} style={{ position: "fixed", inset: 0 }}>
      {game.screen === "party" && <PartyScreen game={game} setGame={setGame} />}
      {game.screen === "zone" && <ZoneScreen game={game} setGame={setGame} />}
      {game.screen === "battle" && <BattleScreen game={game} setGame={setGame} />}
      {game.screen === "cradle" && <CradleScreen game={game} setGame={setGame} />}
      {game.screen === "newborn" && <NewbornScreen game={game} setGame={setGame} />}
    </div>
  );
}

type ScreenProps = { game: GameState; setGame: (g: GameState) => void };

// ── Sanctuary / party ─────────────────────────────────────────────────────────
function PartyScreen({ game, setGame }: ScreenProps) {
  const party = useMemo(() => partyCreatures(game), [game]);
  const placed: Placed[] = party.map((c, i) => ({
    id: c.token.id,
    spec: c.gooberSpec,
    position: [(i - (party.length - 1) / 2) * 7, 2.5, 0],
    facing: 0,
    seed: i * 37 + 5,
  }));
  useEffect(() => {
    audio().startAmbient("sanctuary-aldercradle");
    return () => audio().stopAmbient();
  }, []);
  return (
    <>
      <GooberStage placed={placed} cameraPos={[0, 6, 34]} fov={28} />
      <div className="overlay">
        <div className="banner">
          <div>
            <div className="title">CHIMERA · The Sanctuary</div>
            <div className="subtitle">Aldercradle is fading — scout, bond, and breed new life.</div>
          </div>
          <div className="dex">Dex {dexTotal(game)} · Party {game.roster.party.length}/3 · Box {game.roster.storage.length}</div>
        </div>
        <div className="actionbar">
          <button className="act primary" onClick={() => { audio().playUi("confirm"); setGame(enterZone(game)); }}>
            Explore the meadow →
          </button>
          <button className="act bond" disabled={game.roster.party.length + game.roster.storage.length < 2}
            onClick={() => { audio().playUi("confirm"); setGame(openCradle(game)); }}>
            The Cradle (breed)
          </button>
        </div>
      </div>
    </>
  );
}

// ── Overworld: Meadowmere (Wave 2) ─────────────────────────────────────────────
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

function ZoneScreen({ game, setGame }: ScreenProps) {
  const zone = game.zone;
  const playerSpec = useMemo(() => partyCreatures(game)[0]?.gooberSpec, [game]);
  const busy = useRef(false); // locked while an encounter/portal transition plays
  const lastStep = useRef(0);

  useEffect(() => {
    audio().startAmbient("meadowmere-verdant");
    return () => audio().stopAmbient();
  }, []);

  // One step per press, rate-limited so a held key can't outrun the hop.
  const onStep = (dir: Dir) => {
    if (busy.current) return;
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
    } else if (pending?.kind === "portal") {
      busy.current = true;
      audio().playUi("confirm");
      window.setTimeout(() => setGame(exitZone(g2)), 260);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.code];
      if (dir) { e.preventDefault(); onStep(dir); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  if (!zone || !playerSpec) return null;

  return (
    <>
      <ZoneScene zone={zone} playerSpec={playerSpec} />
      <div className="overlay">
        <div className="banner">
          <div>
            <div className="title">Meadowmere</div>
            <div className="subtitle">Wild goobers roam — walk into one to meet it.</div>
          </div>
          <div className="dex">Dex {dexTotal(game)} · Party {game.roster.party.length}/3</div>
        </div>
        <div className="hint" style={{ position: "absolute", bottom: 116, left: 0, right: 0, textAlign: "center" }}>
          ↑↓←→ / WASD to walk · reach the golden ring to head home
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

function BattleScreen({ game, setGame }: ScreenProps) {
  const b = game.battle;
  if (!b) return null;
  const actor = activeActor(b);
  const placed = battlePlaced(b);

  const doAction = (act: Parameters<typeof stepBattle>[1]) => {
    audio().playUi("select");
    const { game: g2, events } = stepBattle(game, act);
    playBattleEvents(audio(), events);
    setGame(g2);
  };
  const target = defaultTargetId(b);

  return (
    <>
      <GooberStage placed={placed} cameraPos={[3, 7, 21]} fov={32} bg="#a9d9c0" ground="#cfe6a8" />
      <div className="overlay">
        <div className="banner">
          <div className="title">Encounter</div>
          <div className="dex">{game.outcome ? game.outcome.toUpperCase() : b.phase}</div>
        </div>
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
              {game.zone ? "Back to the meadow →" : "Return to the Sanctuary →"}
            </button>
          ) : actor && target ? (
            <>
              <button className="act primary" onClick={() => doAction({ type: "attack", targetId: target })}>Attack</button>
              {actor.skills.slice(0, 3).map((s) => (
                <button key={s.id} className="act" disabled={actor.currentMp < s.mpCost}
                  onClick={() => doAction({ type: "skill", skillId: s.id, targetId: target })}>
                  {s.name} <small>({s.mpCost})</small>
                </button>
              ))}
              <button className="act bond" onClick={() => doAction({ type: "scout", targetId: target })}>Scout 🤝</button>
              <button className="act" onClick={() => doAction({ type: "defend" })}>Defend</button>
              <button className="act" onClick={() => doAction({ type: "flee" })}>Flee</button>
            </>
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
