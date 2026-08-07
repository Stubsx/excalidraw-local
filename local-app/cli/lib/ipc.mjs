import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Locate the running app's IPC port by reading <AppConfig>/ipc.port.
 *
 * The app identifier is hard-coded to match tauri.conf.json. AppConfig dir:
 *   macOS:   ~/Library/Application Support/<id>/
 *   Linux:   ~/.config/<id>/
 *   Windows: %APPDATA%\<id>\
 */
const APP_IDENTIFIER = "com.excalidraw-local.app";

function appConfigDir() {
  const home = homedir();
  const platform = process.platform;
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_IDENTIFIER);
  }
  if (platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), APP_IDENTIFIER);
  }
  // linux & fallback
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), APP_IDENTIFIER);
}

/** @returns {number|null} the IPC port, or null if the app isn't running. */
export function getPort() {
  const portFile = join(appConfigDir(), "ipc.port");
  if (!existsSync(portFile)) return null;
  const raw = readFileSync(portFile, "utf8").trim();
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : null;
}

/** @returns {string} the AppConfig dir (for diagnostics). */
export function configDir() {
  return appConfigDir();
}

/**
 * Quick liveness check against the running app.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function ping(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ping`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST a render request and return the parsed response.
 *
 * @param {number} port
 * @param {{requestId:string, sceneId?:string, data?:string, format?:string, scale?:number}} body
 * @returns {Promise<any>} the RenderResponse JSON
 */
export async function requestRender(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Generate a request id for correlating CLI <-> app. */
export function requestId() {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Best-effort notification that the library changed (after a CLI write command
 * like import/mv/rm/put). If the app is running, POSTs /notify so the webview
 * refreshes its sidebar; if the app isn't running, this is a no-op (the next
 * app launch reads the fresh data from SQLite directly).
 *
 * Never throws — notifications are advisory, not part of the write's success.
 * @param {string} [kind="library-changed"]
 */
export async function notifyLibraryChanged(kind = "library-changed") {
  const port = getPort();
  if (!port) return; // app not running — nothing to notify
  try {
    await fetch(`http://127.0.0.1:${port}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: kind }),
    });
  } catch {
    // App may have just quit, or still starting up. Silently ignore — the
    // write itself already succeeded (it went to SQLite directly).
  }
}
