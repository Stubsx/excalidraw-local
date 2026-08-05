/**
 * Centralized inline styles for the app chrome (sidebar + tab bar).
 *
 * Colors, fonts and radii reference Excalidraw's own CSS variables (defined
 * under the `.excalidraw` wrapper — see main.tsx and chrome.css), so the chrome
 * automatically follows the editor's light/dark theme. Interactive states
 * (hover / active / selected) live in chrome.css as `.excal-btn` etc. rather
 * than here, mirroring Excalidraw's `outlineButtonStyles` mixin.
 *
 * Only layout-driven inline styles remain here.
 */

/** CSS variable references (not hex values) so theme switching works. */
export const COLORS = {
  /** island / panel background (= #fff light / #232329 dark) */
  bg: "var(--island-bg-color)",
  /** sidebar divider (= #f1f0ff / #2e2d39) */
  border: "var(--sidebar-border-color)",
  /** primary text (= #1b1b1f / #e3e3e8) */
  text: "var(--text-primary-color)",
  /** secondary text (timestamps, hints) */
  textMuted: "var(--color-gray-60)",
  /** brand accent (= #6965db / #a8a5ff) */
  accent: "var(--color-primary)",
  /** destructive / delete */
  danger: "var(--excal-danger)",
  /** star / favorite fill */
  star: "var(--excal-star)",
  /** Excalidraw UI font stack (Assistant) */
  font: "var(--ui-font)",
  /** 8px radius (panels / buttons) */
  radiusLg: "var(--border-radius-lg)",
  /** 6px radius (small controls / inputs) */
  radiusMd: "var(--border-radius-md)",
  /** 4px base unit (thumbnails, small chips) */
  radiusSm: "var(--space-factor)",
};

const FONT = { fontFamily: COLORS.font, fontSize: "13px" };

export const sidebarStyle = {
  container: {
    width: "260px",
    minWidth: "260px",
    height: "100%",
    backgroundColor: COLORS.bg,
    borderRight: `1px solid ${COLORS.border}`,
    display: "flex" as const,
    flexDirection: "column" as const,
    ...FONT,
  },
  viewSwitch: {
    display: "flex" as const,
    gap: "4px",
    padding: "8px 8px 0 8px",
  },
  folderBar: {
    padding: "6px 10px",
    borderBottom: `1px solid ${COLORS.border}`,
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "4px",
  },
  folderPath: {
    fontSize: "11px",
    color: COLORS.textMuted,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  },
  errorMsg: {
    padding: "6px 12px",
    color: COLORS.danger,
    fontSize: "12px",
  },
  header: {
    display: "flex" as const,
    gap: "6px",
    padding: "10px",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  list: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "6px",
  },
  empty: {
    padding: "24px 12px",
    color: COLORS.textMuted,
    textAlign: "center" as const,
    fontSize: "12px",
  },
  // scene/folder row uses .excal-row in chrome.css for bg/hover/active;
  // only layout stays inline here.
  item: {
    marginBottom: "2px",
  },
  thumb: {
    width: "40px",
    height: "30px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: COLORS.radiusSm,
    overflow: "hidden" as const,
    flexShrink: 0,
    backgroundColor: COLORS.bg,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  thumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain" as const,
  },
  thumbPlaceholder: {
    color: COLORS.textMuted,
    display: "flex" as const,
    alignItems: "center" as const,
  },
  itemMeta: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    color: COLORS.text,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    fontSize: "13px",
  },
  itemTime: {
    color: COLORS.textMuted,
    fontSize: "11px",
    marginTop: "2px",
  },
  itemActions: {
    display: "flex" as const,
    gap: "2px",
  },
};

export const tabBarStyle = {
  container: {
    display: "flex" as const,
    alignItems: "center" as const,
    backgroundColor: COLORS.bg,
    borderBottom: `1px solid ${COLORS.border}`,
    padding: "6px 8px",
    flexShrink: 0,
    overflowX: "auto" as const,
    ...FONT,
  },
  // tab visuals live in chrome.css (.excal-tab); only layout here.
  tabName: {
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  dirtyDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: COLORS.accent,
    flexShrink: 0,
  },
};

export const appLayoutStyle = {
  root: {
    display: "flex" as const,
    height: "100%",
    width: "100%",
  },
  main: {
    flex: 1,
    display: "flex" as const,
    flexDirection: "column" as const,
    minWidth: 0,
  },
  editorArea: {
    flex: 1,
    position: "relative" as const,
    minHeight: 0,
  },
};
