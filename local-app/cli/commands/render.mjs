import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { basename, extname, resolve, join } from "node:path";

import {
  getPort,
  configDir,
  ping,
  requestRender,
  requestId,
} from "../lib/ipc.mjs";
import {
  successEnvelope,
  errorEnvelope,
  emit,
  fail,
} from "../lib/envelope.mjs";

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
  --save                 Also save to the library (overwrites a matching name).
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
  let save = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene-id") {
      sceneId = argv[++i];
    } else if (a === "-o" || a === "--output") {
      output = argv[++i];
    } else if (a === "--save") {
      save = true;
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

  if (!Number.isFinite(scale) || scale <= 0 || scale > 8)
    fail("scale must be between 0 and 8");
  if (sceneId && positional.length) fail("choose either a file or --scene-id");
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
  let port = getPort();
  if (!port || !(await ping(port))) {
    if (process.platform !== "darwin") fail("请先启动 Excalidraw Local。");
    try {
      await promisify(execFile)("/usr/bin/open", [
        "-b",
        "com.excalidraw-local.app",
      ]);
    } catch {
      fail("无法启动 Excalidraw Local，请先安装并打开 App。");
    }
    const deadline = Date.now() + 20000;
    let alive = false;
    while (Date.now() < deadline) {
      port = getPort();
      if (port && (await ping(port))) {
        alive = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!alive) fail("App 启动超时，请检查应用窗口后重试。");
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
      name: save ? renderName : undefined,
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
    unlinkSync(tmpPath);
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
