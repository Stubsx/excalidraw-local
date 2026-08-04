import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { exportToBlob } from "@excalidraw/utils/export";
import { getNonDeletedElements } from "@excalidraw/element";

import type {
  AppState,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getScene } from "../db/sceneStore";

/**
 * Shape of the render-request event emitted from Rust (mirrors the CLI body).
 * Keep in sync with RenderRequest in src-tauri/src/ipc.rs.
 */
interface RenderRequest {
  requestId: string;
  sceneId?: string;
  /** Inlined .excalidraw scene JSON (preferred for arbitrary files). */
  data?: string;
  format?: string;
  scale?: number;
}

interface ParsedScene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

/**
 * Parse an inlined .excalidraw JSON string into a renderable scene.
 * Accepts both the full envelope ({type, version, elements, appState, files})
 * and a bare elements array.
 */
function parseSceneData(raw: string): ParsedScene {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    // Bare elements array (legacy localStorage form).
    return { elements: parsed, appState: {}, files: {} };
  }
  return {
    elements: parsed.elements ?? [],
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  };
}

/**
 * Install the render-request listener. The Rust IPC server emits this event
 * when the `excal` CLI POSTs to /render. We render the requested scene to a
 * PNG blob and hand the bytes back via the `render_done` command, which
 * resolves the waiting HTTP response.
 *
 * Call once at app startup.
 */
export async function installRenderListener(): Promise<() => void> {
  const unlisten = await listen<RenderRequest>(
    "render-request",
    async (event) => {
      const req = event.payload;
      const started = performance.now();

      // Forward an error message to the Rust console (Tauri dev doesn't show
      // webview console.* in the terminal by default). Used only on failure.
      const logErr = (m: string) => {
        console.error("[render]", m);
        invoke("render_log", { msg: m }).catch(() => {});
      };

      try {
        // Resolve the scene to render.
        let scene: ParsedScene;
        if (req.sceneId) {
          const saved = await getScene(req.sceneId);
          if (!saved) {
            throw new Error(`scene not found: ${req.sceneId}`);
          }
          scene = {
            elements: saved.elements,
            appState: saved.appState,
            files: saved.files,
          };
        } else if (req.data) {
          scene = parseSceneData(req.data);
        } else {
          throw new Error("render requires sceneId or data");
        }

        // exportBackground must be true to actually paint the white background.
        const appState: Partial<AppState> = {
          exportBackground: true,
          exportScale: req.scale ?? 1,
          ...scene.appState,
        };

        const elements = getNonDeletedElements(
          scene.elements as readonly ExcalidrawElement[],
        );
        const blob = await exportToBlob({
          elements,
          appState,
          files: scene.files,
        });

        const bytes = new Uint8Array(await blob.arrayBuffer());

        // Measure output dimensions via an Image element (cheap, avoids
        // parsing PNG headers manually).
        const url = URL.createObjectURL(blob);
        const { width, height } = await new Promise<{ width: number; height: number }>(
          (resolve) => {
            const img = new Image();
            img.onload = () => {
              resolve({ width: img.naturalWidth, height: img.naturalHeight });
              URL.revokeObjectURL(url);
            };
            img.onerror = () => {
              resolve({ width: 0, height: 0 });
              URL.revokeObjectURL(url);
            };
            img.src = url;
          },
        );

        await invoke("render_done", {
          requestId: req.requestId,
          png: bytes,
          meta: {
            width,
            height,
            mimeType: blob.type,
          },
        });

        const elapsed = Math.round(performance.now() - started);
        console.info(
          `[render] ${req.requestId} -> ${width}x${height} in ${elapsed}ms`,
        );
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        logErr(`FAILED: ${msg}`);
        // We still must resolve the pending request on the Rust side, otherwise
        // the HTTP handler hangs until its 60s timeout. Hand back an empty
        // payload with a sentinel so the CLI sees a clear failure.
        try {
          await invoke("render_done", {
            requestId: req.requestId,
            png: new Uint8Array(0),
            meta: { width: 0, height: 0, mimeType: "application/octet-stream" },
          });
        } catch {
          // best effort
        }
      }
    },
  );

  return unlisten;
}
