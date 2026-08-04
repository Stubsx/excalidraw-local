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

/** Raw row shape as returned by the SQL plugin (snake_case columns). */
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
