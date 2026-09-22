import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SettingsPanel } from "../src/components/SettingsPanel";
import { SkillQuickStart } from "../src/components/SkillQuickStart";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), copy: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@excalidraw/excalidraw/clipboard", () => ({
  copyTextToSystemClipboard: mocks.copy,
}));
vi.mock("../src/icons", () => ({
  CloseIcon: () => null,
  CopyIcon: () => null,
  CheckIcon: () => null,
}));

const status = (installed: boolean, runtimeReady = true) => ({
  version: "0.2.4",
  runtimeReady,
  cliInstalled: installed,
  cliPath: "/test/excal",
  targets: [
    {
      id: "agents",
      name: "通用技能目录",
      path: "/test/.agents/skills",
      detected: true,
      installed,
      existing: installed,
    },
  ],
  defaultShell: "zsh",
});
const props = {
  open: true,
  theme: "light" as const,
  onClose: vi.fn(),
  onThemeChange: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.copy.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("copies the complete visible prompt and confirms only after the write succeeds", async () => {
  vi.useFakeTimers();
  let resolveCopy!: () => void;
  mocks.copy.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveCopy = resolve;
    }),
  );
  render(<SkillQuickStart />);
  const prompt = screen.getByText(/^请使用 excalidraw-local 技能/).textContent;
  fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(prompt);
  expect(
    (screen.getByRole("button", { name: "复制中…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.queryByText("已复制")).toBeNull();
  await act(async () => resolveCopy());
  expect(screen.getByRole("button", { name: "已复制" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(2500));
  expect(screen.getByRole("button", { name: "复制提示词" })).toBeTruthy();
});

it("keeps the prompt available after a clipboard failure and allows retrying", async () => {
  mocks.copy.mockRejectedValueOnce(new Error("Clipboard denied"));
  render(<SkillQuickStart />);
  fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
  expect((await screen.findByRole("alert")).textContent).toContain("手动复制");
  expect(screen.queryByText("已复制")).toBeNull();
  expect(screen.getByText(/^请使用 excalidraw-local 技能/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
  expect(await screen.findByRole("button", { name: "已复制" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the quick start after installation and preserves installation details and backups", async () => {
  const result = {
    installed: ["agents"],
    backups: ["/test/skill-backup"],
    cliPath: "/test/excal",
    message: "安装完成，新开 AI 对话即可使用。",
  };
  mocks.invoke
    .mockResolvedValueOnce(status(false))
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce(status(true));
  render(<SettingsPanel {...props} />);
  await screen.findByText("通用技能目录");
  expect(screen.queryByRole("button", { name: "复制提示词" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "安装到 1 个位置" }));
  expect(
    await screen.findByRole("button", { name: "复制提示词" }),
  ).toBeTruthy();
  expect(mocks.invoke).toHaveBeenCalledWith("setup_install", {
    targets: ["agents"],
    shell: "none",
  });
  fireEvent.click(screen.getByText("安装详情与备份"));
  expect(screen.getByText(result.message)).toBeTruthy();
  expect(screen.getByText(result.backups[0])).toBeTruthy();
});

it("offers the prompt when reopening settings with an installed skill, without reinstalling", async () => {
  mocks.invoke.mockResolvedValue(status(true));
  const { rerender } = render(<SettingsPanel {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "复制提示词" }));
  await screen.findByRole("button", { name: "已复制" });
  rerender(<SettingsPanel {...props} open={false} />);
  rerender(<SettingsPanel {...props} />);
  expect(
    await screen.findByRole("button", { name: "复制提示词" }),
  ).toBeTruthy();
  expect(
    mocks.invoke.mock.calls.every(([command]) => command === "setup_status"),
  ).toBe(true);
});

it("does not report a usable skill when its bundled runtime is missing", async () => {
  mocks.invoke.mockResolvedValue(status(true, false));
  render(<SettingsPanel {...props} />);
  await screen.findByText("运行环境缺失，请重新下载完整 App");
  expect(screen.queryByRole("button", { name: "复制提示词" })).toBeNull();
});
