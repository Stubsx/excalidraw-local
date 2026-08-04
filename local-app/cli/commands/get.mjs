import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";

import { openDb, dbExists } from "../lib/db.mjs";
import { successEnvelope, errorEnvelope, emit, fail } from "../lib/envelope.mjs";

const USAGE = `\
Usage: excal local get <id|name> [-o output.excalidraw]

Export a scene from the library to a .excalidraw file.

Arguments:
  <id|name>     Scene id (exact) or name (substring match; picks the most
                recently updated match).

Options:
  -o <path>     Output file path (default: <name>.excalidraw in cwd).

Does NOT require the app to be running (reads SQLite directly).
`;

export async function runGet(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  const positional = [];
  let output = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (!a.startsWith("-")) positional.push(a);
    else fail(`unknown option: ${a}`);
  }

  if (positional.length === 0) {
    process.stdout.write(USAGE);
    fail("missing scene id or name");
  }
  const query = positional[0];

  if (!dbExists()) {
    fail(
      "library.db not found; run the app once to initialize it",
      errorEnvelope({ command: "get", message: "no db", code: "ENODB" }),
    );
  }

  const db = openDb({ readOnly: true });
  try {
    // Try exact id first, then name substring (most recent).
    let row = db
      .prepare("SELECT * FROM scenes WHERE id = ? AND is_deleted = 0")
      .get(query);
    let matchKind = "id";
    if (!row) {
      row = db
        .prepare(
          "SELECT * FROM scenes WHERE name = ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1",
        )
        .get(query);
      matchKind = "name(exact)";
    }
    if (!row) {
      row = db
        .prepare(
          "SELECT * FROM scenes WHERE name LIKE ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1",
        )
        .get(`%${query}%`);
      matchKind = "name(substring)";
    }
    if (!row) {
      fail(
        `no scene matches "${query}"`,
        errorEnvelope({
          command: "get",
          message: `not found: ${query}`,
          code: "ENOTFOUND",
        }),
      );
    }

    // Build the .excalidraw envelope (binary-compatible with excalidraw.com).
    const data = {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-local",
      elements: JSON.parse(row.elements_json || "[]"),
      appState: JSON.parse(row.app_state_json || "{}"),
      files: JSON.parse(row.files_json || "{}"),
    };

    if (!output) {
      const safeName = (row.name || "scene").replace(/[^\w\u4e00-\u9fa5.-]+/g, "_");
      output = `${safeName}.excalidraw`;
    }
    mkdirSync(dirname(output) || ".", { recursive: true });
    writeFileSync(output, JSON.stringify(data, null, 2), "utf8");

    emit(
      successEnvelope({
        command: "get",
        message: `exported "${row.name}" (${matchKind}) -> ${output}`,
        data: {
          output,
          sceneId: row.id,
          name: row.name,
          elements: JSON.parse(row.elements_json || "[]").length,
        },
      }),
    );
  } finally {
    db.close();
  }
}
