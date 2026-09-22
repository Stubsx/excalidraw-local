import { exportToBlob } from "@excalidraw/utils/export";
import { getNonDeletedElements } from "@excalidraw/element";

import { getScene, setThumbnail } from "./db/sceneStore";

import type { SavedScene } from "./db/types";

export async function renderThumbnail(
  scene: Pick<SavedScene, "elements" | "appState" | "files">,
): Promise<string> {
  const elements = getNonDeletedElements(scene.elements);
  // Empty string is a cached blank canvas; undefined means not generated yet.
  if (!elements.length) {
    return "";
  }
  const blob = await exportToBlob({
    elements,
    appState: { ...scene.appState, exportBackground: true, exportScale: 1 },
    files: scene.files,
    maxWidthOrHeight: 240,
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Render one preview at a time, sharing work when a row remounts or StrictMode
// repeats an effect. Large imports must not render every canvas concurrently.
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<string | null>>();

export function ensureThumbnail(
  id: string,
  revision: number,
): Promise<string | null> {
  const key = `${id}:${revision}`;
  const existing = pending.get(key);
  if (existing) {
    return existing;
  }
  const task = queue.then(async () => {
    const scene = await getScene(id);
    if (!scene || scene.updatedAt !== revision) {
      return null;
    }
    if (scene.thumbnail !== undefined) {
      return scene.thumbnail;
    }
    const preview = await renderThumbnail(scene);
    return (await setThumbnail(id, preview, scene)) ? preview : null;
  });
  pending.set(key, task);
  queue = task.then(
    () => pending.delete(key),
    () => pending.delete(key),
  );
  return task;
}
