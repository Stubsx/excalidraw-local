import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { openDb, dbExists } from "../lib/db.mjs";
import {
  successEnvelope,
  errorEnvelope,
  emit,
  fail,
} from "../lib/envelope.mjs";
import { notifyLibraryChanged } from "../lib/ipc.mjs";

const USAGE = `\
Usage: excal local put <id|name> --file <scene.excalidraw> [--name <newname>]

Overwrite an existing library scene's CONTENT with a .excalidraw file.

Closes the get -> edit -> put loop: export a scene with \`get\`, modify the
JSON, then write it back with \`put\`. Preserves id / createdAt / starred /
thumbnail (only elements/appState/files are replaced, plus optional rename).

Arguments:
  <id|name>     Scene id (exact) or name (exact, then substring; picks the
                most recently updated match).

Options:
  --file <path>   .excalidraw file whose content replaces the scene (required).
  --name <new>    Also rename the scene (optional; defaults to keep old name).

Does NOT require the app to be running (writes SQLite directly). If the app is
running, it is notified so the sidebar refreshes automatically.
`;

export async function runPut(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  const positional = [];
  let file = null;
  let newName = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") file = argv[++i];
    else if (a === "--name") newName = argv[++i];
    else if (!a.startsWith("-")) positional.push(a);
    else fail(`unknown option: ${a}`);
  }

  if (positional.length === 0) {
    process.stdout.write(USAGE);
    fail("missing scene id or name");
  }
  if (!file) {
    process.stdout.write(USAGE);
    fail("missing --file <scene.excalidraw>");
  }

  const filePath = resolve(file);
  if (!existsSync(filePath)) fail(`file not found: ${filePath}`);

  if (!dbExists()) {
    fail(
      "library.db not found; run the app once to initialize it",
      errorEnvelope({ command: "put", message: "no db", code: "ENODB" }),
    );
  }

  // Parse & validate the .excalidraw file (accept envelope or bare elements).
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    fail(`invalid JSON in ${filePath}: ${e.message}`);
  }
  const elements = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.elements)
      ? parsed.elements
      : null;
  if (!elements) {
    fail(
      `not a valid .excalidraw file (no elements array): ${filePath}`,
      errorEnvelope({
        command: "put",
        message: "invalid excalidraw format",
        code: "EFORMAT",
      }),
    );
  }
  const appState = (parsed && parsed.appState) || {};
  const files = (parsed && parsed.files) || {};

  const db = openDb();
  try {
    // Locate the target scene: exact id -> exact name -> name substring.
    const query = positional[0];
    let row = db
      .prepare("SELECT * FROM scenes WHERE id = ? AND is_deleted = 0")
      .get(query);
    if (!row) {
      row = db
        .prepare(
          "SELECT * FROM scenes WHERE name = ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1",
        )
        .get(query);
    }
    if (!row) {
      row = db
        .prepare(
          "SELECT * FROM scenes WHERE name LIKE ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1",
        )
        .get(`%${query}%`);
    }
    if (!row) {
      fail(
        `no scene matches "${query}"`,
        errorEnvelope({
          command: "put",
          message: `not found: ${query}`,
          code: "ENOTFOUND",
        }),
      );
    }

    const now = Date.now();
    // Overwrite content + optional rename. id/created_at/starred/thumbnail
    // are preserved (thumbnail is regenerated next time the tab opens).
    db.prepare(
      `UPDATE scenes SET
         elements_json = ?,
         app_state_json = ?,
         files_json = ?,
         name = COALESCE(?, name),
         updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(elements),
      JSON.stringify(appState),
      JSON.stringify(files),
      newName,
      now,
      row.id,
    );

    emit(
      successEnvelope({
        command: "put",
        message: `updated "${row.name}"${newName ? ` -> "${newName}"` : ""} (${elements.length} elements)`,
        data: {
          sceneId: row.id,
          name: newName ?? row.name,
          elements: elements.length,
          source: filePath,
        },
      }),
    );
  } finally {
    db.close();
  }

  // Tell the running app to refresh its sidebar (no-op if app isn't running).
  await notifyLibraryChanged();
}
