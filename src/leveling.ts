/**
 * leveling — CHIMERA's Polymatrix-adapted XP/level system: a per-creature
 * `{ level, exp }` pair, ORTHOGONAL to the existing rank/`+`/generation axis
 * (`CreatureToken.plus`/`generation` — see game-kit/creature). A creature's
 * TOKEN already encodes its bred lineage/rank via `creatureFromToken`; this
 * module layers a SEPARATE, auto-assigned growth axis on top (DQM/Polymatrix
 * both let a monster level up AND keep its rank-up "+" track), with no manual
 * stat-point allocation — leveling is fully automatic from battle XP alone.
 *
 * Design (LOCKED with the Director):
 *   - effective stats = token base stats (rank/plus/gen already baked in by
 *     `creatureFromToken`) + level growth, via a per-FAMILY bias table so
 *     each family's growth identity reads distinctly (golem/beast lean
 *     HP/DEF, bird leans AGI, spirit leans WIS/MP, dragon leans ATK, slime
 *     is HP/balanced, aquatic/nature lean balanced/WIS).
 *   - level 1 is (by construction) the token's base stats exactly — growth
 *     is `(level - 1) * bias`, so a fresh level-1 creature shows no bump yet.
 *   - level cap 50, a GENTLE quadratic exp curve (`expForLevel`) tuned so
 *     early levels come fast (see the module-level tuning note below) rather
 *     than Polymatrix's steep cubic `n^3`.
 *   - XP-on-win = enemyLevel * K_XP, granted to EVERY surviving/participating
 *     party member (not split), summed across a defeated enemy team.
 *
 * PERSISTED in save.ts's `SaveData.leveling` (additive/optional — see that
 * module's own note); keyed by CreatureToken.id so it survives being bred/
 * scouted/stored (nothing here depends on party vs. storage placement).
 */
import type { CreatureToken, Creature, Family, StatBlock } from "game-kit/creature";
import { creatureFromToken } from "game-kit/creature";

/** A creature not yet in the map defaults to level 1, exp 0 — see `levelOf`/`expOf`. */
export interface LevelState {
  level: number;
  exp: number;
}

/** tokenId -> its leveling progress. Missing entries mean "level 1, exp 0". */
export type LevelingState = Record<string, LevelState>;

export function createLeveling(): LevelingState {
  return {};
}

export const LEVEL_CAP = 50;

/** A fresh/unlisted creature's level. */
const DEFAULT_LEVEL = 1;

export function levelOf(leveling: LevelingState, tokenId: string): number {
  return leveling[tokenId]?.level ?? DEFAULT_LEVEL;
}

export function expOf(leveling: LevelingState, tokenId: string): number {
  return leveling[tokenId]?.exp ?? 0;
}

// ── the gentle/cozy XP curve ─────────────────────────────────────────────────
//
// Polymatrix's own curve is a steep cubic (`n^3`) — deliberately grindy. Ours
// is a softer QUADRATIC, `K * n^2`, so a player levels up often early (L2 is
// cheap) while L50 stays a real, distant-but-reachable goal for a dedicated
// playthrough. K=4 was tuned by simulation (see the report): a full ~320-win
// 8-world journey (40 wins/world tier, XP = enemyLevel * K_XP with K_XP=7)
// lands the party in the low 30s — L50 is there for grinders, never required.
const EXP_CURVE_K = 4;

/** Exp needed to advance from `level - 1` to `level` (level >= 2; the cost to
 *  "reach" level 1 is 0 — everyone starts there). Monotonically increasing. */
export function expForLevel(level: number): number {
  if (level <= 1) return 0;
  const lvl = Math.min(level, LEVEL_CAP);
  return Math.round(EXP_CURVE_K * lvl * lvl);
}

/**
 * Add `amount` exp to a single creature's progress, carrying over remainder
 * across as many level-ups as the exp supports, clamped at `LEVEL_CAP` (extra
 * exp beyond the cap is simply dropped — a capped creature has nothing left
 * to spend it on). Returns the new `LevelState` + how many levels were gained
 * (0 if the creature is already capped or the amount didn't reach a level-up).
 */
export function addExpToCreature(
  state: LevelState,
  amount: number,
): { next: LevelState; levelsGained: number; from: number; to: number } {
  const from = state.level;
  if (state.level >= LEVEL_CAP || amount <= 0) {
    return { next: state, levelsGained: 0, from, to: from };
  }
  let level = state.level;
  let exp = state.exp + amount;
  let levelsGained = 0;
  while (level < LEVEL_CAP) {
    const need = expForLevel(level + 1);
    if (exp < need) break;
    exp -= need;
    level += 1;
    levelsGained += 1;
  }
  if (level >= LEVEL_CAP) {
    level = LEVEL_CAP;
    exp = 0; // nothing left to spend at the cap
  }
  return { next: { level, exp }, levelsGained, from, to: level };
}

/** Apply `amount` XP to `tokenId` within a whole `LevelingState`, forward-
 *  filling a missing entry to the level-1/exp-0 default first. */
export function addExp(
  leveling: LevelingState,
  tokenId: string,
  amount: number,
): { next: LevelingState; levelsGained: number; from: number; to: number } {
  const current = leveling[tokenId] ?? { level: DEFAULT_LEVEL, exp: 0 };
  const { next, levelsGained, from, to } = addExpToCreature(current, amount);
  return { next: { ...leveling, [tokenId]: next }, levelsGained, from, to };
}

// ── XP granted on a battle win ───────────────────────────────────────────────

/** enemyLevel * K_XP, small so a single win never blows past the gentle
 *  curve's early levels — tuned alongside EXP_CURVE_K (see the report). */
export const K_XP = 7;

export function xpForWin(enemyLevel: number): number {
  return Math.max(1, Math.round(enemyLevel * K_XP));
}

/** Total XP a defeated enemy TEAM grants — summed, then awarded in full to
 *  EVERY participating party member (not split per-survivor, per the LOCKED
 *  design: leveling should feel generous to a full 3-mon party). */
export function xpForDefeatedTeam(enemyLevels: readonly number[]): number {
  return enemyLevels.reduce((sum, lvl) => sum + xpForWin(lvl), 0);
}

/** Grant `amount` XP to every token id in `tokenIds` (typically the whole
 *  party), returning the updated LevelingState + a per-creature level-up
 *  summary (only entries that actually gained a level) for the victory banner. */
export function grantXpToParty(
  leveling: LevelingState,
  tokenIds: readonly string[],
  amount: number,
): { next: LevelingState; levelUps: { tokenId: string; from: number; to: number }[] } {
  let next = leveling;
  const levelUps: { tokenId: string; from: number; to: number }[] = [];
  for (const id of tokenIds) {
    const result = addExp(next, id, amount);
    next = result.next;
    if (result.levelsGained > 0) {
      levelUps.push({ tokenId: id, from: result.from, to: result.to });
    }
  }
  return { next, levelUps };
}

// ── per-family stat growth bias ─────────────────────────────────────────────
//
// Distinct growth identity per family, applied as `stat = base + (level-1) *
// bias[stat]`, so level 1 is exactly the token's base stats (no bump yet) and
// growth compounds gently thereafter. Biases are deliberately SMALL (a single
// level should read as a nudge, not a reroll) — by L50 (49 growth steps) a
// beast's ~34 base HP has grown by 49*1.1 ≈ +54, roughly tripling it, which
// feels earned over a long playthrough without a level trivializing the rank/
// plus/gen axis that already scales stats multiplicatively.
const LEVEL_BIAS: Record<Family, StatBlock> = {
  // Beast — high HP/DEF, a sturdy melee brawler.
  beast: { hp: 1.1, mp: 0.15, atk: 0.55, def: 0.5, agi: 0.25, wis: 0.1 },
  // Bird — high AGI, the speedster.
  bird: { hp: 0.6, mp: 0.3, atk: 0.4, def: 0.2, agi: 1.0, wis: 0.25 },
  // Dragon — high ATK, the heavy hitter.
  dragon: { hp: 0.85, mp: 0.35, atk: 1.05, def: 0.4, agi: 0.3, wis: 0.3 },
  // Slime — HP/balanced, a soft generalist that just gets tankier.
  slime: { hp: 0.95, mp: 0.35, atk: 0.35, def: 0.4, agi: 0.3, wis: 0.35 },
  // Aquatic — balanced/WIS, a steady support-leaning grower.
  aquatic: { hp: 0.7, mp: 0.4, atk: 0.4, def: 0.4, agi: 0.35, wis: 0.5 },
  // Nature — balanced/WIS, similar spirit to aquatic but a touch tankier.
  nature: { hp: 0.75, mp: 0.4, atk: 0.35, def: 0.45, agi: 0.25, wis: 0.55 },
  // Golem — high HP/DEF, the ultimate wall (even sturdier than beast).
  golem: { hp: 1.3, mp: 0.1, atk: 0.5, def: 0.75, agi: 0.1, wis: 0.1 },
  // Spirit — high WIS/MP, the caster.
  spirit: { hp: 0.55, mp: 0.9, atk: 0.35, def: 0.2, agi: 0.35, wis: 0.95 },
};

/** Growth-only stat delta for `family` at `level` (0 at level 1). Exposed for
 *  tests/tuning; `leveledStats` below is the one most callers want. */
export function growthAt(family: Family, level: number): StatBlock {
  const bias = LEVEL_BIAS[family];
  const steps = Math.max(0, Math.min(LEVEL_CAP, level) - 1);
  return {
    hp: bias.hp * steps,
    mp: bias.mp * steps,
    atk: bias.atk * steps,
    def: bias.def * steps,
    agi: bias.agi * steps,
    wis: bias.wis * steps,
  };
}

/** Base stats (rank/plus/gen already applied) + this family's level growth,
 *  rounded. Accepts either a `Creature` or a `CreatureToken` (expressing the
 *  token itself when needed) so callers with only a token on hand (e.g. an
 *  enemy roamer/Guardian built directly from a token) don't need to pre-express
 *  a `Creature` just to compute leveled stats. */
export function leveledStats(subject: Creature | CreatureToken, level: number): StatBlock {
  const creature: Creature = "stats" in subject ? subject : creatureFromToken(subject);
  const growth = growthAt(creature.family, level);
  return {
    hp: Math.round(creature.stats.hp + growth.hp),
    mp: Math.round(creature.stats.mp + growth.mp),
    atk: Math.round(creature.stats.atk + growth.atk),
    def: Math.round(creature.stats.def + growth.def),
    agi: Math.round(creature.stats.agi + growth.agi),
    wis: Math.round(creature.stats.wis + growth.wis),
  };
}

/** A `Creature` with its `stats` replaced by `leveledStats` at `level` — the
 *  shape `createBattle`/combatant construction actually wants (it reads
 *  `Creature.stats` directly), so callers can build a leveled roster without
 *  hand-spreading the stat block themselves. */
export function creatureAtLevel(creature: Creature, level: number): Creature {
  return { ...creature, stats: leveledStats(creature, level) };
}
