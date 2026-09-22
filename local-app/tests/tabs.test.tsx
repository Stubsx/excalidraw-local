import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useTabs } from "../src/tabs";
const store = vi.hoisted(() => ({
  getOpenTabs: vi.fn(),
  getScene: vi.fn(),
  setOpenTabs: vi.fn(),
  upsertScene: vi.fn(),
  uuid: () => "new",
}));
vi.mock("../src/db/sceneStore", () => store);
vi.mock("../src/folderStore", () => ({ readFileScene: vi.fn() }));
const scene = (id: string, name = id) => ({
  id,
  name,
  elements: [],
  appState: {},
  files: {},
  starred: false,
  createdAt: 1,
  updatedAt: 1,
});
beforeEach(() => {
  vi.clearAllMocks();
  store.getOpenTabs.mockResolvedValue({ ids: [], activeId: null });
  store.getScene.mockImplementation(async (id) => scene(id));
  store.setOpenTabs.mockResolvedValue(undefined);
  store.upsertScene.mockResolvedValue(undefined);
});
it("restores an empty session under StrictMode without creating a scene", async () => {
  const { result } = renderHook(() => useTabs(async () => {}), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(result.current.bootstrapped).toBe(true));
  expect(result.current.tabs).toEqual([]);
  expect(store.upsertScene).not.toHaveBeenCalled();
});
it("flushes, reloads current data on tab selection, and persists empty close", async () => {
  const flush = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useTabs(flush));
  await waitFor(() => expect(result.current.bootstrapped).toBe(true));
  await act(async () => {
    await result.current.openScene("a");
    await result.current.openScene("b");
  });
  store.getScene.mockImplementation(async (id) => scene(id, "edited"));
  await act(async () => {
    await result.current.setActiveId("library:a");
  });
  expect(
    result.current.tabs.find((t) => t.id === "library:a")?.scene.name,
  ).toBe("edited");
  await act(async () => {
    await result.current.closeTab("library:b");
  });
  expect(result.current.activeId).toBe("library:a");
  await act(async () => {
    await result.current.closeTab("library:a");
  });
  expect(result.current.activeId).toBeNull();
  expect(result.current.tabs).toEqual([]);
  expect(store.setOpenTabs).toHaveBeenLastCalledWith([], null);
});
it("keeps the editor open when saving fails", async () => {
  const flush = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useTabs(flush));
  await waitFor(() => expect(result.current.bootstrapped).toBe(true));
  await act(async () => {
    await result.current.openScene("a");
  });
  flush.mockRejectedValue(new Error("disk full"));
  await act(async () => {
    await result.current.closeTab("library:a");
  });
  expect(result.current.activeId).toBe("library:a");
  expect(result.current.error).toContain("disk full");
});
