import { StrictMode, useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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
 * The render IPC listener (for the `excal` CLI) needs the *active* editor's
 * imperative API, so the active tab registers its API here as it mounts.
 */
function App() {
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
  } = useTabs();

  // The active editor's imperative API — used by the render IPC listener.
  const activeApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  // Settings panel (CLI install, etc.) open state.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Theme is driven by the editor. Initial guess matches index.html's
  // anti-flash script so the first paint is correct.
  const [theme, setTheme] = useState<Theme | "system">(() => {
    try {
      const stored = window.localStorage.getItem("excalidraw-theme");
      if (stored === "dark" || stored === "light") return stored;
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

  // The render IPC listener needs the active API; re-register when it changes.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    installRenderListener()
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => console.error("[excal-local] render listener failed", e));
    return () => {
      unlisten?.();
    };
  }, []);

  // Throttled sidebar refresh: called when any editor changes.
  const refreshSidebar = useCallback(
    (() => {
      let t: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (t) return;
        t = setTimeout(() => {
          setSidebarRefresh((n) => n + 1);
          t = null;
        }, 2000); // refresh at most every 2s (thumbnails are cheap to re-read)
      };
    })(),
    [],
  );

  const onApiReady = useCallback((api: ExcalidrawImperativeAPI | null) => {
    activeApiRef.current = api;
  }, []);

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

  if (!bootstrapped) {
    return (
      <div className={`excalidraw excal-chrome-root${isDark ? " theme--dark" : ""}`}>
        <div style={loadingStyle}>Loading Excalidraw Local…</div>
      </div>
    );
  }

  const openTabIds = new Set(tabs.map((t) => t.id));
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <>
      <style>{`html, body, #root { margin: 0; height: 100%; }`}</style>
      <div
        className={`excalidraw excal-chrome-root${isDark ? " theme--dark" : ""}`}
      >
        <div style={appLayoutStyle.root}>
          <Sidebar
            onOpenScene={openScene}
            onOpenFile={openFile}
            onNew={newTab}
            onOpenSettings={() => setSettingsOpen(true)}
            openTabIds={openTabIds}
            refreshKey={sidebarRefresh}
          />
          <div style={appLayoutStyle.main}>
            <TabBar
              tabs={tabs}
              activeId={activeId}
              onSelect={setActiveId}
              onClose={closeTab}
              onNew={newTab}
            />
            <div style={appLayoutStyle.editorArea}>
              {/* Only mount the active tab's editor; others unmount (data persists). */}
              {activeTab && (
                <EditorPane
                  key={activeTab.id}
                  kind={activeTab.kind}
                  refId={activeTab.refId}
                  scene={activeTab.scene}
                  onApiReady={onApiReady}
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
