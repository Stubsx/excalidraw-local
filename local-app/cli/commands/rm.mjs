import { findScene } from "../lib/scene.mjs";
import { openDb, dbExists } from "../lib/db.mjs";
import {
  successEnvelope,
  errorEnvelope,
  emit,
  fail,
} from "../lib/envelope.mjs";
import { notifyLibraryChanged } from "../lib/ipc.mjs";

const USAGE = `\
Usage: excal local rm <id|name> [--purge]

Remove a scene from the library.

Arguments:
  <id|name>     Scene id (exact) or name (substring match).

Options:
  --purge       Permanently delete the row (default: soft-delete; the row is
                marked is_deleted=1 and can be recovered from the db).

Does NOT require the app to be running (writes SQLite directly).
`;

export async function runRm(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  const positional = [];
  let purge = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--purge") purge = true;
    else if (!a.startsWith("-")) positional.push(a);
    else fail(`unknown option: ${a}`);
  }

  if (positional.length === 0) {
    process.stdout.write(USAGE);
    fail("missing scene id or name");
  }

  if (!dbExists()) {
    fail(
      "library.db not found; run the app once to initialize it",
      errorEnvelope({ command: "rm", message: "no db", code: "ENODB" }),
    );
  }

  const db = openDb();
  try {
    const query = positional[0];
    const row = findScene(db, query, purge);
    if (!row) {
      fail(
        `no scene matches "${query}"`,
        errorEnvelope({
          command: "rm",
          message: `not found: ${query}`,
          code: "ENOTFOUND",
        }),
      );
    }

    const now = Date.now();
    let action;
    if (purge) {
      db.prepare("DELETE FROM scenes WHERE id = ?").run(row.id);
      action = `purged "${row.name}"`;
    } else {
      db.prepare(
        "UPDATE scenes SET is_deleted = 1, deleted_at = ? WHERE id = ?",
      ).run(now, row.id);
      action = `soft-deleted "${row.name}" (use --purge to remove permanently)`;
    }

    emit(
      successEnvelope({
        command: "rm",
        message: action,
        data: { sceneId: row.id, name: row.name, purged: purge },
      }),
    );
  } finally {
    db.close();
  }

  // Tell the running app to refresh its sidebar (no-op if app isn't running).
  await notifyLibraryChanged();
}
