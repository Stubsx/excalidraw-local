import { useCallback, useEffect, useRef, useState } from "react";

import {
  getOpenTabs,
  getScene,
  setOpenTabs as persistOpenTabs,
  uuid,
  upsertScene,
} from "./db/sceneStore";
import { readFileScene } from "./folderStore";
import type { SavedScene } from "./db/types";

/**
 * Where a tab's content lives.
 * - "library": a scene in the SQLite library (id-keyed).
 * - "file": a `.excalidraw` file on disk (path-keyed, edited in place).
 */
export type TabKind = "library" | "file";

/**
 * A single open tab. `scene` holds the loaded data (null while loading).
 */
export interface Tab {
  /** Stable unique id for React keys (NOT the scene id — see kind-specific id). */
  id: string;
  kind: TabKind;
  /** For kind="library": the scene id. For kind="file": the absolute path. */
  refId: string;
  name: string;
  scene: SavedScene | null; // normalized view of the loaded data
  dirty: boolean; // unsaved changes
}

/**
 * Build a tab id that encodes kind+ref so the same scene/file isn't opened
 * twice.
 */
function tabIdFor(kind: TabKind, refId: string): string {
  return `${kind}:${refId}`;
}

/**
 * Multi-tab state manager.
 *
 * Two kinds of tabs coexist:
 *   - "library" tabs: bound to SQLite scenes (autosaved to the db).
 *   - "file" tabs: bound to `.excalidraw` files on disk (saved in place).
 *
 * Only library tabs are persisted across sessions (file tabs require the
 * folder to still exist + aren't worth re-opening blindly).
 */
export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  const initGuard = useRef(false);

  useEffect(() => {
    if (!bootstrapped) return;
    // Only persist library tab ids (file tabs are re-opened via the folder view).
    const libIds = tabs.filter((t) => t.kind === "library").map((t) => t.refId);
    const activeLib = tabs.find((t) => t.id === activeId && t.kind === "library");
    persistOpenTabs(libIds, activeLib ? activeLib.refId : null).catch(() => {});
  }, [tabs, activeId, bootstrapped]);

  useEffect(() => {
    if (initGuard.current) return;
    initGuard.current = true;
    let cancelled = false;
    (async () => {
      let { ids, activeId: savedActive } = await getOpenTabs();
      const existing: Tab[] = [];
      for (const id of ids) {
        const sc = await getScene(id);
        if (sc) {
          existing.push({
            id: tabIdFor("library", id),
            kind: "library",
            refId: id,
            name: sc.name,
            scene: sc,
            dirty: false,
          });
        }
      }
      if (existing.length === 0) {
        const newId = uuid();
        const now = Date.now();
        await upsertScene({
          id: newId,
          name: "未命名",
          elements: [],
          appState: {},
          files: {},
          starred: false,
          createdAt: now,
          updatedAt: now,
        });
        const sc = await getScene(newId);
        existing.push({
          id: tabIdFor("library", newId),
          kind: "library",
          refId: newId,
          name: "未命名",
          scene: sc,
          dirty: false,
        });
        savedActive = tabIdFor("library", newId);
      } else {
        savedActive = savedActive ? tabIdFor("library", savedActive) : null;
      }
      if (cancelled) return;
      setTabs(existing);
      setActiveId(
        savedActive && existing.some((t) => t.id === savedActive)
          ? savedActive
          : existing[0].id,
      );
      setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Open a library scene in a new tab (or focus it if already open). */
  const openScene = useCallback(async (sceneId: string) => {
    const tabId = tabIdFor("library", sceneId);
    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) {
        setActiveId(tabId);
        return prev;
      }
      const placeholder: Tab = {
        id: tabId,
        kind: "library",
        refId: sceneId,
        name: "…",
        scene: null,
        dirty: false,
      };
      getScene(sceneId).then((sc) => {
        if (sc) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, name: sc.name, scene: sc } : t,
            ),
          );
        }
      });
      setActiveId(tabId);
      return [...prev, placeholder];
    });
  }, []);

  /** Open a `.excalidraw` file from disk in a new tab (edited in place). */
  const openFile = useCallback(async (path: string, name: string) => {
    const tabId = tabIdFor("file", path);
    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) {
        setActiveId(tabId);
        return prev;
      }
      const placeholder: Tab = {
        id: tabId,
        kind: "file",
        refId: path,
        name,
        scene: null,
        dirty: false,
      };
      readFileScene(path)
        .then((data) => {
          const normalized: SavedScene = {
            id: path,
            name,
            elements: data.elements as SavedScene["elements"],
            appState: data.appState as SavedScene["appState"],
            files: data.files as SavedScene["files"],
            starred: false,
            createdAt: 0,
            updatedAt: 0,
          };
          setTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, scene: normalized } : t)),
          );
        })
        .catch((e) => console.error("[tabs] failed to read file", path, e));
      setActiveId(tabId);
      return [...prev, placeholder];
    });
  }, []);

  /** Create a new blank library scene + tab. */
  const newTab = useCallback(async () => {
    const id = uuid();
    const now = Date.now();
    await upsertScene({
      id,
      name: "未命名",
      elements: [],
      appState: {},
      files: {},
      starred: false,
      createdAt: now,
      updatedAt: now,
    });
    const sc = await getScene(id);
    const tabId = tabIdFor("library", id);
    setTabs((prev) => [
      ...prev,
      { id: tabId, kind: "library", refId: id, name: "未命名", scene: sc, dirty: false },
    ]);
    setActiveId(tabId);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const newId = uuid();
          const now = Date.now();
          upsertScene({
            id: newId,
            name: "未命名",
            elements: [],
            appState: {},
            files: {},
            starred: false,
            createdAt: now,
            updatedAt: now,
          }).then(() =>
            getScene(newId).then((sc) => {
              const tid = tabIdFor("library", newId);
              setTabs([
                { id: tid, kind: "library", refId: newId, name: "未命名", scene: sc, dirty: false },
              ]);
              setActiveId(tid);
            }),
          );
          return prev;
        }
        if (activeId === id) {
          setActiveId(next[Math.max(0, idx - 1)].id);
        }
        return next;
      });
    },
    [activeId],
  );

  const markDirty = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dirty: true } : t)),
    );
  }, []);

  const markClean = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dirty: false } : t)),
    );
  }, []);

  return {
    tabs,
    activeId,
    bootstrapped,
    setActiveId,
    openScene,
    openFile,
    newTab,
    closeTab,
    markDirty,
    markClean,
  };
}

