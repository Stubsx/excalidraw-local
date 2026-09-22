import { useEffect, useState, useCallback, useRef } from "react";
import {
  open as openDialog,
  confirm as confirmDialog,
} from "@tauri-apps/plugin-dialog";

import {
  queryScenes,
  type SceneListItem,
  deleteScene,
  toggleStarred,
  renameScene,
  getFolderHistory,
  addFolderToHistory,
  removeFolderFromHistory,
} from "../db/sceneStore";
import {
  listExcalidrawFiles,
  pathExists,
  type FolderEntry,
} from "../folderStore";

import {
  PlusIcon,
  ImageIcon,
  TrashIcon,
  file as FileIcon,
  LibraryIcon,
  FolderIcon,
  StarIcon,
  StarFilledIcon,
  SettingsIcon,
  CloseIcon,
  PencilIcon,
  MoreIcon,
  searchIcon as SearchIcon,
} from "../icons";

import type { FolderHistoryEntry } from "../db/types";

type View = "library" | "folder";

interface SidebarProps {
  onOpenScene: (sceneId: string) => void;
  onOpenFile: (path: string, name: string) => void;
  onNew: () => void;
  onPickFile: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** Open the settings panel (CLI install etc.). */
  onOpenSettings: () => void;
  /** Only the current tab (kind:ref encoded) is highlighted. */
  activeTabId: string | null;
  refreshKey: number;
  /**
   * Called after a library scene is renamed in the sidebar, so open tabs can
   * sync their title. Receives (sceneId, newName).
   */
  onSceneRenamed: (sceneId: string, newName: string) => void;
  beforeMutation: () => Promise<void>;
  onSceneDeleted: (sceneId: string) => void;
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
  onPickFile,
  searchRef,
  onOpenSettings,
  activeTabId,
  refreshKey,
  onSceneRenamed,
  beforeMutation,
  onSceneDeleted,
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
    let disposed = false;
    getFolderHistory()
      .then((history) => {
        if (disposed) {
          return;
        }
        setFolders(history);
        if (history.length > 0 && !activeFolderPath) {
          setActiveFolderPath(history[0].path);
        }
      })
      .catch((e) => {
        if (!disposed) {
          setError(String(e));
        }
      });
    return () => {
      disposed = true;
    };
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const libraryLoad = useRef(0);
  const folderLoad = useRef(0);
  const reloadLibrary = useCallback(async () => {
    const request = ++libraryLoad.current;
    const rows = await queryScenes({
      search: search.trim() || undefined,
      starredOnly,
    });
    if (request === libraryLoad.current) {
      setItems(rows);
      setError(null);
    }
  }, [search, starredOnly]);

  const reloadFolder = useCallback(async () => {
    const request = ++folderLoad.current;
    if (!activeFolderPath) {
      setFolderEntries([]);
      return;
    }
    const folderExists = await pathExists(activeFolderPath);
    if (request !== folderLoad.current) {
      return;
    }
    if (!folderExists) {
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
    if (request === folderLoad.current) {
      setFolderEntries(filtered);
    }
  }, [activeFolderPath, search]);

  useEffect(() => {
    if (view === "library") {
      void reloadLibrary().catch((e) => setError(String(e)));
    } else {
      void reloadFolder().catch((e) => setError(String(e)));
    }
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

  const switchFolder = useCallback(
    (path: string) => {
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
        void addFolderToHistory(path, entry.name).catch((e) =>
          setError(String(e)),
        );
      }
    },
    [folders],
  );

  const removeFolder = useCallback(async (path: string) => {
    const updated = await removeFolderFromHistory(path);
    setFolders(updated);
    setActiveFolderPath((cur) =>
      cur === path ? updated[0]?.path ?? null : cur,
    );
  }, []);

  const filtered = !!search.trim() || (view === "library" && starredOnly);
  const resetFilters = () => {
    setSearch("");
    setStarredOnly(false);
  };
  const selectView = (next: View) => {
    setView(next);
    setSearch("");
    setError(null);
  };
  return (
    <aside className="excal-sidebar" aria-label="图稿导航">
      <div className="excal-sidebar-create">
        <button className="excal-btn excal-btn--primary" onClick={onNew}>
          <PlusIcon />
          新建画布<kbd>⌘ N</kbd>
        </button>
        <button
          className="excal-btn excal-btn--icon"
          onClick={onPickFile}
          title="打开 .excalidraw 文件（⌘ O）"
        >
          <FolderIcon />
        </button>
      </div>
      <div className="excal-view-switch" role="group" aria-label="图稿来源">
        <button
          className={`excal-btn${
            view === "library" ? " excal-btn--active" : " excal-btn--ghost"
          }`}
          aria-pressed={view === "library"}
          onClick={() => selectView("library")}
        >
          <LibraryIcon />
          资料库
        </button>
        <button
          className={`excal-btn${
            view === "folder" ? " excal-btn--active" : " excal-btn--ghost"
          }`}
          aria-pressed={view === "folder"}
          onClick={() => selectView("folder")}
        >
          <FolderIcon />
          文件夹
        </button>
      </div>
      <div className="excal-search">
        <SearchIcon />
        <input
          ref={searchRef}
          className="excal-input"
          type="search"
          aria-label={view === "library" ? "搜索资料库" : "搜索文件"}
          placeholder={view === "library" ? "搜索图稿…" : "搜索文件…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
            }
          }}
        />
        {search && (
          <button
            className="excal-btn excal-btn--icon excal-btn--ghost"
            title="清除搜索"
            onClick={() => {
              setSearch("");
              searchRef.current?.focus();
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {view === "folder" && (
        <div className="excal-folder-section">
          <button
            className="excal-btn excal-folder-open"
            onClick={() => {
              void pickFolder().catch((e) => setError(String(e)));
            }}
          >
            <PlusIcon />
            添加文件夹
          </button>
          {folders.length > 0 && (
            <div className="excal-folder-switcher">
              {folders.map((f) => (
                <div
                  key={f.path}
                  className={`excal-folder-chip${
                    f.path === activeFolderPath
                      ? " excal-folder-chip--active"
                      : ""
                  }`}
                >
                  <button
                    className="excal-folder-select"
                    title={f.path}
                    aria-pressed={f.path === activeFolderPath}
                    onClick={() => switchFolder(f.path)}
                  >
                    <FolderIcon />
                    <span>{f.name}</span>
                  </button>
                  <button
                    className="excal-btn excal-btn--icon excal-btn--ghost"
                    title={`从历史移除「${f.name}」`}
                    onClick={() => {
                      void removeFolder(f.path).catch((e) =>
                        setError(String(e)),
                      );
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="excal-list-heading">
        <span>
          {search.trim()
            ? "搜索结果"
            : view === "folder"
            ? "文件"
            : starredOnly
            ? "我的收藏"
            : "全部图稿"}
          <span className="excal-count">
            {view === "library" ? items.length : folderEntries.length}
          </span>
        </span>
        {view === "library" && (
          <button
            className={`excal-btn excal-btn--ghost excal-filter${
              starredOnly ? " excal-filter--active" : ""
            }`}
            aria-pressed={starredOnly}
            title="只看收藏"
            onClick={() => setStarredOnly((s) => !s)}
          >
            {starredOnly ? <StarFilledIcon /> : <StarIcon />}收藏
          </button>
        )}
      </div>
      {error && (
        <div className="excal-sidebar-error" role="alert">
          {error}
          <button
            className="excal-btn excal-btn--ghost"
            onClick={() => {
              void (
                view === "library" ? reloadLibrary() : reloadFolder()
              ).catch((e) => setError(String(e)));
            }}
          >
            重试
          </button>
        </div>
      )}
      <div
        className="excal-scene-list"
        aria-label={view === "library" ? "资料库图稿" : "文件夹图稿"}
      >
        {view === "library" && items.length === 0 && (
          <Empty
            title={
              search.trim()
                ? "没有找到匹配的图稿"
                : starredOnly
                ? "还没有收藏"
                : "第一张图，从这里开始"
            }
            text={
              filtered
                ? "试试其他关键词，或查看全部图稿。"
                : "新建画布后，图稿会自动保存在这里。"
            }
            action={filtered ? "清除筛选" : "新建画布"}
            onAction={filtered ? resetFilters : onNew}
          />
        )}
        {view === "folder" && folderEntries.length === 0 && (
          <Empty
            title={
              search.trim()
                ? "没有找到匹配的文件"
                : activeFolderPath
                ? "文件夹里还没有图稿"
                : "连接你的图稿文件夹"
            }
            text={
              activeFolderPath
                ? "支持 .excalidraw 文件，编辑会保存回原文件。"
                : "选择本机文件夹，在这里浏览和编辑图稿。"
            }
            action={search.trim() ? "清除搜索" : "选择文件夹"}
            onAction={
              search.trim()
                ? () => setSearch("")
                : () => {
                    void pickFolder().catch((e) => setError(String(e)));
                  }
            }
          />
        )}
        {view === "library" &&
          items.map((item) => (
            <LibraryItem
              key={item.id}
              active={activeTabId === `library:${item.id}`}
              item={item}
              onClick={() => onOpenScene(item.id)}
              onRenamed={reloadLibrary}
              onSceneRenamed={onSceneRenamed}
              beforeMutation={beforeMutation}
              onSceneDeleted={onSceneDeleted}
              onError={(e) => setError(String(e))}
            />
          ))}
        {view === "folder" &&
          folderEntries.map((entry) => (
            <div
              key={entry.path}
              className={`excal-row${
                activeTabId === `file:${entry.path}` ? " excal-row--active" : ""
              }`}
            >
              <button
                className="excal-row-open"
                title={entry.path}
                aria-current={
                  activeTabId === `file:${entry.path}` ? "page" : undefined
                }
                onClick={() => onOpenFile(entry.path, entry.name)}
              >
                <span className="excal-thumb">
                  <FileIcon />
                </span>
                <span className="excal-row-meta">
                  <span className="excal-row-name">{entry.name}</span>
                  <span className="excal-row-time">磁盘文件 · 原位编辑</span>
                </span>
              </button>
            </div>
          ))}
      </div>
      <footer className="excal-sidebar-footer">
        <span className="excal-storage-note">
          <span className="excal-local-dot" />
          图稿保存在此 Mac
        </span>
        <button className="excal-btn excal-btn--ghost" onClick={onOpenSettings}>
          <SettingsIcon />
          设置与 AI 技能<kbd>⌘ ,</kbd>
        </button>
      </footer>
    </aside>
  );
}

function Empty({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="excal-list-empty">
      <ImageIcon />
      <strong>{title}</strong>
      <p>{text}</p>
      <button className="excal-btn" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

function relTime(ts: number): string {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (m < 1) {
    return "刚刚编辑";
  }
  if (m < 60) {
    return `${m} 分钟前`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h} 小时前`;
  }
  const d = Math.floor(h / 24);
  if (d < 30) {
    return `${d} 天前`;
  }
  return new Date(ts).toLocaleDateString("zh-CN");
}

function LibraryItem({
  item,
  active,
  onClick,
  onRenamed,
  onSceneRenamed,
  beforeMutation,
  onSceneDeleted,
  onError,
}: {
  item: SceneListItem;
  active: boolean;
  onClick: () => void;
  onRenamed: () => void;
  onSceneRenamed: (sceneId: string, newName: string) => void;
  beforeMutation: () => Promise<void>;
  onSceneDeleted: (sceneId: string) => void;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name || "未命名");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelling = useRef(false);
  const committing = useRef(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = item.name || "未命名";

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!menuPosition) {
      return;
    }
    menuRef.current?.querySelector("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        setMenuPosition(null);
      }
    };
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuPosition(null);
      }
    };
    const resize = () => setMenuPosition(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [menuPosition]);

  const commit = async () => {
    if (cancelling.current || committing.current) {
      return;
    }
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === item.name) {
      return;
    }
    committing.current = true;
    try {
      await beforeMutation();
      await renameScene(item.id, trimmed);
      onRenamed();
      onSceneRenamed(item.id, trimmed);
    } catch (e) {
      onError(e);
      setDraft(name);
    } finally {
      committing.current = false;
    }
  };
  const closeMenu = () => {
    setMenuPosition(null);
    triggerRef.current?.focus();
  };
  const remove = async () => {
    closeMenu();
    try {
      if (
        await confirmDialog(`删除「${name}」后，它将从资料库中移除。`, {
          title: "删除图稿",
          kind: "warning",
          okLabel: "删除",
          cancelLabel: "保留图稿",
        })
      ) {
        await beforeMutation();
        await deleteScene(item.id);
        onSceneDeleted(item.id);
        onRenamed();
      }
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div className={`excal-row${active ? " excal-row--active" : ""}`}>
      {editing ? (
        <div className="excal-row-rename">
          <PencilIcon />
          <input
            ref={inputRef}
            className="excal-input"
            aria-label="图稿名称"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) {
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelling.current = true;
                setEditing(false);
                triggerRef.current?.focus();
              }
            }}
            onBlur={() => {
              void commit();
            }}
          />
        </div>
      ) : (
        <button
          className="excal-row-open"
          onClick={onClick}
          title={name}
          aria-current={active ? "page" : undefined}
        >
          <span className="excal-thumb">
            {item.thumbnail ? (
              <img src={item.thumbnail} alt="" />
            ) : (
              <ImageIcon />
            )}
          </span>
          <span className="excal-row-meta">
            <span className="excal-row-name">{name}</span>
            <span className="excal-row-time">
              {item.starred && <StarFilledIcon />}
              {relTime(item.updatedAt)}
            </span>
          </span>
        </button>
      )}
      <button
        ref={triggerRef}
        className="excal-btn excal-btn--icon excal-btn--ghost excal-row-more"
        title={`「${name}」的更多操作`}
        aria-haspopup="menu"
        aria-expanded={!!menuPosition}
        onClick={() => {
          if (menuPosition) {
            closeMenu();
            return;
          }
          const rect = triggerRef.current!.getBoundingClientRect();
          setMenuPosition({
            left: Math.min(rect.left, window.innerWidth - 178),
            top: Math.min(rect.bottom + 4, window.innerHeight - 145),
          });
        }}
      >
        <MoreIcon />
      </button>
      {menuPosition && (
        <div
          ref={menuRef}
          className="excal-row-menu"
          role="menu"
          aria-label={`${name}的操作`}
          style={menuPosition}
          onBlur={(e) => {
            if (
              e.relatedTarget &&
              !e.currentTarget.contains(e.relatedTarget as Node)
            ) {
              setMenuPosition(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeMenu();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const buttons = Array.from(
                e.currentTarget.querySelectorAll("button"),
              );
              const current = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                  ? buttons.length - 1
                  : (current +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              setDraft(name);
              cancelling.current = false;
              setEditing(true);
            }}
          >
            <PencilIcon />
            重命名
          </button>
          <button
            role="menuitem"
            onClick={() => {
              closeMenu();
              void toggleStarred(item.id).then(onRenamed).catch(onError);
            }}
          >
            {item.starred ? <StarFilledIcon /> : <StarIcon />}
            {item.starred ? "取消收藏" : "收藏图稿"}
          </button>
          <button
            role="menuitem"
            className="excal-danger-action"
            onClick={() => {
              void remove();
            }}
          >
            <TrashIcon />
            删除图稿
          </button>
        </div>
      )}
    </div>
  );
}
