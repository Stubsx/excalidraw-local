import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { generateMindmap } from "../generators/mindmap.mjs";
import { generateTree } from "../generators/tree.mjs";
import { openDb, dbExists, uuid } from "../lib/db.mjs";
import { successEnvelope, errorEnvelope, emit, fail } from "../lib/envelope.mjs";
import { notifyLibraryChanged } from "../lib/ipc.mjs";

const USAGE = `\
Usage:
  excal local gen --spec-file spec.json [--template <t>] [-o out.excalidraw] [--import [--name <n>]]
  excal local gen --json '<spec>'    [--template <t>] [-o out.excalidraw] [--import]

Generate an Excalidraw scene from a declarative spec, with all field hygiene
(ids, seeds, versionNonces, text width, container/text pairing, arrow binding)
handled automatically.

Input:
  --spec-file <path>   Read the spec from a JSON file.
  --json '<string>'    Inline spec JSON.
  --template <t>       mindmap | tree (default: read from spec.template, else mindmap).

Output (pick one):
  -o, --output <path>  Write the .excalidraw file here.
  --import             Insert into the library instead of writing a file.
                       Combine with --name to set the scene name.
  (no flag)            Print the .excalidraw JSON to stdout (pipe-friendly).

Does NOT require the app to be running (pure computation + SQLite write).
`;

const TEMPLATES = { mindmap: generateMindmap, tree: generateTree };

function parseSpec(argv) {
  let specFile = null;
  let jsonInline = null;
  let template = null;
  let output = null;
  let doImport = false;
  let name = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--spec-file") specFile = argv[++i];
    else if (a === "--json") jsonInline = argv[++i];
    else if (a === "--template") template = argv[++i];
    else if (a === "-o" || a === "--output") output = argv[++i];
    else if (a === "--import") doImport = true;
    else if (a === "--name") name = argv[++i];
    else if (a === "-h" || a === "--help") return { help: true };
    else fail(`unknown option: ${a}`);
  }
  return { specFile, jsonInline, template, output, doImport, name };
}

export async function runGen(argv) {
  const p = parseSpec(argv);
  if (p.help) {
    process.stdout.write(USAGE);
    return;
  }

  // Load spec text.
  let specText;
  if (p.specFile) {
    if (!existsSync(p.specFile)) fail(`spec file not found: ${p.specFile}`);
    specText = readFileSync(p.specFile, "utf8");
  } else if (p.jsonInline) {
    specText = p.jsonInline;
  } else {
    process.stdout.write(USAGE);
    fail("provide --spec-file or --json");
  }

  let spec;
  try {
    spec = JSON.parse(specText);
  } catch (e) {
    fail(`invalid spec JSON: ${e.message}`);
  }

  const tplKey = p.template ?? spec.template ?? "mindmap";
  const tpl = TEMPLATES[tplKey];
  if (!tpl) {
    fail(
      `unknown template "${tplKey}" (available: ${Object.keys(TEMPLATES).join(", ")})`,
      errorEnvelope({
        command: "gen",
        message: `unknown template: ${tplKey}`,
        code: "EBADTEMPLATE",
      }),
    );
  }

  // Generate the scene.
  let scene;
  try {
    scene = tpl(spec);
  } catch (e) {
    fail(
      `generation failed: ${e.message}`,
      errorEnvelope({ command: "gen", message: e.message, code: "EGEN" }),
    );
  }

  const elementCount = scene.elements.length;

  // Route output.
  if (p.doImport) {
    if (!dbExists()) {
      fail(
        "library.db not found; run the app once to initialize it",
        errorEnvelope({ command: "gen", message: "no db", code: "ENODB" }),
      );
    }
    const id = uuid();
    const now = Date.now();
    const sceneName = p.name ?? spec.title ?? `${tplKey}-${id.slice(0, 8)}`;
    const db = openDb();
    try {
      db.prepare(
        `INSERT INTO scenes
           (id, name, elements_json, app_state_json, files_json, starred, is_deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, '{}', 0, 0, ?, ?)`,
      ).run(
        id,
        sceneName,
        JSON.stringify(scene.elements),
        JSON.stringify(scene.appState),
        now,
        now,
      );
    } finally {
      db.close();
    }
    emit(
      successEnvelope({
        command: "gen",
        message: `generated ${tplKey} (${elementCount} elements) -> library "${sceneName}"`,
        data: { sceneId: id, name: sceneName, template: tplKey, elements: elementCount },
      }),
    );
    // Tell the running app to refresh its sidebar (no-op if app isn't running).
    await notifyLibraryChanged();
    return;
  }

  if (p.output) {
    mkdirSync(dirname(p.output) || ".", { recursive: true });
    writeFileSync(p.output, JSON.stringify(scene, null, 2), "utf8");
    emit(
      successEnvelope({
        command: "gen",
        message: `generated ${tplKey} (${elementCount} elements) -> ${p.output}`,
        data: { output: p.output, template: tplKey, elements: elementCount },
      }),
    );
  } else {
    // Print the .excalidraw JSON to stdout (no envelope — pure payload for piping).
    process.stdout.write(JSON.stringify(scene, null, 2) + "\n");
  }
}
