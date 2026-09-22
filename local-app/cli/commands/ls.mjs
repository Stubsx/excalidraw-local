import { openDb, dbExists } from "../lib/db.mjs";
import {
  successEnvelope,
  errorEnvelope,
  emit,
  fail,
} from "../lib/envelope.mjs";

const USAGE = `\
Usage: excal local ls [options]

List scenes in the local library.

Options:
  --format <json|table>   Output format (default: json; table prints a readable grid).
  --starred               Only starred scenes.
  --stdout-limit <n>      Max rows to print to stdout (default: 100; increase to list more).

Does NOT require the app to be running (reads SQLite directly).
`;

export async function runLs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  let format = "json";
  let starredOnly = false;
  let stdoutLimit = 100;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") format = argv[++i];
    else if (a === "--starred") starredOnly = true;
    else if (a === "--stdout-limit")
      stdoutLimit = Number.parseInt(argv[++i], 10);
    else fail(`unknown option: ${a}`);
  }

  if (
    !Number.isSafeInteger(stdoutLimit) ||
    stdoutLimit < 1 ||
    stdoutLimit > 100000
  )
    fail("--stdout-limit must be an integer from 1 to 100000");
  if (format !== "json" && format !== "table") {
    fail(`invalid --format "${format}" (use json or table)`);
  }

  if (!dbExists()) {
    emit(
      errorEnvelope({
        command: "ls",
        message: "library.db not found; run the app once to initialize it",
        code: "ENODB",
      }),
    );
    process.exit(1);
  }

  const db = openDb({ readOnly: true });
  try {
    const where = ["is_deleted = 0"];
    if (starredOnly) where.push("starred = 1");
    const whereSql = where.join(" AND ");

    const total = db
      .prepare(`SELECT count(*) as c FROM scenes WHERE ${whereSql}`)
      .get().c;

    const rows = db
      .prepare(
        `SELECT id, name, starred, created_at, updated_at,
                length(elements_json) as bytes
         FROM scenes
         WHERE ${whereSql}
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(stdoutLimit);

    const scenes = rows.map((r) => ({
      id: r.id,
      name: r.name,
      starred: r.starred === 1,
      sizeBytes: r.bytes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    if (format === "table") {
      if (scenes.length === 0) {
        process.stdout.write("(no scenes)\n");
      } else {
        const trunc = (s, n) =>
          s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
        process.stdout.write(
          `${"id".padEnd(13)} ${"name".padEnd(28)} ${"★".padEnd(
            2,
          )} ${"KB".padStart(6)}  updated\n`,
        );
        for (const s of scenes) {
          process.stdout.write(
            `${trunc(s.id, 13)} ${trunc(s.name, 28)} ${
              s.starred ? "★" : " "
            } ${(s.sizeBytes / 1024).toFixed(1).padStart(6)}  ${new Date(
              s.updatedAt,
            )
              .toISOString()
              .slice(0, 19)
              .replace("T", " ")}\n`,
          );
        }
        process.stdout.write(`\n(${scenes.length} of ${total} scenes)\n`);
      }
    }

    emit(
      successEnvelope({
        command: "ls",
        message: `${scenes.length} scene(s)${starredOnly ? " (starred)" : ""}`,
        data: {
          scenes,
          count: scenes.length,
          total,
          truncated: total > scenes.length,
        },
      }),
    );
  } finally {
    db.close();
  }
}
