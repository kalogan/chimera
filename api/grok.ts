/**
 * Vercel serverless function — the PROD equivalent of the Vite dev proxy
 * (`grokDevProxyPlugin` in vite.config.ts). Forwards the browser's chat-completion
 * request to xAI, attaching `XAI_API_KEY` server-side so the key never reaches the
 * client. Vercel auto-routes `POST /api/grok` to this file; it never runs under
 * `vite dev` (the Vite plugin handles that path in dev instead) and Vite does not
 * bundle anything under `api/` into the SPA build.
 *
 * Dependency-free by request: uses the platform's global `fetch`/`Request`/`Response`
 * (Node 18+ on Vercel, and the edge runtime) instead of the `@vercel/node` types, so
 * this file has zero package dependencies of its own.
 */

// Minimal structural types for the Node-style handler signature Vercel invokes this
// with, kept local so this file doesn't need @vercel/node as a dependency.
interface VercelRequestLike {
  method?: string;
  body?: unknown;
}
interface VercelResponseLike {
  status(code: number): VercelResponseLike;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  end(): void;
}

// Runs only on Vercel's Node runtime (never in the SPA/Vite build, which excludes
// `api/`). Declare the Node global it needs without pulling @types/node.
declare const process: { env: Record<string, string | undefined> };

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";

export default async function handler(req: VercelRequestLike, res: VercelResponseLike): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).setHeader("content-type", "application/json");
    res.send(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const key = process.env.XAI_API_KEY;
  if (!key) {
    res.status(503);
    res.setHeader("content-type", "application/json");
    res.send(JSON.stringify({ error: "no XAI_API_KEY" }));
    return;
  }

  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

    const upstream = await fetch(XAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
    res.send(text);
  } catch (err) {
    res.status(502);
    res.setHeader("content-type", "application/json");
    res.send(JSON.stringify({ error: "grok proxy failed", detail: String(err) }));
  }
}
