import { useEffect, useState, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  queryScenes,
  type SceneListItem,
  deleteScene,
  toggleStarred,
  getFolderHistory,
  addFolderToHistory,
  removeFolderFromHistory,
} from "../db/sceneStore";
import { listExcalidrawFiles, pathExists, type FolderEntry } from "../folderStore";
import type { FolderHistoryEntry } from "../db/types";
import { sidebarStyle, COLORS } from "../styles";
import {
  PlusIcon,
  ImageIcon,
  TrashIcon,
  searchIcon,
  file as FileIcon,
  LibraryIcon,
  FolderIcon,
  StarIcon,
  StarFilledIcon,
  SettingsIcon,
  CloseIcon,
} from "../icons";

type View = "library" | "folder";

interface SidebarProps {
  onOpenScene: (sceneId: string) => void;
  onOpenFile: (path: string, name: string) => void;
  onNew: () => void;
  /** Open the settings panel (CLI install etc.). */
  onOpenSettings: () => void;
  /** Currently-open tab ids (kind:ref encoded) to highlight open tabs. */
  openTabIds: Set<string>;
  refreshKey: number;
}

/**
 * Left sidebar with two views:
 *   - "library": scenes in the SQLite library (search, star, delete).
 *   - "folder": `.excalidraw` files in a user-chosen directory on disk.
 *
 * Switch via the two toggle buttons at the top. The folder view lets the user
 * browse and edit files in place (no copy into the library).
 */
export function Sidebar({
  onOpenScene,
  onOpenFile,
  onNew,
  onOpenSettings,
  openTabIds,
  refreshKey,
}: SidebarProps) {
  const [view, setView] = useState<View>("library");
  const [items, setItems] = useState<SceneListItem[]>([]);
  const [folderEntries, setFolderEntries] = useState<FolderEntry[]>([]);
  // Multi-folder model: history list + which one is active.
  const [folders, setFolders] = useState<FolderHistoryEntry[]>([]);
  const [activeFolderPath, setActiveFolderPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On first mount, restore folder history from the KV store. If there's a
  // last-used folder, preselect it (but don't force-switch to folder view —
  // the user may prefer the library as the landing view).
  useEffect(() => {
    getFolderHistory().then((history) => {
      setFolders(history);
      if (history.length > 0 && !activeFolderPath) {
        setActiveFolderPath(history[0].path);
      }
    });
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadLibrary = useCallback(async () => {
    const rows = await queryScenes({
      search: search.trim() || undefined,
      starredOnly,
    });
    setItems(rows);
  }, [search, starredOnly]);

  const reloadFolder = useCallback(async () => {
    if (!activeFolderPath) return;
    if (!(await pathExists(activeFolderPath))) {
      setError("文件夹不存在（可能已被移动或删除）");
      setFolderEntries([]);
      return;
    }
    setError(null);
    const entries = await listExcalidrawFiles(activeFolderPath);
    const filtered = search.trim()
      ? entries.filter((e) =>
          e.name.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : entries;
    setFolderEntries(filtered);
  }, [activeFolderPath, search]);

  useEffect(() => {
    if (view === "library") reloadLibrary();
    else reloadFolder();
  }, [view, reloadLibrary, reloadFolder, refreshKey]);

  const pickFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 Excalidraw 文件夹",
      defaultPath: activeFolderPath ?? undefined,
    });
    if (typeof selected === "string") {
      const name = selected.split("/").filter(Boolean).pop() ?? selected;
      const updated = await addFolderToHistory(selected, name);
      setFolders(updated);
      setActiveFolderPath(selected);
      setView("folder");
    }
  }, [activeFolderPath]);

  const switchFolder = useCallback((path: string) => {
    setActiveFolderPath(path);
    setView("folder");
    // bump lastOpened for the chosen folder + reorder.
    const entry = folders.find((f) => f.path === path);
    if (entry) {
      const now = Date.now();
      const reordered = [
        { ...entry, lastOpened: now },
        ...folders.filter((f) => f.path !== path),
      ];
      setFolders(reordered);
      addFolderToHistory(path, entry.name);
    }
  }, [folders]);

  const removeFolder = useCallback(async (path: string) => {
    const updated = await removeFolderFromHistory(path);
    setFolders(updated);
    setActiveFolderPath((cur) =>
      cur === path ? (updated[0]?.path ?? null) : cur,
    );
  }, []);

  return (
    <div className="excal-sidebar" style={sidebarStyle.container}>
      {/* View switcher — segmented control, mirrors sidebar-tab-trigger */}
      <div style={sidebarStyle.viewSwitch}>
        <button
          className={`excal-btn${view === "library" ? " excal-btn--active" : ""}`}
          onClick={() => setView("library")}
          style={{ flex: 1, gap: "0.3rem" }}
        >
          <LibraryIcon />
          资料库
        </button>
        <button
          className={`excal-btn${view === "folder" ? " excal-btn--active" : ""}`}
          onClick={() => setView("folder")}
          style={{ flex: 1, gap: "0.3rem" }}
        >
          <FolderIcon />
          文件夹
        </button>
      </div>

      <div style={sidebarStyle.header}>
        <input
          className="excal-input"
          style={{ flex: 1 }}
          placeholder={view === "library" ? "搜索资料库…" : "搜索文件…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {view === "library" && (
          <button
            className={`excal-btn excal-btn--icon${
              starredOnly ? " excal-btn--active" : " excal-btn--ghost"
            }`}
            title="只看收藏"
            onClick={() => setStarredOnly((s) => !s)}
          >
            {starredOnly ? <StarFilledIcon /> : <StarIcon />}
          </button>
        )}
        <button
          className="excal-btn excal-btn--icon excal-btn--primary"
          title="新建"
          onClick={onNew}
        >
          <PlusIcon />
        </button>
      </div>

      {view === "folder" && (
        <>
          <div style={sidebarStyle.folderBar}>
            <button
              className="excal-btn"
              style={{ gap: "0.3rem" }}
              onClick={pickFolder}
            >
              <FolderIcon />
              打开文件夹
            </button>
          </div>

          {/* Folder switcher — recent folders as a list, click to switch,
              × to remove from history (not from disk). */}
          {folders.length > 0 && (
            <div className="excal-folder-switcher">
              {folders.map((f) => {
                const active = f.path === activeFolderPath;
                return (
                  <div
                    key={f.path}
                    className={`excal-folder-chip${
                      active ? " excal-folder-chip--active" : ""
                    }`}
                    title={f.path}
                    onClick={() => switchFolder(f.path)}
                  >
                    <span className="excal-folder-chip__icon">
                      <FolderIcon />
                    </span>
                    <span className="excal-folder-chip__name">{f.name}</span>
                    <button
                      className="excal-folder-chip__close"
                      title="从历史移除"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFolder(f.path);
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {error && <div style={sidebarStyle.errorMsg}>{error}</div>}

      <div className="excal-scene-list" style={sidebarStyle.list}>
        {view === "library" && items.length === 0 && (
          <Empty text={search ? "没有匹配的图" : "还没有图,点 + 新建"} />
        )}
        {view === "folder" && folderEntries.length === 0 && (
          <Empty
            text={activeFolderPath ? "该文件夹没有 .excalidraw 文件" : "点上方按钮打开文件夹"}
          />
        )}

        {view === "library" &&
          items.map((item) => {
            const tabId = `library:${item.id}`;
            return (
              <Item
                key={item.id}
                active={openTabIds.has(tabId)}
                onClick={() => onOpenScene(item.id)}
                thumb={item.thumbnail}
                name={item.name || "未命名"}
                sub={relTime(item.updatedAt)}
                actions={
                  <>
                    <button
                      className="excal-btn excal-btn--icon excal-btn--ghost"
                      title={item.starred ? "取消收藏" : "收藏"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStarred(item.id).then(reloadLibrary);
                      }}
                      style={{ color: item.starred ? COLORS.star : undefined }}
                    >
                      {item.starred ? <StarFilledIcon /> : <StarIcon />}
                    </button>
                    <button
                      className="excal-btn excal-btn--icon excal-btn--ghost"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`删除"${item.name}"?`)) {
                          deleteScene(item.id).then(reloadLibrary);
                        }
                      }}
                      style={{ color: COLORS.danger }}
                    >
                      <TrashIcon />
                    </button>
                  </>
                }
              />
            );
          })}

        {view === "folder" &&
          folderEntries.map((entry) => {
            const tabId = `file:${entry.path}`;
            return (
              <Item
                key={entry.path}
                active={openTabIds.has(tabId)}
                onClick={() => onOpenFile(entry.path, entry.name)}
                thumb={null}
                name={entry.name}
                sub="磁盘文件"
                actions={null}
              />
            );
          })}
      </div>

      {/* Footer: settings (CLI install, etc.) */}
      <div className="excal-sidebar-footer">
        <button
          className="excal-btn excal-btn--ghost"
          style={{ gap: "0.4rem", justifyContent: "flex-start" }}
          onClick={onOpenSettings}
        >
          <SettingsIcon />
          设置
        </button>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={sidebarStyle.empty}>{text}</div>;
}

function Item({
  active,
  onClick,
  thumb,
  name,
  sub,
  actions,
}: {
  active: boolean;
  onClick: () => void;
  /** thumbnail data URL; null = show a file icon; undefined = placeholder */
  thumb?: string | null;
  name: string;
  sub: string;
  actions: React.ReactNode;
}) {
  return (
    <div
      className={`excal-row${active ? " excal-row--active" : ""}`}
      style={sidebarStyle.item}
      onClick={onClick}
    >
      <div style={sidebarStyle.thumb}>
        {thumb ? (
          <img src={thumb} style={sidebarStyle.thumbImg} alt="" />
        ) : thumb === null ? (
          <span style={{ ...sidebarStyle.thumbPlaceholder, color: COLORS.textMuted }}>
            <FileIcon />
          </span>
        ) : (
          <span style={{ ...sidebarStyle.thumbPlaceholder, color: COLORS.textMuted }}>
            <ImageIcon />
          </span>
        )}
      </div>
      <div style={sidebarStyle.itemMeta}>
        <div style={sidebarStyle.itemName}>{name}</div>
        <div style={sidebarStyle.itemTime}>{sub}</div>
      </div>
      {actions && <div style={sidebarStyle.itemActions}>{actions}</div>}
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(ts).toLocaleDateString();
}
