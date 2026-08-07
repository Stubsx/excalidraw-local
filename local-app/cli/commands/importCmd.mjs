import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

import { openDb, dbExists, uuid } from "../lib/db.mjs";
import { successEnvelope, errorEnvelope, emit, fail } from "../lib/envelope.mjs";
import { notifyLibraryChanged } from "../lib/ipc.mjs";

const USAGE = `\
Usage: excal local import <file.excalidraw> [--name <n>] [--starred]

Import a .excalidraw file into the local library as a new scene.

Arguments:
  <file.excalidraw>   Path to the file to import.

Options:
  --name <n>     Name for the imported scene (default: file basename).
  --starred      Mark the imported scene as starred.

Does NOT require the app to be running (writes SQLite directly).
`;

export async function runImport(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  const positional = [];
  let name = null;
  let starred = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") name = argv[++i];
    else if (a === "--starred") starred = true;
    else if (!a.startsWith("-")) positional.push(a);
    else fail(`unknown option: ${a}`);
  }

  if (positional.length === 0) {
    process.stdout.write(USAGE);
    fail("missing input file");
  }

  const file = resolve(positional[0]);
  if (!existsSync(file)) fail(`file not found: ${file}`);

  if (!dbExists()) {
    fail(
      "library.db not found; run the app once to initialize it",
      errorEnvelope({ command: "import", message: "no db", code: "ENODB" }),
    );
  }

  // Parse & validate the .excalidraw file.
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(`invalid JSON in ${file}: ${e.message}`);
  }
  // Accept both the full envelope and a bare elements array.
  const elements = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.elements)
      ? parsed.elements
      : null;
  if (!elements) {
    fail(
      `not a valid .excalidraw file (no elements array): ${file}`,
      errorEnvelope({
        command: "import",
        message: "invalid excalidraw format",
        code: "EFORMAT",
      }),
    );
  }
  const appState = parsed.appState ?? {};
  const files = parsed.files ?? {};
  const sceneName = name ?? basename(file, ".excalidraw");
  const now = Date.now();
  const id = uuid();

  const db = openDb();
  try {
    db.prepare(
      `INSERT INTO scenes
         (id, name, elements_json, app_state_json, files_json, starred, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      sceneName,
      JSON.stringify(elements),
      JSON.stringify(appState),
      JSON.stringify(files),
      starred ? 1 : 0,
      now,
      now,
    );

    emit(
      successEnvelope({
        command: "import",
        message: `imported "${sceneName}" (${elements.length} elements)`,
        data: {
          sceneId: id,
          name: sceneName,
          elements: elements.length,
          source: file,
          starred,
        },
      }),
    );
  } finally {
    db.close();
  }

  // Tell the running app to refresh its sidebar (no-op if app isn't running).
  await notifyLibraryChanged();
}
