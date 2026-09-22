import { invoke } from "@tauri-apps/api/core";

import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";

import { parseScene } from "./sceneValidation";

/**
 * Folder-access layer: browse & edit `.excalidraw` files directly on disk
 * (in place — NOT copied into the SQLite library).
 *
 * Powered by @tauri-apps/plugin-fs. Capabilities grant "**" scope so the user
 * can open any folder via the directory picker.
 */

export interface FolderEntry {
  /** Absolute path of the file. */
  path: string;
  /** File name without extension. */
  name: string;
  isDirectory: boolean;
}

export interface FileSceneData {
  type: string;
  version: number;
  source?: string;
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * List `.excalidraw` files in a directory (non-recursive). Returns them sorted
 * by name. Ignores directories and non-.excalidraw files.
 */
export async function listExcalidrawFiles(dir: string): Promise<FolderEntry[]> {
  const entries = await readDir(dir);
  const files = entries
    .filter((e) => !e.isDirectory && e.name.endsWith(".excalidraw"))
    .map((e) => {
      // e.name is the base file name; full path = dir + "/" + name.
      const fullPath = dir.endsWith("/") ? dir + e.name : `${dir}/${e.name}`;
      return {
        path: fullPath,
        name: e.name.replace(/\.excalidraw$/, ""),
        isDirectory: false,
      };
    });
  files.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return files;
}

/**
 * Read and parse a `.excalidraw` file from disk. Accepts both the full envelope
 * and a bare elements array (legacy localStorage form).
 */
export async function readFileScene(path: string): Promise<FileSceneData> {
  const text = await readTextFile(path);
  return parseScene(text);
}

/**
 * Write a scene back to disk as a `.excalidraw` file (in place).
 * Uses cleanAppStateForExport-equivalent cleaning done by the caller.
 */
export async function writeFileScene(
  path: string,
  data: FileSceneData,
): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  await invoke("save_scene_file", { path, text });
}

/** Check whether a path exists (used to validate a previously-opened folder). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}
