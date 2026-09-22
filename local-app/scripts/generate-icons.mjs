import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Keep both the native layered icon and the fallback sizes in source control.
// Normal app builds use these assets without requiring Icon Composer locally.
if (process.platform !== "darwin") {
  throw new Error(
    "Icon generation requires macOS and Xcode with Icon Composer",
  );
}
const root = fileURLToPath(new URL("../", import.meta.url));
const icons = join(root, "src-tauri/icons");
const temporary = mkdtempSync(join(tmpdir(), "excal-icons-"));
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit" });

try {
  run("xcrun", [
    "actool",
    join(root, "assets/Excalidraw.icon"),
    "--compile",
    temporary,
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "12.0",
    "--app-icon",
    "Excalidraw",
    "--output-partial-info-plist",
    join(temporary, "Info.plist"),
    "--standalone-icon-behavior",
    "all",
    "--output-format",
    "human-readable-text",
  ]);
  const iconset = join(temporary, "Excalidraw.iconset");
  run("/usr/bin/iconutil", [
    "--convert",
    "iconset",
    "--output",
    iconset,
    join(temporary, "Excalidraw.icns"),
  ]);
  run("yarn", [
    "tauri",
    "icon",
    join(iconset, "icon_512x512@2x.png"),
    "--output",
    icons,
  ]);
  // Preserve Apple's optical sizing and full ICNS rendition set on macOS.
  copyFileSync(join(temporary, "Excalidraw.icns"), join(icons, "icon.icns"));
  copyFileSync(join(temporary, "Assets.car"), join(icons, "Assets.car"));
  console.log("Generated native Icon Composer assets and fallback icons.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
