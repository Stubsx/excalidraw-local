import { memo, useEffect, useRef, useState, useCallback } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";
import { exportToBlob } from "@excalidraw/utils/export";
import { getNonDeletedElements } from "@excalidraw/element";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, Theme } from "@excalidraw/element/types";

import {
  saveEditorState,
  setThumbnail,
} from "../db/sceneStore";
import { writeFileScene, type FileSceneData } from "../folderStore";
import type { SavedScene } from "../db/types";
import type { TabKind } from "../tabs";

const AUTOSAVE_MS = 500;

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

interface EditorPaneProps {
  /** What this editor is bound to: a library scene or a disk file. */
  kind: TabKind;
  /** library: scene id; file: absolute path. */
  refId: string;
  scene: SavedScene | null;
  onApiReady: (api: ExcalidrawImperativeAPI | null) => void;
  onChange: () => void;
  /** Editor theme changes are forwarded up so the chrome can follow. */
  onThemeChange: (theme: Theme | "system") => void;
}

/**
 * One Excalidraw editor instance bound to a single scene.
 *
 * - Loads the scene as initialData (Promise so the editor waits for the db).
 * - On every change, debounces a save to SQLite + regenerates a thumbnail.
 * - Calls onChange so the parent can mark the tab dirty and refresh the sidebar.
 *
 * Only the active tab's EditorPane is mounted by the parent; switching tabs
 * unmounts it (data is already persisted, so reloading is lossless).
 */
// memoized: parent re-renders (dirty marking, sidebar refresh) must NOT
// re-render the Excalidraw subtree — each such re-render churns the
// tunnel-rat stores and feeds back into onChange (see tabs.ts markDirty).
export const EditorPane = memo(function EditorPane({ kind, refId, scene, onApiReady, onChange, onThemeChange }: EditorPaneProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [initialData, setInitialData] = useState<
    Promise<ExcalidrawInitialDataState> | null
  >(null);

  // Load the scene into initialData when the binding changes.
  useEffect(() => {
    const data = scene
      ? {
          elements: scene.elements,
          appState: scene.appState,
          files: scene.files,
        }
      : { elements: [], appState: {}, files: {} };
    setInitialData(Promise.resolve(data));
  }, [kind, refId, scene]);

  // Debounced save. For library tabs → SQLite + thumbnail; for file tabs → disk.
  const debouncedSave = useRef(
    debounce(() => {
      const api = apiRef.current;
      if (!api) return;
      const allElements = api.getSceneElements() as readonly ExcalidrawElement[];
      const elements = getNonDeletedElements(allElements);
      const appState = cleanAppStateForExport(api.getAppState());
      const files = api.getFiles();

      if (kind === "library") {
        // Persist to SQLite + regenerate thumbnail.
        saveEditorState(refId, "未命名", allElements, appState, files).catch((e) =>
          console.error("[excal-local] autosave failed", e),
        );
        if (elements.length > 0) {
          exportToBlob({
            elements,
            appState: { ...appState, exportBackground: true },
            files,
            maxWidthOrHeight: 200,
          })
            .then((blob) => blobToDataURL(blob))
            .then((dataUrl) => setThumbnail(refId, dataUrl))
            .catch(() => {});
        }
      } else {
        // File tab: write the scene back to disk in place.
        const data: FileSceneData = {
          type: "excalidraw",
          version: 2,
          source: "excalidraw-local",
          elements: allElements,
          appState,
          files,
        };
        writeFileScene(refId, data).catch((e) =>
          console.error("[excal-local] file save failed", e),
        );
      }
    }, AUTOSAVE_MS),
  ).current;

  const handleChange = useCallback(() => {
    onChange();
    debouncedSave();
  }, [onChange, debouncedSave]);

  // Best-effort flush on unmount (tab switch / close).
  useEffect(() => {
    return () => {
      const api = apiRef.current;
      if (!api) return;
      const elements = api.getSceneElements() as readonly ExcalidrawElement[];
      const appState = cleanAppStateForExport(api.getAppState());
      const files = api.getFiles();
      if (kind === "library") {
        saveEditorState(refId, "未命名", elements, appState, files).catch(() => {});
      } else {
        writeFileScene(refId, {
          type: "excalidraw",
          version: 2,
          source: "excalidraw-local",
          elements,
          appState,
          files,
        }).catch(() => {});
      }
    };
  }, [kind, refId]);

  // The API is registered via the onExcalidrawAPI callback below (no extra
  // effect needed — onExcalidrawAPI fires once on mount with the live API).

  if (!initialData) {
    return (
      <div
        style={{
          padding: "24px",
          fontFamily: "var(--ui-font)",
          color: "var(--color-gray-60)",
        }}
      >
        加载中…
      </div>
    );
  }

  return (
    <Excalidraw
      initialData={initialData}
      onExcalidrawAPI={(api) => {
        apiRef.current = api;
        onApiReady(api);
      }}
      onChange={handleChange}
      onThemeChange={onThemeChange}
    />
  );
});

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
