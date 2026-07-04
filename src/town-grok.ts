/**
 * town-grok — the browser-side LIVE conversation provider for TOWN villagers.
 *
 * Mirrors `rival-grok.ts`'s proxy pattern exactly: a browser can't hold
 * `XAI_API_KEY` (leak risk + no CORS allowance from xAI for browser origins),
 * so this provider never talks to api.x.ai directly. It POSTs to the RELATIVE
 * path `/api/grok` — in dev that's the Vite plugin (`grokDevProxyPlugin` in
 * vite.config.ts), in prod that's the Vercel serverless function
 * (`api/grok.ts`). Same relative path works in both, no branching needed here.
 *
 * `respond()` — used for real villager conversation — builds the same
 * OpenAI-compatible chat-completions body the kit's own
 * `createOpenAiCompatibleProvider` sends (system guardrails + a user prompt
 * built from the ReasoningRequest), then runs the reply through the SAME
 * zod-free trusted-string path the mocks use (`buildSayIntents`) rather than
 * the schema firewall — this file is a CLIENT module and must stay zod-free
 * (see `vendor/game-kit/src/npc/runtime.ts`'s split). The model's raw text is
 * still length-capped by `buildSayIntents`, so an oversized reply can't blow
 * past the same bound the real firewall would enforce; it just isn't
 * schema-validated against the full intent vocabulary (a live villager only
 * ever speaks — it doesn't emit setMood/endConversation/recall intents here).
 *
 * `complete()` is kept too (same shape as `rival-grok.ts`) for callers that
 * want the low-level text-completion seam directly.
 *
 * ON ANY FAILURE (no key → 503, network error, bad JSON) both methods THROW.
 * That's intentional: `createNpcBrain`'s budget wrapper treats a thrown
 * `respond()`/`complete()` as the signal to degrade to the NPC's authored
 * `fallbackLines` — the town then falls back to warm scripted lines rather
 * than going silent.
 *
 * DEFAULT IS MOCK: `town-dialogue.tsx` wires villagers to the kit's
 * deterministic mock/selector provider by default. This live provider is
 * opt-in — a caller passes it in explicitly (e.g. behind a "go live" toggle)
 * when `XAI_API_KEY` is known to be set server-side.
 */
import type { ReasoningRequest, ReasoningResponse } from "game-kit/npc";
import { buildSayIntents } from "../vendor/game-kit/src/npc/trustedIntent.js";

const GROK_PROXY_PATH = "/api/grok";
const GROK_MODEL = "grok-3";

interface ChatCompletionShape {
  choices?: Array<{ message?: { content?: string } }>;
}

/** The minimal provider shape `town-dialogue.tsx`/the kit's brain expect
 *  (mirrors `game-kit/npc`'s `ReasoningProvider`, restated here so this file
 *  doesn't need the zod-carrying value import — only the request/response
 *  TYPES, which are erased at build). */
export interface TownReasoningProvider {
  readonly name: string;
  respond(req: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResponse>;
  complete(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string>;
}

/** Build the same guardrails + user-framing shape the kit's real provider
 *  sends, without importing `./prompt.js` (that entry sits behind the
 *  zod-carrying `game-kit/npc` barrel's build graph in some setups — this
 *  keeps town-grok self-contained and trivially zod-free). */
function systemGuardrails(): string {
  return (
    "You are the reasoning brain for one NPC in a cozy monster-taming game. " +
    "Reply with ONLY a JSON object of the shape {\"intents\":[{\"kind\":\"say\",\"text\":\"...\"}]} " +
    "— a single short in-character line (under 600 characters), warm and true to the persona. " +
    "No narration, no markdown fences, no extra fields, no other intent kinds."
  );
}

function userPrompt(req: ReasoningRequest): string {
  const lines: string[] = [];
  lines.push(`You are ${req.npcName}.`);
  lines.push(`Role: ${req.persona.role}`);
  lines.push(`Knowledge: ${req.persona.knowledgeScope}`);
  if (req.persona.goals.length > 0) lines.push(`Goals: ${req.persona.goals.join("; ")}`);
  lines.push(`Voice: ${req.persona.voice}`);
  if (req.memorySummary) lines.push(`What you remember of this traveler: ${req.memorySummary}`);
  if (req.history.length > 0) {
    lines.push("Recent conversation:");
    for (const turn of req.history) {
      lines.push(`${turn.role === "player" ? "Traveler" : req.npcName}: ${turn.text}`);
    }
  }
  lines.push(`Traveler: ${req.playerMessage}`);
  lines.push(`${req.npcName}:`);
  return lines.join("\n");
}

/**
 * Create a `TownReasoningProvider` that reasons over the `/api/grok` proxy.
 * Drop-in for `createNpcBrain`'s `provider` — the brain auto-wraps it in the
 * budget/timeout/scripted-fallback firewall exactly like a mock.
 */
export function createProxyConversationProvider(): TownReasoningProvider {
  return {
    name: "town-grok-live",

    async respond(req: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResponse> {
      const text = await complete(systemGuardrails(), userPrompt(req), signal);
      // Zod-free trusted build: the model's own words, length-capped the same
      // way the real firewall would cap a `say` intent's text.
      return { intents: buildSayIntents(extractSayText(text)) };
    },

    async complete(systemPrompt: string, userPromptText: string, signal?: AbortSignal): Promise<string> {
      return complete(systemPrompt, userPromptText, signal);
    },
  };
}

/** Best-effort pull of the spoken line out of the model's JSON reply. Falls
 *  back to the raw text (trimmed) if it isn't the expected envelope — still
 *  length-capped by `buildSayIntents` downstream, never trusted structurally. */
function extractSayText(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(stripFence(trimmed)) as {
      intents?: Array<{ kind?: string; text?: string }>;
    };
    const say = parsed.intents?.find((i) => i?.kind === "say" && typeof i.text === "string");
    if (say?.text) return say.text;
  } catch {
    // not JSON — fall through to the raw text.
  }
  return trimmed;
}

function stripFence(text: string): string {
  if (!text.startsWith("```")) return text;
  return text.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "");
}

async function complete(systemPrompt: string, userPromptText: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(GROK_PROXY_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptText },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    }),
    signal: signal ?? null,
  });

  if (!res.ok) {
    throw new Error(`town-grok proxy: HTTP ${res.status}`);
  }

  const json = (await res.json()) as ChatCompletionShape;
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("town-grok proxy: empty completion");
  }
  return content;
}
