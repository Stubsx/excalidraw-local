import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TabBar } from "../src/components/TabBar";
import { Welcome } from "../src/components/Welcome";

import type { Tab } from "../src/tabs";

vi.mock("../src/icons", () => ({
  PlusIcon: () => null,
  CloseIcon: () => null,
  ImageIcon: () => null,
  file: () => null,
  FolderIcon: () => null,
  ArrowIcon: () => null,
  SparkIcon: () => null,
}));
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const tab = (id: string): Tab => ({
  id: `library:${id}`,
  name: id,
  kind: "library",
  refId: id,
  scene: {
    id,
    name: id,
    elements: [],
    appState: {},
    files: {},
    starred: false,
    createdAt: 0,
    updatedAt: 0,
  },
  dirty: false,
  revision: 0,
});

it("shows an empty workspace without creating a scene and connects all welcome actions", () => {
  const onNew = vi.fn();
  const onOpenFile = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <Welcome
      onNew={onNew}
      onOpenFile={onOpenFile}
      onOpenSettings={onOpenSettings}
    />,
  );
  expect(onNew).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /新建画布/ }));
  fireEvent.click(screen.getByRole("button", { name: /打开文件/ }));
  fireEvent.click(screen.getByRole("button", { name: /让 AI/ }));
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(onOpenFile).toHaveBeenCalledTimes(1);
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

it("highlights only the current tab and keeps close separate from selecting a tab", () => {
  const select = vi.fn();
  const close = vi.fn();
  render(
    <TabBar
      tabs={[tab("一"), tab("二")]}
      activeId="library:二"
      onSelect={select}
      onClose={close}
      onNew={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
  expect(screen.getByRole("tab", { selected: true }).textContent).toBe("二");
  fireEvent.click(screen.getByRole("button", { name: "关闭「一」" }));
  expect(close).toHaveBeenCalledWith("library:一");
  expect(select).not.toHaveBeenCalled();
});

it("supports keyboard tab navigation and delegates closing to the save-aware host", () => {
  const select = vi.fn();
  const close = vi.fn();
  render(
    <TabBar
      tabs={[tab("一"), tab("二")]}
      activeId="library:一"
      onSelect={select}
      onClose={close}
      onNew={vi.fn()}
    />,
  );
  const first = screen.getAllByRole("tab")[0];
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  expect(select).toHaveBeenLastCalledWith("library:二");
  expect(document.activeElement).toBe(screen.getAllByRole("tab")[1]);
  fireEvent.keyDown(first, { key: "Delete" });
  expect(close).toHaveBeenCalledWith("library:一");
});
