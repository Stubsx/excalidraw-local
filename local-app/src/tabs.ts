import { useCallback, useEffect, useRef, useState } from "react";

import {
  getOpenTabs,
  getScene,
  setOpenTabs,
  uuid,
  upsertScene,
} from "./db/sceneStore";
import { readFileScene } from "./folderStore";

import type { SavedScene } from "./db/types";

export type TabKind = "library" | "file";
export interface Tab {
  id: string;
  kind: TabKind;
  refId: string;
  name: string;
  scene: SavedScene;
  dirty: boolean;
  revision: number;
}
interface Session {
  tabs: Tab[];
  activeId: string | null;
}

/** Navigation is serialized: flush the editor, then load fresh persisted data. */
export function useTabs(beforeLeave: () => Promise<void>) {
  const [session, setSession] = useState<Session>({ tabs: [], activeId: null });
  const current = useRef(session);
  const queue = useRef(Promise.resolve());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const commit = useCallback((next: Session) => {
    current.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await getOpenTabs();
        const tabs: Tab[] = [];
        for (const id of saved.ids) {
          const scene = await getScene(id);
          if (scene) {
            tabs.push({
              id: `library:${id}`,
              kind: "library",
              refId: id,
              name: scene.name,
              scene,
              dirty: false,
              revision: 0,
            });
          }
        }
        if (cancelled) {
          return;
        }
        const activeId = `library:${saved.activeId}`;
        commit({
          tabs,
          activeId: tabs.some((t) => t.id === activeId)
            ? activeId
            : tabs[0]?.id ?? null,
        });
      } catch (e) {
        if (!cancelled) {
          setError(`恢复会话失败：${e}`);
        }
      } finally {
        if (!cancelled) {
          setBootstrapped(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit]);

  const persist = useCallback(async () => {
    const { tabs, activeId } = current.current;
    const active = tabs.find((t) => t.id === activeId && t.kind === "library");
    await setOpenTabs(
      tabs.filter((t) => t.kind === "library").map((t) => t.refId),
      active?.refId ?? null,
    );
  }, []);
  const run = useCallback(
    (operation: () => Promise<void>) => {
      setBusy(true);
      const task = queue.current
        .then(async () => {
          setError(null);
          await beforeLeave();
          await operation();
          await persist();
        })
        .catch((e) => {
          setError(String(e));
        });
      queue.current = task;
      void task.finally(() => {
        if (queue.current === task) {
          setBusy(false);
        }
      });
      return task;
    },
    [beforeLeave, persist],
  );

  const load = useCallback(
    async (kind: TabKind, refId: string, name: string): Promise<SavedScene> => {
      if (kind === "library") {
        const scene = await getScene(refId);
        if (!scene) {
          throw new Error("这张图已删除或不存在。");
        }
        return scene;
      }
      const data = await readFileScene(refId);
      return {
        id: refId,
        name,
        elements: data.elements as SavedScene["elements"],
        appState: data.appState,
        files: data.files as SavedScene["files"],
        starred: false,
        createdAt: 0,
        updatedAt: 0,
      };
    },
    [],
  );

  const open = useCallback(
    (kind: TabKind, refId: string, name: string) =>
      run(async () => {
        const id = `${kind}:${refId}`;
        if (current.current.activeId === id) {
          return;
        }
        const scene = await load(kind, refId, name);
        const old = current.current.tabs.find((t) => t.id === id);
        const tab: Tab = {
          id,
          kind,
          refId,
          name: scene.name,
          scene,
          dirty: false,
          revision: (old?.revision ?? -1) + 1,
        };
        commit({
          tabs: old
            ? current.current.tabs.map((t) => (t.id === id ? tab : t))
            : [...current.current.tabs, tab],
          activeId: id,
        });
      }),
    [run, load, commit],
  );
  const openScene = useCallback(
    (id: string) => open("library", id, ""),
    [open],
  );
  const openFile = useCallback(
    (path: string, name: string) => open("file", path, name),
    [open],
  );
  const setActiveId = useCallback(
    (id: string) => {
      const tab = current.current.tabs.find((t) => t.id === id);
      if (tab) {
        return open(tab.kind, tab.refId, tab.name);
      }
    },
    [open],
  );
  const newTab = useCallback(
    () =>
      run(async () => {
        const id = uuid();
        const now = Date.now();
        const scene: SavedScene = {
          id,
          name: "未命名",
          elements: [],
          appState: {},
          files: {},
          starred: false,
          createdAt: now,
          updatedAt: now,
        };
        await upsertScene(scene);
        const tab: Tab = {
          id: `library:${id}`,
          kind: "library",
          refId: id,
          name: scene.name,
          scene,
          dirty: false,
          revision: 0,
        };
        commit({ tabs: [...current.current.tabs, tab], activeId: tab.id });
      }),
    [run, commit],
  );
  const closeTab = useCallback(
    (id: string) =>
      run(async () => {
        const previous = current.current;
        const index = previous.tabs.findIndex((t) => t.id === id);
        if (index < 0) {
          return;
        }
        let tabs = previous.tabs.filter((t) => t.id !== id);
        const activeId =
          previous.activeId === id
            ? tabs[Math.max(0, index - 1)]?.id ?? null
            : previous.activeId;
        if (activeId && activeId !== previous.activeId) {
          const next = tabs.find((t) => t.id === activeId)!;
          const scene = await load(next.kind, next.refId, next.name);
          tabs = tabs.map((t) =>
            t.id === activeId
              ? { ...t, scene, name: scene.name, revision: t.revision + 1 }
              : t,
          );
        }
        commit({ tabs, activeId });
      }),
    [run, load, commit],
  );
  const setDirty = useCallback(
    (id: string, dirty: boolean) => {
      if (!current.current.tabs.some((t) => t.id === id && t.dirty !== dirty)) {
        return;
      }
      commit({
        ...current.current,
        tabs: current.current.tabs.map((t) =>
          t.id === id ? { ...t, dirty } : t,
        ),
      });
    },
    [commit],
  );
  const markDirty = useCallback((id: string) => setDirty(id, true), [setDirty]);
  const markClean = useCallback(
    (id: string) => setDirty(id, false),
    [setDirty],
  );
  const renameTab = useCallback(
    (sceneId: string, name: string) => {
      commit({
        ...current.current,
        tabs: current.current.tabs.map((t) =>
          t.kind === "library" && t.refId === sceneId ? { ...t, name } : t,
        ),
      });
    },
    [commit],
  );
  const syncLibrary = useCallback(async () => {
    const snapshot = current.current;
    try {
      const fresh = await Promise.all(
        snapshot.tabs.map(async (tab) => {
          if (tab.kind !== "library") {
            return tab;
          }
          const scene = await getScene(tab.refId);
          const changed =
            !scene ||
            JSON.stringify([scene.elements, scene.appState, scene.files]) !==
              JSON.stringify([
                tab.scene.elements,
                tab.scene.appState,
                tab.scene.files,
              ]);
          if (tab.dirty) {
            if (changed) {
              setError(
                "图稿已由其他程序更新，当前修改仍在画布中。请先导出备份，再关闭并重新打开。",
              );
            }
            return tab;
          }
          if (!scene) {
            return null;
          }
          return {
            ...tab,
            name: scene.name,
            scene,
            revision: changed ? tab.revision + 1 : tab.revision,
          };
        }),
      );
      if (current.current !== snapshot) {
        return;
      }
      const tabs = fresh.filter((tab): tab is Tab => tab !== null);
      commit({
        tabs,
        activeId: tabs.some((t) => t.id === snapshot.activeId)
          ? snapshot.activeId
          : tabs[0]?.id ?? null,
      });
      await persist();
    } catch (e) {
      setError(`同步资料库失败：${e}`);
    }
  }, [commit, persist]);
  const prepareExit = useCallback(async () => {
    await queue.current;
    await beforeLeave();
    await persist();
  }, [beforeLeave, persist]);
  return {
    ...session,
    syncLibrary,
    prepareExit,
    bootstrapped,
    busy,
    error,
    setError,
    setActiveId,
    openScene,
    openFile,
    newTab,
    closeTab,
    markDirty,
    markClean,
    renameTab,
    persist,
  };
}
