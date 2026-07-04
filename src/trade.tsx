/**
 * trade — Ferro Vantt's trade post (the Quartermaster's `opens: "trade"`
 * TownDialogue destination). Lists the player's STORAGE creatures (never the
 * active party — trading a party member would require swapping it to storage
 * first, which this screen doesn't offer, so "can't trade your last party
 * member" is enforced simply by never listing party tokens at all) with a
 * "Trade in for ◈<value>" button per row; `game.ts`'s `tradeCreature` removes
 * the token from storage (`roster.release`) and credits gold (`economy.
 * addGold`) in one call, auto-saving the same beat a breed/battle-leave does.
 *
 * Reuses the shop's `.shop-list`/`.shop-row` chrome (styles.css) and the
 * `GooberStage`/`Placed` 3D backdrop the Cradle/Market screens already use —
 * this file owns no new CSS, just a new screen component + its App.tsx wiring
 * point (`game.screen === "trade"`).
 */
import { useMemo } from "react";
import { creatureFromToken } from "game-kit/creature";
import { GooberStage, type Placed } from "./GooberStage.js";
import { audio } from "./audio.js";
import { creatureValue, tradeCreature, type GameState } from "./game.js";

export interface TradeScreenProps {
  game: GameState;
  setGame: (g: GameState) => void;
  onBack: () => void;
}

export function TradeScreen({ game, setGame, onBack }: TradeScreenProps) {
  const storageCreatures = useMemo(
    () => game.roster.storage.map((t) => creatureFromToken(t)),
    [game.roster.storage],
  );
  const placed: Placed[] = storageCreatures.map((c, i) => ({
    id: c.token.id,
    spec: c.gooberSpec,
    position: [(i - (storageCreatures.length - 1) / 2) * 6, 2.5, 0],
    facing: 0,
    seed: i * 41 + 3,
  }));

  const doTrade = (tokenId: string) => {
    audio().playUi("confirm");
    setGame(tradeCreature(game, tokenId));
  };

  return (
    <>
      <GooberStage
        placed={placed}
        cameraPos={[0, 6, Math.max(28, storageCreatures.length * 6)]}
        fov={30}
        bg="#dce6d4"
        ground="#a9bf8a"
      />
      <div className="overlay">
        <div className="banner">
          <div>
            <div className="title">The Trade Post</div>
            <div className="subtitle">
              Ferro Vantt keeps an honest ledger — trade in a companion from your box for gold.
            </div>
          </div>
          <div className="dex">◈ {game.economy.gold} gold</div>
        </div>
        <div className="shop-list">
          {storageCreatures.length === 0 && (
            <div className="hint">Your box is empty — nothing here to trade yet.</div>
          )}
          {storageCreatures.map((c) => {
            const value = creatureValue(c);
            return (
              <div key={c.token.id} className="shop-row">
                <div className="shop-info">
                  <div className="shop-name">
                    {c.name} <small>{c.family} · rank {c.rank}</small>
                  </div>
                  <div className="hint">
                    gen {c.token.generation}
                    {c.token.plus > 0 ? ` · +${c.token.plus}` : ""}
                  </div>
                </div>
                <div className="shop-buy">
                  <button className="act primary" onClick={() => doTrade(c.token.id)}>
                    Trade in for ◈{value}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="actionbar">
          <button className="act" onClick={() => { audio().playUi("back"); onBack(); }}>
            ← Back to town
          </button>
        </div>
      </div>
    </>
  );
}
