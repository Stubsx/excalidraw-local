/** Excalidraw's inline color controls also use role=dialog even when no popup
 * is open. They must not disable workspace shortcuts whenever a shape is selected. */
export function getWorkspaceShortcut(event: KeyboardEvent) {
  if (
    event.repeat ||
    event.isComposing ||
    !(event.metaKey || event.ctrlKey) ||
    event.altKey
  ) {
    return null;
  }
  if (document.querySelector('[role="dialog"]:not(.color-picker-container)')) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    return key === "f" ? "search" : null;
  }
  return (
    ({ n: "new", o: "open", ",": "settings" } as const)[
      key as "n" | "o" | ","
    ] ?? null
  );
}
