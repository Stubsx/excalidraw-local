import { openDb, dbExists } from "../lib/db.mjs";
import { successEnvelope, errorEnvelope, emit, fail } from "../lib/envelope.mjs";

const USAGE = `\
Usage:
  excal local mv <id|name> --name <newname>     Rename a scene.
  excal local mv <id|name> --star|--unstar      Toggle/ set starred.

Options:
  --name <newname>     New name for the scene.
  --star               Mark as starred.
  --unstar             Remove starred.

Exactly one of --name / --star / --unstar is required.
Does NOT require the app to be running (writes SQLite directly).
`;

export async function runMv(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  const positional = [];
  let newName = null;
  let star = null; // true | false | null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") newName = argv[++i];
    else if (a === "--star") star = true;
    else if (a === "--unstar") star = false;
    else if (!a.startsWith("-")) positional.push(a);
    else fail(`unknown option: ${a}`);
  }

  if (positional.length === 0) {
    process.stdout.write(USAGE);
    fail("missing scene id or name");
  }
  if (newName === null && star === null) {
    process.stdout.write(USAGE);
    fail("specify --name, --star, or --unstar");
  }

  if (!dbExists()) {
    fail(
      "library.db not found; run the app once to initialize it",
      errorEnvelope({ command: "mv", message: "no db", code: "ENODB" }),
    );
  }

  const db = openDb();
  try {
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
        errorEnvelope({ command: "mv", message: `not found: ${query}`, code: "ENOTFOUND" }),
      );
    }

    const now = Date.now();
    let action;
    if (newName !== null) {
      db.prepare(
        "UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?",
      ).run(newName, now, row.id);
      action = `renamed "${row.name}" -> "${newName}"`;
    } else {
      const val = star ? 1 : 0;
      db.prepare(
        "UPDATE scenes SET starred = ?, updated_at = ? WHERE id = ?",
      ).run(val, now, row.id);
      action = `${star ? "starred" : "unstarred"} "${row.name}"`;
    }

    emit(
      successEnvelope({
        command: "mv",
        message: action,
        data: { sceneId: row.id, name: newName ?? row.name, starred: star ?? row.starred === 1 },
      }),
    );
  } finally {
    db.close();
  }
}
