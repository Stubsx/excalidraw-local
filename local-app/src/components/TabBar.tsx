import { useEffect, useRef } from "react";

import { PlusIcon, CloseIcon, file as FileIcon, ImageIcon } from "../icons";

import type { Tab } from "../tabs";

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="excal-tabbar">
      {tabs.length ? (
        <div
          className="excal-tabs"
          ref={list}
          role="tablist"
          aria-label="已打开的图稿"
        >
          {tabs.map((tab, index) => {
            const active = tab.id === activeId;
            const name = tab.name || "未命名";
            return (
              <div
                key={tab.id}
                className={`excal-tab${active ? " excal-tab--active" : ""}`}
                role="presentation"
              >
                <button
                  className="excal-tab-select"
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-controls="editor-panel"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  title={`${name} · ${
                    tab.kind === "file" ? "磁盘文件" : "资料库"
                  }${tab.dirty ? " · 尚未保存" : ""}`}
                  onClick={() => onSelect(tab.id)}
                  onKeyDown={(event) => {
                    let next = index;
                    if (event.key === "ArrowRight") {
                      next = (index + 1) % tabs.length;
                    } else if (event.key === "ArrowLeft") {
                      next = (index + tabs.length - 1) % tabs.length;
                    } else if (event.key === "Home") {
                      next = 0;
                    } else if (event.key === "End") {
                      next = tabs.length - 1;
                    } else if (event.key === "Delete") {
                      event.preventDefault();
                      onClose(tab.id);
                      return;
                    } else {
                      return;
                    }
                    event.preventDefault();
                    list.current
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      [next]?.focus();
                    onSelect(tabs[next].id);
                  }}
                >
                  {tab.kind === "file" ? <FileIcon /> : <ImageIcon />}
                  <span>{name}</span>
                  {tab.dirty && (
                    <span className="excal-dirty-dot" aria-label="尚未保存" />
                  )}
                </button>
                <button
                  className="excal-btn excal-btn--icon excal-btn--ghost excal-tab-close"
                  title={`关闭「${name}」`}
                  onClick={() => onClose(tab.id)}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="excal-workspace-label">
          工作台 <span>/</span> 欢迎
        </span>
      )}
      <button
        className="excal-btn excal-btn--icon excal-btn--ghost"
        title="新建画布（⌘ N）"
        onClick={onNew}
      >
        <PlusIcon />
      </button>
      <div className="excal-titlebar-space" aria-hidden="true" />
    </div>
  );
}
