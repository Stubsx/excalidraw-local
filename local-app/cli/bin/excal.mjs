#!/usr/bin/env node
/**
 * excal — CLI for Excalidraw Local.
 *
 * Lets AI agents (and scripts) render scenes, manage the local library, etc.
 * Invoked as:  node cli/bin/excal.mjs <domain> <command> [args]
 *              excal local render scene.excalidraw -o out.png
 *
 * The first positional is a domain (currently only "local"); the second is the
 * command. This leaves room for future domains (e.g. "excal cloud ...").
 */

import { runRender } from "../commands/render.mjs";
import { runLs } from "../commands/ls.mjs";
import { runGet } from "../commands/get.mjs";
import { runImport } from "../commands/importCmd.mjs";
import { runPut } from "../commands/put.mjs";
import { runMv } from "../commands/mv.mjs";
import { runRm } from "../commands/rm.mjs";
import { runGen } from "../commands/gen.mjs";
import { emit, successEnvelope } from "../lib/envelope.mjs";

const HELP = `\
excal — CLI for Excalidraw Local

Usage:
  excal <domain> <command> [options]
  excal local <command> [options]

Domains:
  local     Commands operating on the local app + library.

Commands (local):

  Library management (do NOT need the app running — read/write SQLite):
    ls          List scenes in the library.
    get         Export a scene to a .excalidraw file.
    import      Import a .excalidraw file into the library (new row).
    put         Overwrite a scene's content from a .excalidraw file.
    mv          Rename a scene or toggle starred.
    rm          Remove a scene (soft-delete by default, --purge to erase).
    gen         Generate a scene from a declarative spec (mindmap/tree).

  Rendering (NEEDS the app running — renders in its webview):
    render      Render a .excalidraw file or scene to PNG.

  help          Show this help.

Examples:
  excal local ls --format table
  excal local import ~/diagram.excalidraw --name "架构图" --starred
  excal local gen --json '{"title":"x","root":{"label":"核心"},"branches":[...]}' -o m.excalidraw
  excal local gen --spec-file spec.json --template tree --import --name "架构树"
  excal local get "架构图" -o out.excalidraw
  excal local put "架构图" --file edited.excalidraw      # write content back
  excal local mv "架构图" --name "新架构图"
  excal local rm old-draft
  excal local render out.excalidraw -o out.png      # app must be running

Every command prints a JSON status envelope as the last line of stdout.
`;

async function main() {
  const argv = process.argv.slice(2);

  const domain = argv[0];
  const command = argv[1];
  const rest = argv.slice(2);

  if (!domain || domain === "help" || domain === "-h" || domain === "--help") {
    process.stdout.write(HELP);
    return;
  }

  if (domain !== "local") {
    process.stderr.write(`unknown domain: ${domain}\n`);
    process.stderr.write(HELP);
    process.exit(2);
  }

  if (!command || command === "help" || command === "-h" || command === "--help") {
    process.stdout.write(HELP);
    emit(
      successEnvelope({
        command: "help",
        message: "excal local commands",
        data: {
          commands: ["ls", "get", "import", "put", "mv", "rm", "gen", "render", "help"],
          needsApp: ["render"],
          standalone: ["ls", "get", "import", "put", "mv", "rm", "gen"],
          templates: ["mindmap", "tree"],
        },
      }),
    );
    return;
  }

  switch (command) {
    case "render":
      await runRender(rest);
      break;
    case "ls":
      await runLs(rest);
      break;
    case "get":
      await runGet(rest);
      break;
    case "import":
      await runImport(rest);
      break;
    case "put":
      await runPut(rest);
      break;
    case "mv":
      await runMv(rest);
      break;
    case "rm":
      await runRm(rest);
      break;
    case "gen":
      await runGen(rest);
      break;
    default:
      process.stderr.write(`unknown command: excal local ${command}\n`);
      process.stderr.write(HELP);
      process.exit(2);
  }
}

main().catch((e) => {
  process.stderr.write(`excal: unexpected error: ${e?.stack ?? e}\n`);
  process.exit(1);
});
