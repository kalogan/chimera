import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

// game-kit is vendored under vendor/game-kit (the kit master lives in Crucible and
// is re-vendored here via `node scripts/vendor-game-kit.mjs --to ../chimera` from the
// Crucible root). We import kit modules by SUBPATH (game-kit/creature, game-kit/battle,
// …). Vite resolves the kit's ".js" specifiers to ".ts".
const kit = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Per-module r3f entry (game-kit/<mod>/r3f → <mod>/r3f.tsx) — import a single
      // module's r3f helper WITHOUT pulling the whole r3f barrel (which would drag in
      // modules with optional peer deps this game doesn't have). Must precede the glob.
      { find: /^game-kit\/(.*)\/r3f$/, replacement: kit("./vendor/game-kit/src/$1/r3f.tsx") },
      { find: /^game-kit\/r3f$/, replacement: kit("./vendor/game-kit/src/r3f.ts") },
      { find: /^game-kit\/(.*)$/, replacement: kit("./vendor/game-kit/src/$1/index.ts") },
      { find: /^game-kit$/, replacement: kit("./vendor/game-kit/src/index.ts") },
    ],
  },
});
