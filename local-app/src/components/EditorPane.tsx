import { memo, useCallback, useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";
import { exportToBlob } from "@excalidraw/utils/export";
import { getNonDeletedElements } from "@excalidraw/element";

import type { Theme } from "@excalidraw/element/types";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import { saveEditorState, setThumbnail } from "../db/sceneStore";
import { writeFileScene } from "../folderStore";
import { createAutosave, type Autosave } from "../autosave";

import type { SavedScene } from "../db/types";
import type { TabKind } from "../tabs";

type Snapshot = Pick<SavedScene, "elements" | "appState" | "files">;
interface Props {
  kind: TabKind;
  refId: string;
  scene: SavedScene;
  registerFlush: (flush: (() => Promise<void>) | null) => void;
  onChange: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  onThemeChange: (theme: Theme | "system") => void;
}

export const EditorPane = memo(
  ({
    kind,
    refId,
    scene,
    registerFlush,
    onChange,
    onSaved,
    onError,
    onThemeChange,
  }: Props) => {
    // Initial data is immutable for this editor mount; navigation loads a fresh scene.
    const initial = useRef(scene);
    const api = useRef<ExcalidrawImperativeAPI | null>(null);
    const signature = useRef<string | null>(null);
    const expectedContent = useRef<Snapshot>(scene);
    const callbacks = useRef({ onChange, onSaved, onError });
    callbacks.current = { onChange, onSaved, onError };
    const saver = useRef<Autosave<Snapshot> | null>(null);
    if (!saver.current) {
      saver.current = createAutosave<Snapshot>(
        async (snapshot) => {
          if (kind === "library") {
            await saveEditorState(
              refId,
              snapshot.elements,
              snapshot.appState,
              snapshot.files,
              expectedContent.current,
            );
            expectedContent.current = snapshot;
            const elements = getNonDeletedElements(snapshot.elements);
            // Thumbnail failure must not turn a successfully saved scene into an error.
            try {
              if (elements.length) {
                const blob = await exportToBlob({
                  elements,
                  appState: { ...snapshot.appState, exportBackground: true },
                  files: snapshot.files,
                  maxWidthOrHeight: 200,
                });
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(blob);
                });
                await setThumbnail(refId, data);
              } else {
                await setThumbnail(refId, "");
              }
            } catch (e) {
              console.warn("Thumbnail update failed", e);
            }
          } else {
            await writeFileScene(refId, {
              type: "excalidraw",
              version: 2,
              source: "excalidraw-local",
              ...snapshot,
            });
          }
        },
        () => callbacks.current.onSaved(),
        (e) =>
          callbacks.current.onError(`保存失败，修改仍保留在当前画布中：${e}`),
      );
    }
    const handleChange: NonNullable<ExcalidrawProps["onChange"]> = useCallback(
      (elements, appState, files) => {
        // Capture data at change time, never from a possibly unmounted editor API.
        const snapshot = {
          elements,
          appState: cleanAppStateForExport(appState),
          files,
        };
        const next = JSON.stringify(snapshot);
        if (signature.current === null) {
          signature.current = next;
          return;
        }
        if (signature.current === next) {
          return;
        }
        signature.current = next;
        callbacks.current.onChange();
        saver.current!.schedule(snapshot);
      },
      [],
    );

    useEffect(() => {
      const save = saver.current!;
      registerFlush(async () => {
        // Read the mounted editor once more in case its final onChange is still queued.
        if (api.current) {
          handleChange(
            api.current.getSceneElementsIncludingDeleted(),
            api.current.getAppState(),
            api.current.getFiles(),
          );
        }
        await save.flush();
      });
      return () => {
        save.cancel();
        registerFlush(null);
      };
    }, [registerFlush, handleChange]);

    return (
      <Excalidraw
        onExcalidrawAPI={(value) => {
          api.current = value;
        }}
        initialData={initial.current}
        initialState={{
          viewport: {
            target: initial.current.elements.filter(
              (element) => !element.isDeleted,
            ),
            fit: "scale-down",
            offsets: { top: 88, right: 32, bottom: 64, left: 32 },
          },
        }}
        onChange={handleChange}
        onThemeChange={onThemeChange}
      />
    );
  },
);
