import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(join(tmpdir(), "excal-cli-test-"));
const entry = resolve("cli/bin/excal.mjs");
const env = { ...process.env, EXCALIDRAW_DATA_DIR: dir };
const run = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, [entry, "local", ...args], {
      env,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1),
  );
const bad = (...args) =>
  spawnSync(process.execPath, [entry, "local", ...args], {
    env,
    encoding: "utf8",
  });
const scene = join(dir, "scene.excalidraw");
let id;
before(() => {
  const db = new DatabaseSync(join(dir, "library.db"));
  db.exec(readFileSync("src-tauri/migrations/001_create_scenes.sql", "utf8"));
  db.close();
  writeFileSync(
    scene,
    JSON.stringify({
      type: "excalidraw",
      elements: [],
      appState: {},
      files: {},
    }),
  );
});
after(() => rmSync(dir, { recursive: true, force: true }));
test("import, rename, export, update and soft delete round trip", () => {
  id = run("import", scene, "--name", "Test").data.sceneId;
  assert.equal(run("mv", id, "--name", "Renamed").data.name, "Renamed");
  const output = join(dir, "out.excalidraw");
  run("get", id, "-o", output);
  assert.deepEqual(JSON.parse(readFileSync(output)).elements, []);
  writeFileSync(
    scene,
    JSON.stringify({
      type: "excalidraw",
      elements: [
        {
          id: "rectangle",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ],
      appState: {},
      files: {},
    }),
  );
  assert.equal(run("put", id, "--file", scene).data.elements, 1);
  run("rm", id);
  assert.notEqual(bad("get", id).status, 0);
});
test("ambiguous writes do not change either matching scene", () => {
  const a = run("import", scene, "--name", "Duplicate").data.sceneId,
    b = run("import", scene, "--name", "Duplicate").data.sceneId;
  assert.notEqual(bad("rm", "Duplicate").status, 0);
  assert.notEqual(bad("mv", "Duplicate", "--name", "Wrong").status, 0);
  assert.notEqual(bad("put", "Duplicate", "--file", scene).status, 0);
  const db = new DatabaseSync(join(dir, "library.db"), { readOnly: true });
  assert.equal(
    db
      .prepare(
        "SELECT count(*) as n FROM scenes WHERE id IN (?,?) AND is_deleted=0 AND name=?",
      )
      .get(a, b, "Duplicate").n,
    2,
  );
  db.close();
});
test("invalid scenes and missing argument values fail without database writes", () => {
  const invalid = join(dir, "null.excalidraw");
  writeFileSync(invalid, "null");
  assert.notEqual(bad("import", invalid).status, 0);
  assert.notEqual(bad("mv", "Duplicate", "--name").status, 0);
  assert.notEqual(bad("render", scene, "--scale", "NaN").status, 0);
  assert.notEqual(bad("mv", "Duplicate", "--star", "--unstar").status, 0);
});
