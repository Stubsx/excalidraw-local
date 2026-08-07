import { readFileSync, existsSync } from "node:fs";
import { basename, extname, resolve, join } from "node:path";

import { getPort, configDir, ping, requestRender, requestId } from "../lib/ipc.mjs";
import { successEnvelope, errorEnvelope, emit, fail } from "../lib/envelope.mjs";

const USAGE = `\
Usage: excal local render <scene.excalidraw> [options]
       excal local render --scene-id <uuid> [options]

Render an Excalidraw scene to PNG via the running app's webview.

Arguments:
  <scene.excalidraw>      Path to a .excalidraw file to render.

Options:
  --scene-id <uuid>       Render a scene from the local library by id.
  -o, --output <path>     Write PNG here (default: <input>.png next to source).
  --format <png|svg>      Output format (default: png; svg not yet supported).
  --scale <n>             Export scale, e.g. 2 for retina (default: 1).

Requires the Excalidraw Local app to be running (the render happens in its
webview). If the app is not running, this command fails with a clear message.

The last line of stdout is a JSON status envelope.
`;

export async function runRender(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }

  // --- parse args ---
  const positional = [];
  let sceneId = null;
  let output = null;
  let format = "png";
  let scale = 1;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene-id") {
      sceneId = argv[++i];
    } else if (a === "-o" || a === "--output") {
      output = argv[++i];
    } else if (a === "--format") {
      format = argv[++i];
    } else if (a === "--scale") {
      scale = Number.parseFloat(argv[++i]);
    } else if (!a.startsWith("-")) {
      positional.push(a);
    } else {
      fail(`unknown option: ${a}`);
    }
  }

  if (format !== "png") {
    fail(`unsupported format "${format}" (only "png" is supported in v0.1)`);
  }

  // --- resolve the scene source ---
  let data = null;
  let sourceLabel = "";
  if (sceneId) {
    sourceLabel = `scene:${sceneId}`;
  } else if (positional.length > 0) {
    const file = resolve(positional[0]);
    if (!existsSync(file)) {
      fail(`file not found: ${file}`);
    }
    data = readFileSync(file, "utf8");
    sourceLabel = file;
    // default output path = <name>.png beside the source
    if (!output) {
      output = join(
        // strip extension and add .png
        file.slice(0, file.length - extname(file).length) + ".png",
      );
    }
  } else {
    process.stdout.write(USAGE);
    fail("missing input: provide a <scene.excalidraw> path or --scene-id");
  }

  // --- discover the running app ---
  const port = getPort();
  if (!port) {
    fail(
      `Excalidraw Local app is not running (no ipc.port in ${configDir()}).\n` +
        `Start it first:  cd local-app && cargo tauri dev`,
      errorEnvelope({
        command: "render",
        message: "app not running",
        code: "EAPPNOTRUNNING",
      }),
    );
  }

  const alive = await ping(port);
  if (!alive) {
    fail(
      `app port file exists (${port}) but the server isn't responding.\n` +
        `The app may still be starting up — retry in a moment.`,
      errorEnvelope({
        command: "render",
        message: "app not responding",
        code: "EAPPNOTRESPONDING",
      }),
    );
  }

  // --- request the render ---
  const started = Date.now();
  // For the `data` path (rendering an arbitrary file), pass the file basename
  // (sans extension) as the library name so the webview can auto-import it
  // into the library, deduped by name.
  const renderName =
    !sceneId && positional.length > 0
      ? basename(positional[0], extname(positional[0]))
      : undefined;
  let resp;
  try {
    resp = await requestRender(port, {
      requestId: requestId(),
      sceneId: sceneId ?? undefined,
      data: data ?? undefined,
      name: renderName,
      format,
      scale,
    });
  } catch (e) {
    fail(
      `render request failed: ${e.message}`,
      errorEnvelope({
        command: "render",
        message: e.message,
        code: "EREQUEST",
      }),
    );
  }

  if (resp.status !== "success" || !resp.output) {
    fail(
      `render failed: ${resp.error ?? "unknown"}`,
      errorEnvelope({
        command: "render",
        message: resp.error ?? "unknown render failure",
        code: "ERENDER",
      }),
    );
  }

  // The Rust side wrote the PNG to a temp path; copy it to the requested output.
  const tmpPath = resp.output;
  if (output && tmpPath !== output) {
    const png = readFileSync(tmpPath);
    // ensure parent dir exists implicitly by writeFileSync only if it does;
    // we don't auto-mkdir to keep behaviour predictable.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, png);
  }

  const elapsedMs = Date.now() - started;
  const finalPath = output ?? tmpPath;

  emit(
    successEnvelope({
      command: "render",
      message: `rendered ${sourceLabel} -> ${format}`,
      data: {
        output: finalPath,
        format,
        width: resp.meta?.width ?? 0,
        height: resp.meta?.height ?? 0,
        mimeType: resp.meta?.mimeType ?? "image/png",
        elapsedMs,
      },
    }),
  );
}
