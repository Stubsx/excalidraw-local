import Database from "@tauri-apps/plugin-sql";

import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { SavedScene, FolderHistoryEntry } from "./types";

/**
 * SQLite-backed scene store.
 *
 * Wraps @tauri-apps/plugin-sql. The db file (library.db) is opened via the
 * Rust-side plugin registration (see src-tauri/src/lib.rs), which also runs
 * the schema migration on first launch.
 *
 * JSON columns (elements_json / app_state_json / files_json) hold the same
 * payloads `serializeAsJSON(..., "local")` produces, keeping files on disk
 * binary-compatible with excalidraw.com.
 */

let dbPromise: Promise<Database> | null = null;

function db(): Promise<Database> {
  if (!dbPromise) {
    // "sqlite:library.db" resolves under the app's AppConfig dir; the matching
    // Rust migration created the tables already.
    dbPromise = Database.load("sqlite:library.db");
  }
  return dbPromise;
}

interface SceneRow {
  id: string;
  name: string;
  elements_json: string;
  app_state_json: string;
  files_json: string;
  thumbnail: string | null;
  starred: number;
  created_at: number;
  updated_at: number;
}

function rowToScene(row: SceneRow): SavedScene {
  return {
    id: row.id,
    name: row.name,
    elements: JSON.parse(row.elements_json || "[]"),
    appState: JSON.parse(row.app_state_json || "{}"),
    files: JSON.parse(row.files_json || "{}"),
    thumbnail: row.thumbnail ?? undefined,
    starred: row.starred === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Generate a v4-ish uuid without pulling in a dependency. */
export function uuid(): string {
  // crypto.randomUUID is available in the Tauri webview (modern Chromium).
  return crypto.randomUUID();
}

/** Return the most recently updated, non-deleted scene, or null if none. */
export async function getLatestScene(): Promise<SavedScene | null> {
  const conn = await db();
  const rows = await conn.select<SceneRow[]>(
    `SELECT * FROM scenes
     WHERE is_deleted = 0
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  return rows.length > 0 ? rowToScene(rows[0]) : null;
}

/** Return the active scene id remembered from the last session (if any). */
export async function getActiveSceneId(): Promise<string | null> {
  const conn = await db();
  const rows = await conn.select<{ value: string }[]>(
    `SELECT value FROM app_state WHERE key = 'active_scene_id'`,
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setActiveSceneId(id: string): Promise<void> {
  const conn = await db();
  await conn.execute(
    `INSERT INTO app_state (key, value) VALUES ('active_scene_id', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [id],
  );
}

export async function getScene(id: string): Promise<SavedScene | null> {
  const conn = await db();
  const rows = await conn.select<SceneRow[]>(
    `SELECT * FROM scenes WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? rowToScene(rows[0]) : null;
}

/** Insert or update a scene row (upsert by id). */
export async function upsertScene(
  scene: SavedScene,
): Promise<void> {
  const conn = await db();
  await conn.execute(
    `INSERT INTO scenes
       (id, name, elements_json, app_state_json, files_json, thumbnail, starred, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(id) DO UPDATE SET
       name           = excluded.name,
       elements_json  = excluded.elements_json,
       app_state_json = excluded.app_state_json,
       files_json     = excluded.files_json,
       thumbnail      = excluded.thumbnail,
       starred        = excluded.starred,
       updated_at     = excluded.updated_at`,
    [
      scene.id,
      scene.name,
      JSON.stringify(scene.elements),
      JSON.stringify(scene.appState),
      JSON.stringify(scene.files),
      scene.thumbnail ?? null,
      scene.starred ? 1 : 0,
      scene.createdAt,
      scene.updatedAt,
    ],
  );
}

/**
 * Upsert a scene keyed by NAME (used by the CLI render flow).
 *
 * If a non-deleted scene with the same name exists, reuse its id and preserve
 * createdAt / starred, overwriting elements/appState/files/thumbnail and
 * bumping updatedAt. Otherwise insert a fresh row. This is how `excal render`
 * auto-saves into the library without creating duplicates on repeated renders
 * of the same file.
 *
 * Returns the scene id that was written.
 */
export async function saveSceneByName(
  name: string,
  scene: {
    elements: readonly ExcalidrawElement[];
    appState: Partial<AppState>;
    files: BinaryFiles;
  },
  thumbnail?: string,
): Promise<string> {
  const conn = await db();
  const now = Date.now();

  // Look for an existing live row with the same name.
  const rows = await conn.select<{ id: string }[]>(
    `SELECT id FROM scenes WHERE name = $1 AND is_deleted = 0 LIMIT 1`,
    [name],
  );

  if (rows.length > 0) {
    // Reuse: keep id/created_at/starred, overwrite content + thumbnail.
    const id = rows[0].id;
    await conn.execute(
      `UPDATE scenes SET
         elements_json = $1,
         app_state_json = $2,
         files_json = $3,
         thumbnail = COALESCE($4, thumbnail),
         updated_at = $5
       WHERE id = $6`,
      [
        JSON.stringify(scene.elements),
        JSON.stringify(scene.appState),
        JSON.stringify(scene.files),
        thumbnail ?? null,
        now,
        id,
      ],
    );
    return id;
  }

  // Insert a new row.
  const id = uuid();
  await conn.execute(
    `INSERT INTO scenes
       (id, name, elements_json, app_state_json, files_json, thumbnail, starred, is_deleted, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $8)`,
    [
      id,
      name,
      JSON.stringify(scene.elements),
      JSON.stringify(scene.appState),
      JSON.stringify(scene.files),
      thumbnail ?? null,
      now,
      now,
    ],
  );
  return id;
}

/**
 * Convenience: persist the current editor state into a scene row.
 * Used by the debounced autosave in onChange. Also refreshes the thumbnail.
 *
 * `name` is OPTIONAL: when omitted, the existing DB name is preserved. The
 * GUI editor never renames a scene (renames go through the CLI `mv` command
 * or sidebar affordances), so autosave must NOT clobber the name — previously
 * a hardcoded "未命名" was passed here, which silently renamed every scene the
 * user touched back to "未命名" on the next change.
 */
export async function saveEditorState(
  id: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  name?: string,
): Promise<void> {
  const now = Date.now();
  const existing = await getScene(id);
  await upsertScene({
    id,
    // Preserve the existing name unless the caller explicitly passes one.
    name: name ?? existing?.name ?? "未命名",
    elements,
    appState,
    files,
    thumbnail: existing?.thumbnail,
    starred: existing?.starred ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/** Lightweight list row (no element JSON — for sidebar listing). */
export interface SceneListItem {
  id: string;
  name: string;
  thumbnail?: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * List scenes for the sidebar. Optionally filter by name substring and/or
 * starred-only. Returns light rows (no elements/files JSON) for speed.
 */
export async function queryScenes(filter?: {
  search?: string;
  starredOnly?: boolean;
}): Promise<SceneListItem[]> {
  const conn = await db();
  const where = ["is_deleted = 0"];
  const params: (string | number)[] = [];
  if (filter?.starredOnly) where.push("starred = 1");
  if (filter?.search) {
    where.push("(name LIKE ? OR elements_json LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like);
  }
  const rows = await conn.select<
    {
      id: string;
      name: string;
      thumbnail: string | null;
      starred: number;
      created_at: number;
      updated_at: number;
    }[]
  >(
    `SELECT id, name, thumbnail, starred, created_at, updated_at
     FROM scenes
     WHERE ${where.join(" AND ")}
     ORDER BY starred DESC, updated_at DESC`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    thumbnail: r.thumbnail ?? undefined,
    starred: r.starred === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Persist a thumbnail (dataURL) for a scene. */
export async function setThumbnail(id: string, thumbnail: string): Promise<void> {
  const conn = await db();
  await conn.execute("UPDATE scenes SET thumbnail = $1 WHERE id = $2", [
    thumbnail,
    id,
  ]);
}

/** Rename a scene. */
export async function renameScene(id: string, name: string): Promise<void> {
  const conn = await db();
  await conn.execute(
    "UPDATE scenes SET name = $1, updated_at = $2 WHERE id = $3",
    [name, Date.now(), id],
  );
}

/** Soft-delete a scene. */
export async function deleteScene(id: string): Promise<void> {
  const conn = await db();
  await conn.execute(
    "UPDATE scenes SET is_deleted = 1, deleted_at = $1 WHERE id = $2",
    [Date.now(), id],
  );
}

/** Toggle starred. */
export async function toggleStarred(id: string): Promise<void> {
  const conn = await db();
  await conn.execute(
    "UPDATE scenes SET starred = 1 - starred WHERE id = $1",
    [id],
  );
}

// --- Session persistence (which tabs are open) -----------------------------

const SESSION_KEY = "open_tabs";

/** Read the list of open tab ids + active tab from the last session. */
export async function getOpenTabs(): Promise<{
  ids: string[];
  activeId: string | null;
}> {
  const conn = await db();
  const rows = await conn.select<{ value: string }[]>(
    `SELECT value FROM app_state WHERE key = $1`,
    [SESSION_KEY],
  );
  if (rows.length === 0) return { ids: [], activeId: null };
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return { ids: [], activeId: null };
  }
}

/** Persist the open-tab list + active tab for next launch. */
export async function setOpenTabs(ids: string[], activeId: string | null): Promise<void> {
  const conn = await db();
  await conn.execute(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SESSION_KEY, JSON.stringify({ ids, activeId })],
  );
}

// --- Folder history (opened-as-project folders) ----------------------------

const FOLDER_HISTORY_KEY = "folder_history";
/** Cap so the list can't grow unbounded. */
const FOLDER_HISTORY_MAX = 20;

/** Read the persisted folder history (newest first). Empty if none saved. */
export async function getFolderHistory(): Promise<FolderHistoryEntry[]> {
  const conn = await db();
  const rows = await conn.select<{ value: string }[]>(
    `SELECT value FROM app_state WHERE key = $1`,
    [FOLDER_HISTORY_KEY],
  );
  if (rows.length === 0) return [];
  try {
    const parsed = JSON.parse(rows[0].value) as FolderHistoryEntry[];
    // Defensive: tolerate slightly malformed entries.
    return Array.isArray(parsed)
      ? parsed
          .filter((e) => e && typeof e.path === "string")
          .sort((a, b) => b.lastOpened - a.lastOpened)
      : [];
  } catch {
    return [];
  }
}

/** Persist the full folder history list (newest first). */
export async function setFolderHistory(
  folders: FolderHistoryEntry[],
): Promise<void> {
  const conn = await db();
  await conn.execute(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [
      FOLDER_HISTORY_KEY,
      JSON.stringify(
        folders
          .sort((a, b) => b.lastOpened - a.lastOpened)
          .slice(0, FOLDER_HISTORY_MAX),
      ),
    ],
  );
}

/**
 * Add (or re-promote) a folder in history. Dedupes by path, sets `lastOpened`
 * to now, caps the list at FOLDER_HISTORY_MAX. Returns the updated list so the
 * caller can update component state without a re-read.
 */
export async function addFolderToHistory(
  path: string,
  name: string,
): Promise<FolderHistoryEntry[]> {
  const existing = await getFolderHistory();
  const now = Date.now();
  const next: FolderHistoryEntry[] = [
    { path, name, lastOpened: now },
    ...existing.filter((e) => e.path !== path),
  ].slice(0, FOLDER_HISTORY_MAX);
  await setFolderHistory(next);
  return next;
}

/** Remove a folder from history (does NOT touch the directory on disk). */
export async function removeFolderFromHistory(
  path: string,
): Promise<FolderHistoryEntry[]> {
  const existing = await getFolderHistory();
  const next = existing.filter((e) => e.path !== path);
  await setFolderHistory(next);
  return next;
}
