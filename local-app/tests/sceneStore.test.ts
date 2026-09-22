import { createRequire } from "node:module";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import migration from "../src-tauri/migrations/001_create_scenes.sql?raw";

import {
  deleteScene,
  getScene,
  queryScenes,
  saveEditorState,
  setThumbnail,
  upsertScene,
} from "../src/db/sceneStore";

import type { SavedScene } from "../src/db/types";

// Load the native SQLite API outside Vite's browser dependency bundler.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: mock.load } }));
let database: InstanceType<typeof DatabaseSync>;
function statement(sql: string, values: (string | number | null)[] = []) {
  const numbered = /\$\d+/.test(sql);
  const bindings: (string | number | null)[] = [];
  const normalized = sql.replace(/\$(\d+)/g, (_, index) => {
    bindings.push(values[Number(index) - 1]);
    return "?";
  });
  return {
    prepared: database.prepare(normalized),
    bindings: numbered ? bindings : values,
  };
}
mock.load.mockResolvedValue({
  async select(sql: string, values?: (string | number | null)[]) {
    const { prepared, bindings } = statement(sql, values);
    return prepared.all(...bindings);
  },
  async execute(sql: string, values?: (string | number | null)[]) {
    const { prepared, bindings } = statement(sql, values);
    return { rowsAffected: Number(prepared.run(...bindings).changes) };
  },
});
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(migration);
});
afterEach(() => database.close());
const scene = (id: string, updatedAt = 1, starred = false): SavedScene => ({
  id,
  name: id,
  elements: [],
  appState: {},
  files: {},
  thumbnail: "old-preview",
  createdAt: 1,
  updatedAt,
  starred,
});

it("orders all results by edit time regardless of favourites, with stable ties and filters", async () => {
  await upsertScene(scene("old", 1, true));
  await upsertScene(scene("new-b", 3));
  await upsertScene(scene("new-a", 3));
  expect((await queryScenes()).map((s) => s.id)).toEqual([
    "new-a",
    "new-b",
    "old",
  ]);
  expect((await queryScenes({ order: "oldest" })).map((s) => s.id)).toEqual([
    "old",
    "new-a",
    "new-b",
  ]);
  expect(
    (await queryScenes({ order: "oldest", search: "new" })).map((s) => s.id),
  ).toEqual(["new-a", "new-b"]);
  expect((await queryScenes({ starredOnly: true })).map((s) => s.id)).toEqual([
    "old",
  ]);
});

it("invalidates previews on edits and rejects stale background renders without changing edit times", async () => {
  const original = scene("diagram", 1, true);
  await upsertScene(original);
  const changed = { ...original, appState: { viewBackgroundColor: "#ffffff" } };
  await saveEditorState(
    original.id,
    changed.elements,
    changed.appState,
    changed.files,
    original,
  );
  const saved = (await getScene(original.id))!;
  expect(saved.thumbnail).toBeUndefined();
  expect(await setThumbnail(original.id, "stale", original)).toBe(false);
  expect(await setThumbnail(original.id, "current", changed)).toBe(true);
  const cached = (await getScene(original.id))!;
  expect(cached.thumbnail).toBe("current");
  expect(cached.updatedAt).toBe(saved.updatedAt);
  expect(cached.starred).toBe(true);
  await deleteScene(original.id);
  expect(await setThumbnail(original.id, "deleted", changed)).toBe(false);
});
