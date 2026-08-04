import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * local-app Vite config.
 *
 * Mirrors excalidraw-app/vite.config.mts: resolves all @excalidraw/* imports
 * to the raw monorepo source under ../packages/, so we can consume the editor
 * without a pre-built dist/ (which isn't committed to the repo).
 *
 * Tauri specifics:
 *  - fixed dev port 1420 (Tauri convention)
 *  - strictPort so a clash fails loudly instead of silently moving port
 *  - HMR via the Tauri env vars when present
 *  - assetsInlineLimit 0 so fonts are emitted as files (not base64-inlined)
 */
export default defineConfig(async () => {
  // Tauri may inject host/port for HMR via env
  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [react()],
    resolve: {
      alias: [
        // Mirror of excalidraw-app/vite.config.mts alias block — point every
        // @excalidraw/* import at the monorepo source packages.
        {
          find: /^@excalidraw\/common$/,
          replacement: path.resolve(
            __dirname,
            "../packages/common/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/common\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/common/src/$1"),
        },
        {
          find: /^@excalidraw\/element$/,
          replacement: path.resolve(
            __dirname,
            "../packages/element/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/element\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/element/src/$1"),
        },
        {
          find: /^@excalidraw\/excalidraw$/,
          replacement: path.resolve(__dirname, "../packages/excalidraw/index.tsx"),
        },
        {
          find: /^@excalidraw\/excalidraw\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/excalidraw/$1"),
        },
        {
          find: /^@excalidraw\/math$/,
          replacement: path.resolve(__dirname, "../packages/math/src/index.ts"),
        },
        {
          find: /^@excalidraw\/math\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/math/src/$1"),
        },
        {
          find: /^@excalidraw\/utils$/,
          replacement: path.resolve(__dirname, "../packages/utils/src/index.ts"),
        },
        {
          find: /^@excalidraw\/utils\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/utils/src/$1"),
        },
        {
          find: /^@excalidraw\/fractional-indexing$/,
          replacement: path.resolve(
            __dirname,
            "../packages/fractional-indexing/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/laser-pointer$/,
          replacement: path.resolve(
            __dirname,
            "../packages/laser-pointer/src/index.ts",
          ),
        },
      ],
    },
    build: {
      outDir: "dist",
      assetsInlineLimit: 0, // don't base64-inline fonts/images
      rollupOptions: {
        output: {
          assetFileNames(chunkInfo) {
            // keep font files under fonts/<family>/ like the upstream host
            if (chunkInfo?.name?.endsWith(".woff2")) {
              const family = chunkInfo.name.split("-")[0];
              return `fonts/${family}/[name][extname]`;
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // don't watch the Rust backend
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
