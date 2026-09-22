/* Structural layout only; visual tokens and component styles live in chrome.css. */
export const appLayoutStyle = {
  root: {
    display: "flex" as const,
    height: "100%",
    width: "100%",
    flexDirection: "column" as const,
  },
  workspace: {
    display: "flex" as const,
    flex: 1,
    minHeight: 0,
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
