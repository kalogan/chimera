/**
 * Browser-side LIVE Grok provider for the `?rivals` inspector.
 *
 * A browser can't hold `XAI_API_KEY` (leak risk + xAI has no CORS allowance for
 * browser origins), so this provider never talks to api.x.ai directly. It POSTs to
 * the RELATIVE path `/api/grok` — in dev that's the Vite plugin in `vite.config.ts`
 * (`grokDevProxyPlugin`), in prod (once CHIMERA deploys) that's the Vercel serverless
 * function `api/grok.ts`. Same relative path works in both, no branching needed here.
 *
 * On ANY failure (no key → 503, network error, bad JSON) this THROWS. That's
 * intentional: `createGrokRivalBrain`'s budget wrapper treats a thrown `complete()`
 * as the signal to degrade to the deterministic utility brain
 * (`source: 'utility-fallback'`) — the inspector shows that honestly rather than
 * silently going quiet.
 */
import type { ReasoningProvider } from "game-kit/npc";

const GROK_PROXY_PATH = "/api/grok";
const GROK_MODEL = "grok-3";

interface ChatCompletionShape {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * `ReasoningProvider` that reasons over the proxy. `respond()` is unused by the
 * inspector (only `complete()` drives rival decisions) but is implemented to satisfy
 * the interface — it degrades to no intents rather than reaching the network for a
 * feature this inspector doesn't exercise.
 */
export function createProxyGrokProvider(): ReasoningProvider {
  return {
    name: "grok-live",

    async respond() {
      return { intents: [] };
    },

    async complete(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
      const res = await fetch(GROK_PROXY_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: GROK_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
        signal: signal ?? null,
      });

      if (!res.ok) {
        throw new Error(`grok proxy: HTTP ${res.status}`);
      }

      const json = (await res.json()) as ChatCompletionShape;
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("grok proxy: empty completion");
      }
      return content;
    },
  };
}
