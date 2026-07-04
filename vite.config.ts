import { defineConfig, loadEnv, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

// game-kit is vendored under vendor/game-kit (the kit master lives in Crucible and
// is re-vendored here via `node scripts/vendor-game-kit.mjs --to ../chimera` from the
// Crucible root). We import kit modules by SUBPATH (game-kit/creature, game-kit/battle,
// …). Vite resolves the kit's ".js" specifiers to ".ts".
const kit = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Read a KEY=value out of a dotenv-style file without a dotenv dependency. Best-effort:
// missing file / missing key both just yield undefined (the caller degrades to mock).
function readEnvFile(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const m = readFileSync(path, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

// Dev-only Grok proxy: POST /api/grok forwards to xAI with the server-side key, so
// XAI_API_KEY never reaches the browser (no leak, no CORS). Mirrors api/grok.ts (the
// Vercel prod equivalent) — this plugin only runs under `vite`/`vite dev`, never in
// the built SPA bundle. No key found → 503 so the client degrades to the mock brain.
function grokDevProxyPlugin(mode: string): Plugin {
  return {
    name: "chimera-grok-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/grok", (req, res, next) => {
        if (req.method !== "POST") return next();
        void (async () => {
          try {
            // 1) chimera's own .env.local (via Vite's loadEnv — reads process.env too),
            // 2) fall back to the sibling crucible-asset-studio/.env.local convention
            //    (the same key Cascade's gen-tiles.mjs reads REPLICATE_API_TOKEN from).
            const chimeraEnv = loadEnv(mode, process.cwd(), "");
            const key =
              chimeraEnv.XAI_API_KEY ||
              readEnvFile(kit("./.env.local"), "XAI_API_KEY") ||
              readEnvFile(kit("../crucible-asset-studio/.env.local"), "XAI_API_KEY");

            if (!key) {
              res.statusCode = 503;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "no XAI_API_KEY" }));
              return;
            }

            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks).toString("utf8");

            const upstream = await fetch("https://api.x.ai/v1/chat/completions", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${key}`,
              },
              body,
            });

            res.statusCode = upstream.status;
            res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
            res.end(await upstream.text());
          } catch (err) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "grok proxy failed", detail: String(err) }));
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), grokDevProxyPlugin(mode)],
  resolve: {
    alias: [
      // Per-module r3f entry (game-kit/<mod>/r3f → <mod>/r3f.tsx) — import a single
      // module's r3f helper WITHOUT pulling the whole r3f barrel (which would drag in
      // modules with optional peer deps this game doesn't have). Must precede the glob.
      { find: /^game-kit\/(.*)\/r3f$/, replacement: kit("./vendor/game-kit/src/$1/r3f.tsx") },
      // rival/brain is a sibling file (not dir/index) — the swappable-brain API.
      { find: /^game-kit\/rival\/brain$/, replacement: kit("./vendor/game-kit/src/rival/brain.ts") },
      { find: /^game-kit\/r3f$/, replacement: kit("./vendor/game-kit/src/r3f.ts") },
      { find: /^game-kit\/(.*)$/, replacement: kit("./vendor/game-kit/src/$1/index.ts") },
      { find: /^game-kit$/, replacement: kit("./vendor/game-kit/src/index.ts") },
    ],
  },
}));
