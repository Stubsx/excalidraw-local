import { tabBarStyle } from "../styles";
import { PlusIcon, CloseIcon } from "../icons";

import type { Tab } from "../tabs";

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

/**
 * Top tab bar: one tab per open scene. Active tab is highlighted with the
 * brand primary surface (mirrors sidebar-tab-trigger[data-state=active]);
 * dirty tabs show a dot. A + button creates a new tab.
 */
export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: TabBarProps) {
  return (
    <div className="excal-tabbar" style={tabBarStyle.container}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`excal-tab${active ? " excal-tab--active" : ""}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.dirty && <span style={tabBarStyle.dirtyDot} />}
            <span style={tabBarStyle.tabName}>{tab.name || "未命名"}</span>
            <button
              className="excal-btn excal-btn--icon excal-btn--ghost"
              title="关闭"
              style={{
                width: "18px",
                height: "18px",
                // shrink the icon inside the smaller close affordance
                ["--default-icon-size" as string]: "14px",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      <button
        className="excal-btn excal-btn--icon excal-btn--ghost"
        title="新建标签页"
        onClick={onNew}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
