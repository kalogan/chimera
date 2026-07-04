/**
 * town-dialogue — the bottom-box JRPG/SMT-style dialogue overlay for TOWN
 * villagers. A plain, FIXED DOM overlay (no Canvas dependency) so it can sit
 * over `town-scene.tsx`'s `<Canvas>` (or anywhere else) and take real
 * keyboard focus for the chat input. Mirrors GYRE's `HollowDialogue`
 * (`hollow-dialogue.tsx`) in spirit — a running transcript + a headline
 * "current line" + free-text chat — but tuned for CHIMERA's warm, wistful
 * town rather than the Hollow's cold/spare register, and adds the
 * villager-role affordances (open-shop / open-cradle / offered quests) the
 * mission asks for.
 *
 * DECOUPLED: takes a `villager` (from `town.ts`) + callbacks. It builds its
 * OWN conversation brain internally (mock by default; pass `brain` to swap in
 * a differently-wired one, e.g. one using `createProxyConversationProvider`
 * from `town-grok.ts` for a live villager) — no import of `game.ts`/`App.tsx`/
 * `GameState`. `onAction`/`onClose`/`onAcceptQuest` are the only way this
 * component talks back to its caller.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createNpcBrain,
  createMockProvider,
  createInMemoryNpcStore,
  createHashingEmbedder,
  type NpcBrain,
  type NpcInfo,
  type ReasoningProvider,
} from "../vendor/game-kit/src/npc/runtime.js";
// `ReasoningPersona` lives on the zod schema; pulled in TYPE-ONLY so this
// stays zod-free at build (an `import type` is fully erased — same trick
// GYRE's hollow-dialogue.tsx uses).
import type { ReasoningPersona } from "game-kit/npc";
import type { TownAction, TownQuest, TownVillager, VillagerRole } from "./town.js";
import "./town.css";

/** A single visible line in the running transcript. */
export interface TownDialogueTurn {
  who: "you" | "villager";
  text: string;
}

/** The wired conversation brain for ONE villager, built by `useVillagerBrain`
 *  (or supplied directly to `<TownDialogue brain={...}>` by a caller that
 *  wants a live provider — see `town-grok.ts`). */
export interface VillagerBrain {
  brain: NpcBrain;
  npcId: string;
}

const PLAYER_KEY = "traveler";

/** Turn a `TownVillager`'s plain-string persona into the kit's structured
 *  `ReasoningPersona` (role/knowledgeScope/goals/voice). Town personas are
 *  authored as one rich descriptive string, so we fold it wholesale into
 *  `role` and keep `knowledgeScope`/`voice` short + derived — plenty for the
 *  mock/selector paths, and still a reasonable prompt frame for a live model. */
function personaFor(villager: TownVillager): ReasoningPersona {
  return {
    role: `${villager.name}, ${villager.persona}`,
    knowledgeScope: `life in this town; ${roleKnowledge(villager.role)}`,
    goals: ["make the traveler feel welcome", "speak warmly and in character"],
    voice: "warm, a little wistful, DQM-charm-meets-Ghibli-tenderness — never curt",
  };
}

function roleKnowledge(role: VillagerRole): string {
  switch (role) {
    case "keeper":
      return "the breeding cradle and The Fading";
    case "shopkeeper":
      return "wares, tonics, and prices";
    case "loremaster":
      return "the creature dex and every family's lineage";
    case "quartermaster":
      return "the trade post and fair dealing";
    case "questgiver":
      return "the town's errands and favors";
    case "storyteller":
      return "rumors and half-true tales from every zone";
  }
}

/**
 * Build + memoize a client-side conversation brain for ONE villager, wired to
 * the kit's zod-free runtime (`game-kit/npc/runtime`, imported here by
 * relative path — CHIMERA's tsconfig/vite alias map doesn't yet carry a
 * `game-kit/npc/runtime` entry the way GYRE's does, so this reaches the
 * vendored file directly; still zero zod, see town-grok.ts's note). DEFAULTS
 * TO THE MOCK PROVIDER (deterministic, offline, no key) — pass a different
 * raw provider (e.g. `createProxyConversationProvider()` from `town-grok.ts`)
 * to go live; `createNpcBrain` auto-wraps whichever you pass in the same
 * budget/timeout/scripted-fallback firewall.
 */
export function useVillagerBrain(villager: TownVillager, provider?: ReasoningProvider): VillagerBrain {
  return useMemo<VillagerBrain>(() => {
    const info: NpcInfo = {
      name: villager.name,
      persona: personaFor(villager),
      fallbackLines: villager.fallbackLines,
      retentionDays: 0,
    };
    const brain = createNpcBrain({
      provider: provider ?? createMockProvider(villager.fallbackLines),
      store: createInMemoryNpcStore(),
      embedder: createHashingEmbedder(),
      getNpcInfo: (npcId) => (npcId === villager.id ? info : undefined),
    });
    return { brain, npcId: villager.id };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [villager.id]);
}

export interface TownDialogueProps {
  /** The villager the player is talking to. */
  villager: TownVillager;
  /** The Architect routes this to the real subsystem (shop/cradle/dex/quests/trade). */
  onAction: (action: TownAction) => void;
  /** Close the dialogue overlay. */
  onClose: () => void;
  /** OPTIONAL pre-wired brain (e.g. from a caller managing brains across
   *  villagers so memory persists between visits). Defaults to a fresh
   *  `useVillagerBrain(villager)` — mock provider, in-memory-per-mount. */
  brain?: VillagerBrain;
  /** Quests the Questgiver currently offers (Architect-owned data). */
  offeredQuests?: TownQuest[];
  /** Fired when the player accepts an offered quest. */
  onAcceptQuest?: (id: string) => void;
}

const ROLE_BUTTON_LABEL: Record<VillagerRole, string | undefined> = {
  keeper: "To the Cradle →",
  shopkeeper: "Browse wares →",
  loremaster: "Open the Dex →",
  quartermaster: "Open Trade →",
  questgiver: undefined, // the questgiver's affordance is the quest list, not a single button
  storyteller: undefined, // pure banter — nothing to open
};

export function TownDialogue({
  villager,
  onAction,
  onClose,
  brain: brainProp,
  offeredQuests,
  onAcceptQuest,
}: TownDialogueProps) {
  const ownBrain = useVillagerBrain(villager);
  const { brain } = brainProp ?? ownBrain;

  const [turns, setTurns] = useState<TownDialogueTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    inputRef.current?.focus();
    return () => {
      alive.current = false;
    };
  }, [villager.id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || thinking) return;
      setDraft("");
      setTurns((t) => [...t, { who: "you", text }]);
      setThinking(true);

      let reply = "";
      try {
        const res = await brain.say({
          npcId: villager.id,
          playerKey: PLAYER_KEY,
          characterId: `traveler:${villager.id}`,
          text,
        });
        if (res) reply = res.text;
      } catch {
        // brain.say never rejects, but stay defensive.
      }
      if (!reply) reply = villager.fallbackLines[0] ?? "...";
      if (!alive.current) return;
      setThinking(false);
      setTurns((t) => [...t, { who: "villager", text: reply }]);
      inputRef.current?.focus();
    },
    [brain, thinking, villager.id, villager.fallbackLines],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const lastVillagerTurn = [...turns].reverse().find((t) => t.who === "villager");
  const openingLine = villager.fallbackLines[0] ?? "...";
  const currentLine = thinking ? "…" : (lastVillagerTurn?.text ?? openingLine);

  const roleButtonLabel = ROLE_BUTTON_LABEL[villager.role];
  const roleAction = villager.opens ? { kind: "open" as const, target: villager.opens } : undefined;

  return (
    <div className="town-dialogue-dock">
      <div className="town-dialogue-panel">
        <div className="town-dialogue-header">
          <div className="town-dialogue-plate" style={{ borderColor: villager.tint ?? "#e8a84c" }}>
            <span className="town-dialogue-speaker">{villager.name}</span>
            <span className="town-dialogue-role">{ROLE_DISPLAY[villager.role]}</span>
          </div>
          <button type="button" className="town-dialogue-close" onClick={onClose} title="Leave (Esc)">
            ✕
          </button>
        </div>

        <div className={`town-dialogue-current${thinking ? " is-thinking" : ""}`}>{currentLine}</div>

        <div ref={logRef} className="town-dialogue-log">
          {turns.map((t, i) => (
            <div key={i} className={t.who === "villager" ? "town-dialogue-line-villager" : "town-dialogue-line-you"}>
              {t.who === "you" ? "you — " : ""}
              {t.text}
            </div>
          ))}
        </div>

        {villager.role === "questgiver" && offeredQuests && offeredQuests.length > 0 && (
          <div className="town-dialogue-quests">
            {offeredQuests.map((q) => (
              <div key={q.id} className="town-dialogue-quest">
                <div className="town-dialogue-quest-title">{q.title}</div>
                <div className="town-dialogue-quest-desc">{q.description}</div>
                <button
                  type="button"
                  className="town-dialogue-quest-accept"
                  onClick={() => onAcceptQuest?.(q.id)}
                >
                  Accept →
                </button>
              </div>
            ))}
          </div>
        )}

        {roleAction && roleButtonLabel && (
          <button type="button" className="town-dialogue-open-btn" onClick={() => onAction(roleAction)}>
            {roleButtonLabel}
          </button>
        )}

        <form
          className="town-dialogue-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <input
            ref={inputRef}
            className="town-dialogue-input"
            value={draft}
            disabled={thinking}
            placeholder="Say something…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" className="town-dialogue-send" disabled={thinking}>
            Speak
          </button>
        </form>

        <div className="town-dialogue-foot">
          <span>Enter — speak</span>
          <span>Esc — leave</span>
        </div>
      </div>
    </div>
  );
}

const ROLE_DISPLAY: Record<VillagerRole, string> = {
  keeper: "Cradle-Keeper",
  shopkeeper: "Shopkeeper",
  loremaster: "Loremaster",
  quartermaster: "Quartermaster",
  questgiver: "Questgiver",
  storyteller: "Storyteller",
};
