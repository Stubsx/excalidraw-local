import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Shared SQLite access for data-class CLI commands (ls/get/mv/rm/import).
 *
 * Reads/writes the SAME library.db the GUI uses (single source of truth).
 * Because SQLite is opened in WAL mode by the app, the CLI can read & write
 * concurrently with the running GUI without corruption.
 *
 * Uses Node's built-in `node:sqlite` (Node ≥ 22) — no external dependency.
 */

const APP_IDENTIFIER = "com.excalidraw-local.app";

/** @returns {string} the AppConfig dir holding library.db */
export function appConfigDir() {
  if (process.env.EXCALIDRAW_DATA_DIR) return process.env.EXCALIDRAW_DATA_DIR;
  const home = homedir();
  const platform = process.platform;
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_IDENTIFIER);
  }
  if (platform === "win32") {
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      APP_IDENTIFIER,
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
    APP_IDENTIFIER,
  );
}

/** @returns {string} absolute path to library.db */
export function dbPath() {
  return join(appConfigDir(), "library.db");
}

/** @returns {boolean} whether the db file exists */
export function dbExists() {
  return existsSync(dbPath());
}

/**
 * Open the db. Callers MUST close it (db.close()).
 * @param {{readOnly?: boolean}} [opts]
 * @returns {DatabaseSync}
 */
export function openDb(opts = {}) {
  if (!dbExists()) {
    throw new Error(
      `library.db not found at ${dbPath()}. Run the app once first to initialize it.`,
    );
  }
  const db = new DatabaseSync(dbPath(), { readOnly: opts.readOnly ?? false });
  // WAL-safe for concurrent access with the GUI; enable foreign keys.
  if (!opts.readOnly) db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

/** Generate a v4 uuid (webview crypto.randomUUID isn't available in older node). */
export function uuid() {
  return randomUUID();
}
