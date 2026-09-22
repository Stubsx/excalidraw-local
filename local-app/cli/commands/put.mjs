import { parseScene } from "../lib/scene.mjs";
import { findScene } from "../lib/scene.mjs";
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
JSON, then write it back with \`put\`. Preserves id / createdAt / starred.
The library regenerates the thumbnail from the updated content.

Arguments:
  <id|name>     Scene id (exact) or name (exact, then substring; requires a unique match).

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
  const { elements, appState, files } = parseScene(
    readFileSync(filePath, "utf8"),
  );
  const db = openDb();
  try {
    // Locate the target scene: exact id -> exact name -> name substring.
    const query = positional[0];
    const row = findScene(db, query);
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
    // Preserve identity and favourites; invalidate the thumbnail so the library
    // regenerates it even if the updated scene is never opened in the editor.
    db.prepare(
      `UPDATE scenes SET
         thumbnail = NULL,
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
        message: `updated "${row.name}"${newName ? ` -> "${newName}"` : ""} (${
          elements.length
        } elements)`,
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
