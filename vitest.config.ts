import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirror the app's kit alias so tests can import game-kit subpaths. Only the
// app's own tests (src/**) run here; the kit's own tests are the authoritative
// suite in Crucible.
const kit = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^game-kit\/(.*)$/, replacement: kit("./vendor/game-kit/src/$1/index.ts") },
      { find: /^game-kit$/, replacement: kit("./vendor/game-kit/src/index.ts") },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
