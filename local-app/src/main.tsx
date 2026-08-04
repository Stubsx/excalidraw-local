import { StrictMode, useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { EditorPane } from "./components/EditorPane";
import { installRenderListener } from "./render/ipcListener";
import { useTabs } from "./tabs";
import { appLayoutStyle } from "./styles";

/**
 * Excalidraw Local — multi-tab host.
 *
 * Layout: [Sidebar | (TabBar / EditorArea)]
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

  if (!bootstrapped) {
    return (
      <div style={loadingStyle}>Loading Excalidraw Local…</div>
    );
  }

  const openTabIds = new Set(tabs.map((t) => t.id));
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <>
      <style>{`html, body, #root { margin: 0; height: 100%; }`}</style>
      <div style={appLayoutStyle.root}>
        <Sidebar
          onOpenScene={openScene}
          onOpenFile={openFile}
          onNew={newTab}
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
                onChange={() => {
                  markDirty(activeTab.id);
                  refreshSidebar();
                }}
              />
            )}
          </div>
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
  fontFamily: "system-ui, sans-serif",
  color: "#888",
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
