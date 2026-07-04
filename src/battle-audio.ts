import type { BattleEvent } from "game-kit/battle";
import type { SpatialAudio } from "game-kit/spatial-audio";

// Drive procedural audio off the SAME BattleEvent stream the visuals consume —
// audio is first-class, never re-deriving combat. Events are staggered so a turn's
// sounds read sequentially rather than piling up in one instant.
export function playBattleEvents(sa: SpatialAudio, events: readonly BattleEvent[]): void {
  let delay = 0;
  const at = (ms: number, fn: () => void) => {
    setTimeout(fn, ms);
  };
  for (const ev of events) {
    switch (ev.type) {
      case "damage":
        at(delay, () => sa.playImpact(ev.amount, ev.element));
        delay += 200;
        break;
      case "action":
        if (ev.kind === "skill") {
          at(delay, () => sa.playSkill("light"));
          delay += 140;
        }
        break;
      case "heal":
        at(delay, () => sa.playSkill("water"));
        delay += 180;
        break;
      case "faint":
        at(delay, () => sa.playFaint());
        delay += 260;
        break;
      case "scout":
        at(delay, () => sa.playScout(ev.success));
        delay += 300;
        break;
      case "level-up":
        at(delay, () => sa.playLevelUp());
        delay += 260;
        break;
      case "buff":
      case "debuff":
        at(delay, () => sa.playSkill("wind"));
        delay += 140;
        break;
      default:
        break;
    }
  }
}
