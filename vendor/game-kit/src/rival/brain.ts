/**
 * rival/brain — the SWAPPABLE BRAIN seam. A dev inspector can run the SAME
 * `RivalState` through a deterministic `utilityBrain` or an LLM-backed
 * `createGrokRivalBrain(...)` and render both `DecisionTrace`s side by side —
 * "switch between brains to visualize the difference."
 *
 * MIRRORS the kit's existing npc Provider → Firewall → Bridge layering
 * (`../npc/provider.ts`, `../npc/openaiProvider.ts`, `../npc/budgetedProvider.ts`,
 * `../npc/schema.ts`) rather than reinventing it:
 *
 *   Provider — `../npc`'s `ReasoningProvider.complete(system, user, signal)`,
 *     e.g. `createGrokProvider` (an OpenAI-compatible call to xAI), wrapped in
 *     `createBudgetedProvider`/`toBudgetedProvider` for timeout + rate/budget +
 *     graceful fallback. NO new HTTP plumbing here — just reuse.
 *
 *   Firewall — `parseRivalGoalChoice` below: a strict zod schema that accepts
 *     ONLY `{ goal, why }` where `goal` is in `enumerateOptions(rival, ctx)` —
 *     `../rival/index.ts`'s SINGLE SOURCE OF TRUTH for "what's legal right
 *     now," derived from live content (zone, zonePool, owned tokens, dex,
 *     breedable pairs, affordable shop stock). Anything else (bad JSON, an
 *     out-of-enum goal, a goal that's legal in general but not right now, an
 *     empty reply, a thrown/aborted call) is DROPPED, never applied.
 *
 *   Bridge — `createGrokRivalBrain` composes provider + firewall into a
 *     `RivalBrain`; on ANY failure it DEGRADES to the plain deterministic
 *     `decideRival` so a decision ALWAYS results (`source: 'utility-fallback'`).
 *
 * ONE SOURCE OF TRUTH FOR THE OPTION SPACE: both brains derive what's legal
 * from `enumerateOptions(rival, ctx)` and NOTHING else. `utilityBrain` scores
 * exactly those candidates (via `decideRival`, which calls the same
 * `buildScoreCtx`/`SCORERS` pass `enumerateOptions` filters). The Grok brain's
 * prompt menu AND its firewall's accept-set are both `enumerateOptions(...)`
 * output, read fresh per call — so as content grows (new zones in `zonePool`,
 * more owned tokens, more affordable shop items, or a new goal added to
 * `RIVAL_GOALS`/`SCORERS` in `../rival/index.ts`), both brains automatically
 * see the same, current option space with no hardcoded list to keep in sync.
 *
 * THE GAME KEEPS AUTHORITY: a brain only CHOOSES a goal (+ a short `intent`
 * narration); it never executes anything. `stepRivalWithBrain` calls
 * `brain.decide` then applies the trace through the exact same
 * `applyDecision` reducer-switch the sync `stepRival` uses, and any concrete
 * action payload (a drawn foe, a breeding pair, a shop item) is built via the
 * exported `chooseActionForGoal` — the SAME action-building code path
 * `decideRival` uses internally, so no execution/action logic is duplicated
 * between the two brains.
 */

import { z } from 'zod';
import {
  decideRival,
  enumerateOptions,
  chooseActionForGoal,
  applyDecision,
  stepRng,
  RIVAL_GOALS,
  type RivalState,
  type RivalCtx,
  type RivalGoal,
  type DecisionTrace,
} from './index.js';
import type { ReasoningProvider } from '../npc/provider.js';
import {
  toBudgetedProvider,
  type BudgetedProvider,
  type BudgetedProviderOptions,
} from '../npc/budgetedProvider.js';

// ── the swappable-brain seam ─────────────────────────────────────────────────

/**
 * A pluggable DECISION MAKER for a rival. A brain only CHOOSES intent (a goal,
 * with a short human-readable `why`) — it never applies anything. Execution
 * always goes through `applyDecision`/`stepRivalWithBrain`, so the game keeps
 * authority no matter which brain is plugged in (the firewall).
 */
export interface RivalBrain {
  /** Stable id for diagnostics/telemetry + inspector badges (e.g. 'utility', 'grok'). */
  readonly id: string;
  /** Human-readable label an inspector UI can show in a picker (e.g. 'Utility AI'). */
  readonly label: string;
  /**
   * Decide the next `DecisionTrace` for `rival` in `ctx`. MUST resolve — a brain
   * that can fail (an LLM call) is responsible for degrading internally to a
   * legal decision (see `createGrokRivalBrain`); this contract never rejects.
   */
  decide(rival: RivalState, ctx: RivalCtx, signal?: AbortSignal): Promise<DecisionTrace>;
}

/**
 * The deterministic utility brain — a thin async wrapper around the existing,
 * synchronous `decideRival`. Identical output to calling `decideRival` directly
 * (same trace, same `chosen`, no `source` stamped) so the inspector's "utility"
 * pane and the plain sync API never diverge. Scores exactly the candidates
 * `enumerateOptions` would report legal (via `decideRival`'s own internal use
 * of the same scoring pass) — the same option space the Grok brain reads.
 */
export const utilityBrain: RivalBrain = {
  id: 'utility',
  label: 'Utility AI',
  async decide(rival: RivalState, ctx: RivalCtx): Promise<DecisionTrace> {
    return decideRival(rival, ctx);
  },
};

// ── the Grok brain's firewall ────────────────────────────────────────────────

/** The wire shape a Grok reply must match: one goal + an optional short reason. */
const RawGoalChoiceSchema = z
  .object({
    goal: z.string(),
    why: z.string().max(240).optional(),
  })
  .strict();

/** Max characters kept from a model's `why` narration (defence in depth). */
const MAX_WHY_LEN = 240;

/** Strip a leading ```json / ``` fence if the model wrapped its JSON in one. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, '');
  return withoutOpen.replace(/\n?```\s*$/, '');
}

/** A validated, legal goal choice — or null if the raw reply didn't yield one. */
export interface RivalGoalChoice {
  goal: RivalGoal;
  why: string;
}

/**
 * THE FIREWALL. Parse a raw Grok `complete(...)` reply into a `RivalGoalChoice`,
 * or `null` if it fails ANY check: not valid JSON, wrong shape, or `goal` is
 * not a member of `legal` — the CALLER-SUPPLIED legal set, which MUST be
 * `enumerateOptions(rival, ctx)` for this exact state (never a hardcoded
 * list). A goal outside `RIVAL_GOALS` entirely is naturally excluded because
 * `legal` is itself a filter over `RIVAL_GOALS`. Never throws.
 */
export function parseRivalGoalChoice(raw: unknown, legal: readonly RivalGoal[]): RivalGoalChoice | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    const text = stripCodeFence(value).trim();
    if (text.length === 0) return null;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }

  const parsed = RawGoalChoiceSchema.safeParse(value);
  if (!parsed.success) return null;

  const goal = parsed.data.goal as RivalGoal;
  if (!legal.includes(goal)) return null; // not in the live legal set — drop

  const why = (parsed.data.why ?? '').trim().slice(0, MAX_WHY_LEN);
  return { goal, why };
}

// ── prompt building ──────────────────────────────────────────────────────────

/**
 * Build the system prompt describing the rival's persona and the response
 * contract. Does NOT enumerate goals itself — the legal menu is injected into
 * the USER prompt from `enumerateOptions`, so there is exactly one place
 * (`buildUserPrompt`) that turns the live option space into prompt text.
 */
function buildSystemPrompt(rival: RivalState): string {
  const p = rival.personality;
  return (
    `You are the strategist for an AI rival named "${rival.name}" in a creature-collecting game. ` +
    `Personality "${p.name}": collect=${p.collect.toFixed(2)}, breed=${p.breed.toFixed(2)}, power=${p.power.toFixed(2)}` +
    (p.favoredFamily ? `, favors the ${p.favoredFamily} family` : '') +
    `. Choose ONE goal for this rival's next turn from the legal goals list you are given — ` +
    `never invent a goal outside that list. ` +
    `Reply with STRICT JSON ONLY, no prose, no code fences: {"goal": "<one legal goal>", "why": "<short reason, under ${MAX_WHY_LEN} chars>"}.`
  );
}

/**
 * Build the user prompt: the rival's current state + the LIVE legal-goal menu
 * from `enumerateOptions`. This is the ONLY place the option space is rendered
 * into prompt text, so the menu the model sees is always exactly
 * `enumerateOptions(rival, ctx)` — the same set the firewall will validate
 * against and the utility brain scored.
 */
function buildUserPrompt(rival: RivalState, ctx: RivalCtx, legal: readonly RivalGoal[]): string {
  const owned = [...rival.roster.party, ...rival.roster.storage];
  const wildPool = ctx.zonePool[rival.currentZone] ?? [];
  const breedablePairs = owned.length >= 2 ? Math.floor(owned.length / 2) : 0;

  const lines = [
    `Zone: ${rival.currentZone}`,
    `Party size: ${rival.roster.party.length}, storage: ${rival.roster.storage.length}`,
    `Gold: ${rival.economy.gold}`,
    `Wild pool available in this zone: ${wildPool.length} creature(s)`,
    `Breedable pairs available: ${breedablePairs}`,
    `Legal goals right now (choose ONLY from this list): ${legal.join(', ')}`,
    `Choose the single best goal from the legal list above and explain why in one short sentence.`,
  ];
  return lines.join('\n');
}

// ── the Grok brain ────────────────────────────────────────────────────────────

/** Options for {@link createGrokRivalBrain}. */
export interface GrokRivalBrainOptions {
  /** Stable per-rival key for the budget wrapper's per-"player" rate limit. Default `rival.id`. */
  playerKey?: string;
  /** Budget/timeout tuning passed to `toBudgetedProvider` when `provider` is raw. */
  budget?: BudgetedProviderOptions;
  /** Display label for an inspector picker. Default 'Grok'. */
  label?: string;
}

/**
 * Create a `RivalBrain` backed by an LLM `ReasoningProvider` (typically
 * `createGrokProvider` from `../npc`, or a stub in tests). Reuses the kit's
 * existing provider + budget plumbing rather than reimplementing HTTP/timeout
 * handling: `provider` is auto-wrapped in `toBudgetedProvider` (idempotent — an
 * already-budgeted provider is accepted as-is).
 *
 * `decide` ALWAYS resolves to a legal `DecisionTrace`:
 *   - success + firewall-accepted → `source: 'grok'`, `chosen`/`intent` from the
 *     model. Its concrete `RivalAction` is built via `chooseActionForGoal` —
 *     the SAME action-construction code `decideRival` uses — forking the same
 *     `stepRng(rival)` lineage, so a Grok pick is exactly as deterministic
 *     (given the model's goal) as a utility pick would be for that goal.
 *     `options` is the utility scoring for ALL enumerated candidates, so the
 *     inspector can compare the model's pick against the deterministic scores
 *     on the SAME candidate list.
 *   - reject (goal outside `enumerateOptions`), empty reply, throw, or
 *     timeout → DEGRADE to `decideRival` (the plain utility decision),
 *     stamped `source: 'utility-fallback'` so the inspector shows honestly
 *     that Grok's answer was NOT used.
 */
export function createGrokRivalBrain(
  provider: ReasoningProvider | BudgetedProvider,
  opts: GrokRivalBrainOptions = {},
): RivalBrain {
  const budgeted = toBudgetedProvider(provider, opts.budget ?? {});
  const label = opts.label ?? 'Grok';

  return {
    id: 'grok',
    label,

    async decide(rival: RivalState, ctx: RivalCtx, signal?: AbortSignal): Promise<DecisionTrace> {
      const utility = decideRival(rival, ctx);
      // THE single source of truth for the option space — read fresh, every
      // call, from live content. Both the prompt menu and the firewall below
      // use this SAME array reference; nothing else defines "legal" here.
      const legal = enumerateOptions(rival, ctx);

      const systemPrompt = buildSystemPrompt(rival);
      const userPrompt = buildUserPrompt(rival, ctx, legal);
      const playerKey = opts.playerKey ?? rival.id;
      // An empty safeDefault fails JSON.parse in the firewall below, which is
      // exactly the "no usable choice" signal that degrades to the utility
      // trace — so budget-exhaustion/timeout/empty-reply all funnel through
      // the identical fallback path as a rejected/malformed choice.
      const safeDefault = '';

      let raw: string;
      try {
        raw = await budgeted.complete(systemPrompt, userPrompt, { playerKey, safeDefault });
      } catch {
        raw = '';
      }

      const choice = signal?.aborted ? null : parseRivalGoalChoice(raw, legal);
      if (!choice) {
        return { ...utility, source: 'utility-fallback', provider: budgeted.name };
      }

      // The model chose a LEGAL goal (validated against `legal` above). Reuse
      // the utility's action when it happens to match the argmax; otherwise
      // build a real action for the model's own goal via the SAME builder
      // `decideRival` uses, forking the SAME rng lineage for determinism.
      const action =
        choice.goal === utility.chosen
          ? utility.action
          : chooseActionForGoal(rival, ctx, choice.goal, stepRng(rival));

      return {
        step: utility.step,
        goal: choice.goal,
        options: utility.options,
        chosen: choice.goal,
        action,
        intent: choice.why.length > 0 ? choice.why : utility.intent,
        source: 'grok',
        provider: budgeted.name,
      };
    },
  };
}

// ── async step: brain decides, applyDecision executes ───────────────────────

/**
 * ASYNC counterpart to `stepRival`: `brain.decide(...)` chooses the trace, then
 * `applyDecision` executes it via the SAME reducer-switch the sync utility path
 * uses — no duplicated execution logic between the two paths. Works with
 * `utilityBrain`, `createGrokRivalBrain(...)`, or any custom `RivalBrain`.
 */
export async function stepRivalWithBrain(
  rival: RivalState,
  ctx: RivalCtx,
  brain: RivalBrain,
  signal?: AbortSignal,
): Promise<{ rival: RivalState; trace: DecisionTrace }> {
  const trace = await brain.decide(rival, ctx, signal);
  const next = applyDecision(rival, ctx, trace);
  return { rival: next, trace };
}

// Re-export so a consumer only needs `rival/brain.ts` for the whole
// swappable-brain surface, without also importing from `./index.js` directly
// for the enumerator an inspector wants to render ("here are the N options
// both brains saw").
export { enumerateOptions, RIVAL_GOALS };
