import { afterEach, expect, it } from "vitest";

import { getWorkspaceShortcut } from "../src/shortcuts";

afterEach(() => document.body.replaceChildren());
it("keeps open/new/search shortcuts available with an inline color control", () => {
  const control = document.createElement("div");
  control.setAttribute("role", "dialog");
  control.className = "color-picker-container";
  document.body.append(control);
  expect(
    getWorkspaceShortcut(
      new KeyboardEvent("keydown", { key: "o", metaKey: true }),
    ),
  ).toBe("open");
  expect(
    getWorkspaceShortcut(
      new KeyboardEvent("keydown", { key: "n", metaKey: true }),
    ),
  ).toBe("new");
  expect(
    getWorkspaceShortcut(
      new KeyboardEvent("keydown", { key: "F", metaKey: true, shiftKey: true }),
    ),
  ).toBe("search");
});
it("leaves real dialogs, composition and ordinary drawing keys alone", () => {
  expect(
    getWorkspaceShortcut(new KeyboardEvent("keydown", { key: "o" })),
  ).toBeNull();
  expect(
    getWorkspaceShortcut(
      new KeyboardEvent("keydown", {
        key: "n",
        metaKey: true,
        isComposing: true,
      }),
    ),
  ).toBeNull();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  expect(
    getWorkspaceShortcut(
      new KeyboardEvent("keydown", { key: "o", metaKey: true }),
    ),
  ).toBeNull();
});
