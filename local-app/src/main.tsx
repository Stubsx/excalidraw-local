import { StrictMode, useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import type { Theme } from "@excalidraw/element/types";

import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { EditorPane } from "./components/EditorPane";
import { SettingsPanel } from "./components/SettingsPanel";
import { installRenderListener } from "./render/ipcListener";
import { useTabs } from "./tabs";
import { appLayoutStyle } from "./styles";

// Excalidraw's CSS variables (colors, fonts, radii) are scoped to `.excalidraw`.
// Importing chrome.css here adds the button/input/tab recipes that consume
// those variables, plus defensive fallback values.
import "./chrome.css";

/**
 * Excalidraw Local — multi-tab host.
 *
 * Layout: [Sidebar | (TabBar / EditorArea)]
 *
 * The whole app is wrapped in `.excalidraw.excal-chrome-root` so that the
 * chrome inherits Excalidraw's CSS variables (colors, --ui-font, radii) and
 * follows its light/dark theme: toggling `theme--dark` on this root flips every
 * token, and the editor's `onThemeChange` keeps the class in sync.
 *
 * The active editor flushes its pending snapshot before navigation or exit.
 */
function App() {
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const flushActive = useCallback(async () => {
    await flushRef.current?.();
  }, []);
  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush;
  }, []);
  const {
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
    error,
    setError,
    busy,
    prepareExit,
    syncLibrary,
    renameTab,
  } = useTabs(flushActive);

  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  // Settings panel (CLI install, etc.) open state.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Theme is driven by the editor. Initial guess matches index.html's
  // anti-flash script so the first paint is correct.
  const [theme, setTheme] = useState<Theme | "system">(() => {
    try {
      const stored = window.localStorage.getItem("excalidraw-theme");
      if (stored === "dark" || stored === "light") {
        return stored;
      }
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    } catch {
      // ignore (SSR / storage disabled)
    }
    return "light";
  });

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);

  // Keep <html> in sync too, so the anti-flash background in index.html
  // matches the chrome between boot and editor mount.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Throttled sidebar refresh: called when any editor changes, or when a
  // CLI-rendered scene is auto-saved into the library.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSidebar = useCallback(() => {
    if (refreshTimer.current) {
      return;
    }
    refreshTimer.current = setTimeout(() => {
      setSidebarRefresh((n) => n + 1);
      refreshTimer.current = null;
    }, 300);
  }, []);
  useEffect(
    () => () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    },
    [],
  );

  // Render and external-library notifications refresh the sidebar.
  // Pass refreshSidebar so that CLI-rendered scenes (auto-saved into the
  // library) make the sidebar list refresh.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    installRenderListener(() => {
      refreshSidebar();
      void syncLibrary();
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((e) => console.error("[excal-local] render listener failed", e));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshSidebar, syncLibrary]);

  // Editor → chrome theme sync. Excalidraw reports "light" | "dark" | "system".
  const onThemeChange = useCallback((next: Theme | "system") => {
    setTheme(next);
  }, []);

  // Stable per-tab onChange: an inline arrow would change identity on every
  // App render and defeat EditorPane's memo.
  const activeTabId = activeId;
  const onEditorChange = useCallback(() => {
    if (activeTabId) {
      markDirty(activeTabId);
    }
    refreshSidebar();
  }, [activeTabId, markDirty, refreshSidebar]);

  const onEditorSaved = useCallback(() => {
    if (activeId) {
      markClean(activeId);
    }
    refreshSidebar();
  }, [activeId, markClean, refreshSidebar]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    listen("app-exit-requested", async () => {
      try {
        await prepareExit();
        await invoke("app_exit");
      } catch (e) {
        setError(`退出前保存失败：${e}`);
      }
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          cleanup = fn;
        }
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [prepareExit, setError]);

  if (!bootstrapped) {
    return (
      <div
        className={`excalidraw excal-chrome-root${
          isDark ? " theme--dark" : ""
        }`}
      >
        <div style={loadingStyle}>Loading Excalidraw Local…</div>
      </div>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <>
      <style>{`html, body, #root { margin: 0; height: 100%; }`}</style>
      <div
        className={`excalidraw excal-chrome-root${
          isDark ? " theme--dark" : ""
        }`}
      >
        <div style={appLayoutStyle.root}>
          <Sidebar
            onOpenScene={openScene}
            onOpenFile={openFile}
            onNew={() => {
              void newTab().then(refreshSidebar);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            activeTabId={activeId}
            refreshKey={sidebarRefresh}
            onSceneRenamed={renameTab}
            beforeMutation={flushActive}
            onSceneDeleted={(id) => closeTab(`library:${id}`)}
          />
          <div style={appLayoutStyle.main}>
            <TabBar
              tabs={tabs}
              activeId={activeId}
              onSelect={setActiveId}
              onClose={closeTab}
              onNew={() => {
                void newTab().then(refreshSidebar);
              }}
            />
            {error && (
              <div className="excal-error-banner" role="alert">
                {error}
                <button
                  className="excal-btn"
                  onClick={() => {
                    void flushActive()
                      .then(() => setError(null))
                      .catch(() => {});
                  }}
                >
                  重试保存
                </button>
              </div>
            )}
            {busy && (
              <div role="status" className="excal-operation-status">
                正在保存并切换…
              </div>
            )}
            <div
              inert={busy}
              aria-busy={busy}
              style={appLayoutStyle.editorArea}
            >
              {/* Only mount the active tab's editor; others unmount (data persists). */}
              {activeTab && (
                <EditorPane
                  key={`${activeTab.id}:${activeTab.revision}`}
                  kind={activeTab.kind}
                  refId={activeTab.refId}
                  scene={activeTab.scene}
                  registerFlush={registerFlush}
                  onSaved={onEditorSaved}
                  onError={setError}
                  onChange={onEditorChange}
                  onThemeChange={onThemeChange}
                />
              )}
            </div>
          </div>
          {/* Settings drawer overlays the editor area. */}
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      </div>
    </>
  );
}

const loadingStyle: React.CSSProperties = {
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--ui-font)",
  color: "var(--color-gray-60)",
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
