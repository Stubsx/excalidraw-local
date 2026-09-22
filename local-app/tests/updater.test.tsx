import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAppUpdater } from "../src/updater";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage = () => {};
  },
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.2.7" }));

const available = {
  currentVersion: "0.2.7",
  version: "0.2.8",
  notes: "改进更新体验",
  publishedAt: null,
  preview: true,
  installable: true,
  message: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("checks after startup and respects the saved automatic-check preference", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue({ ...available, version: null });
  const { result } = renderHook(() => useAppUpdater(async () => {}, true));
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("updater_check", {
    includePreview: true,
  });
  act(() => result.current.changePreference("automatic", false));
  await act(async () => vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem("excal-app-updates")!).automatic).toBe(
    false,
  );
});

it("does not install until verified download and scene persistence have both finished", async () => {
  let completeDownload!: () => void;
  let completeSave!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        completeSave = resolve;
      }),
  );
  mocks.invoke.mockImplementation((command) => {
    if (command === "updater_check") return Promise.resolve(available);
    if (command === "updater_download")
      return new Promise<void>((resolve) => {
        completeDownload = resolve;
      });
    return Promise.resolve();
  });
  const { result } = renderHook(() => useAppUpdater(save, false));
  await act(async () => result.current.check());
  let installation!: Promise<void>;
  act(() => {
    installation = result.current.install();
  });
  expect(result.current.phase).toBe("downloading");
  expect(save).not.toHaveBeenCalled();
  await act(async () => completeDownload());
  expect(result.current.phase).toBe("saving");
  expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
  await act(async () => {
    completeSave();
    await installation;
  });
  expect(mocks.invoke).toHaveBeenCalledWith("updater_install");
});

it("preserves the workspace and never installs when saving fails", async () => {
  mocks.invoke.mockImplementation(async (command) =>
    command === "updater_check" ? available : undefined,
  );
  const save = vi.fn().mockRejectedValue(new Error("磁盘已满"));
  const { result } = renderHook(() => useAppUpdater(save, false));
  await act(async () => result.current.check());
  await act(async () => result.current.install());
  expect(result.current.error).toContain("磁盘已满");
  expect(result.current.busy).toBe(false);
  expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
  save.mockResolvedValue(undefined);
  await act(async () => result.current.install());
  expect(mocks.invoke).toHaveBeenCalledWith("updater_install");
});

it("does not save or install an unverified download and permits retrying", async () => {
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "updater_check") return available;
    throw new Error("signature verification failed");
  });
  const save = vi.fn();
  const { result } = renderHook(() => useAppUpdater(save, false));
  await act(async () => result.current.check());
  await act(async () => result.current.install());
  expect(save).not.toHaveBeenCalled();
  expect(result.current.error).toContain("signature");
  expect(result.current.phase).toBe("available");
  expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
});

it("deduplicates checks and surfaces network failures without reporting up-to-date", async () => {
  let reject!: (error: Error) => void;
  mocks.invoke.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const { result } = renderHook(() => useAppUpdater(async () => {}, false));
  let check!: Promise<void>;
  act(() => {
    check = result.current.check();
    void result.current.check();
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error("离线"));
    await check;
  });
  expect(result.current.phase).toBe("idle");
  expect(result.current.error).toContain("离线");
  expect(result.current.checkedAt).toBeNull();
});

it("rechecks the selected release channel and disables automatic install for manual-only releases", async () => {
  mocks.invoke.mockResolvedValue({ ...available, installable: false });
  const { result } = renderHook(() => useAppUpdater(async () => {}, false));
  act(() => result.current.changePreference("preview", false));
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(mocks.invoke).toHaveBeenCalledWith("updater_check", {
    includePreview: false,
  });
  await act(async () => result.current.install());
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
