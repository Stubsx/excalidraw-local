import { tabBarStyle } from "../styles";
import type { Tab } from "../tabs";

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

/**
 * Top tab bar: one tab per open scene. Active tab is highlighted; dirty tabs
 * show a dot. A + button creates a new tab.
 */
export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="excal-tabbar" style={tabBarStyle.container}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className="excal-tab"
            style={{ ...tabBarStyle.tab, ...(active ? tabBarStyle.tabActive : null) }}
            onClick={() => onSelect(tab.id)}
          >
            {tab.dirty && <span style={tabBarStyle.dirtyDot} />}
            <span style={tabBarStyle.tabName}>{tab.name || "未命名"}</span>
            <button
              style={tabBarStyle.closeBtn}
              title="关闭"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button style={tabBarStyle.newTabBtn} title="新建标签页" onClick={onNew}>
        +
      </button>
    </div>
  );
}
