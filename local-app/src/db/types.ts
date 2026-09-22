import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * A saved scene as stored in SQLite (one row of the `scenes` table).
 *
 * `elements`/`appState`/`files` are the cleaned-for-export JSON subsets that
 * `serializeAsJSON(..., "local")` produces upstream, so files written here are
 * binary-compatible with excalidraw.com.
 */
export interface SavedScene {
  id: string;
  name: string;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  thumbnail?: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * One entry in the folder history — a directory the user has opened as a
 * "project". Persisted in the `app_state` KV table under key `folder_history`,
 * so it survives restarts. `lastOpened` (epoch ms) drives recency ordering.
 */
export interface FolderHistoryEntry {
  /** Absolute path to the directory. */
  path: string;
  /** Display name (last path segment), denormalized for convenience. */
  name: string;
  /** Epoch ms of the last time this folder was opened. */
  lastOpened: number;
}
