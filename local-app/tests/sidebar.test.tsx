import { createRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Sidebar } from "../src/components/Sidebar";

const store = vi.hoisted(() => ({
  queryScenes: vi.fn(),
  renameScene: vi.fn(),
  toggleStarred: vi.fn(),
  deleteScene: vi.fn(),
  getFolderHistory: vi.fn(),
  addFolderToHistory: vi.fn(),
  removeFolderFromHistory: vi.fn(),
}));
vi.mock("../src/db/sceneStore", () => store);
vi.mock("../src/folderStore", () => ({
  listExcalidrawFiles: vi.fn(),
  pathExists: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../src/icons", () =>
  Object.fromEntries(
    [
      "PlusIcon",
      "ImageIcon",
      "TrashIcon",
      "file",
      "LibraryIcon",
      "FolderIcon",
      "StarIcon",
      "StarFilledIcon",
      "SettingsIcon",
      "CloseIcon",
      "PencilIcon",
      "MoreIcon",
      "WorkspaceIcon",
      "searchIcon",
    ].map((name) => [name, () => null]),
  ),
);

beforeEach(() => {
  vi.clearAllMocks();
  store.queryScenes.mockResolvedValue([
    { id: "test", name: "原名称", starred: false, updatedAt: Date.now() },
  ]);
  store.getFolderHistory.mockResolvedValue([]);
  store.renameScene.mockResolvedValue(undefined);
});
afterEach(cleanup);
function setup() {
  const beforeMutation = vi.fn().mockResolvedValue(undefined);
  const onSceneRenamed = vi.fn();
  render(
    <Sidebar
      onOpenScene={vi.fn()}
      onOpenFile={vi.fn()}
      onNew={vi.fn()}
      onPickFile={vi.fn()}
      searchRef={createRef()}
      onOpenSettings={vi.fn()}
      activeTabId={null}
      refreshKey={0}
      onSceneRenamed={onSceneRenamed}
      beforeMutation={beforeMutation}
      onSceneDeleted={vi.fn()}
    />,
  );
  return { beforeMutation, onSceneRenamed };
}

it("keeps the menu usable when WebKit reports a null related focus target", async () => {
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "「原名称」的更多操作" }),
  );
  const rename = screen.getByRole("menuitem", { name: "重命名" });
  fireEvent.blur(rename, { relatedTarget: null });
  fireEvent.click(rename);
  expect(screen.getByRole("textbox", { name: "图稿名称" })).toBeTruthy();
});

it("does not submit an IME confirmation as rename, then flushes before committing once", async () => {
  const { beforeMutation, onSceneRenamed } = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "「原名称」的更多操作" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
  const input = screen.getByRole("textbox", { name: "图稿名称" });
  fireEvent.change(input, { target: { value: "中文新名称" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(store.renameScene).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "图稿名称" })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter", isComposing: false });
  await waitFor(() =>
    expect(onSceneRenamed).toHaveBeenCalledWith("test", "中文新名称"),
  );
  expect(beforeMutation).toHaveBeenCalledTimes(1);
  expect(store.renameScene).toHaveBeenCalledExactlyOnceWith(
    "test",
    "中文新名称",
  );
  expect(beforeMutation.mock.invocationCallOrder[0]).toBeLessThan(
    store.renameScene.mock.invocationCallOrder[0],
  );
});
