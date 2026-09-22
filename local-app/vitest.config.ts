import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@excalidraw/excalidraw": fileURLToPath(
        new URL("../packages/excalidraw", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
  },
});
