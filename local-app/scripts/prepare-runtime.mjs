import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  rmSync,
  chmodSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "runtime-manifest.json")));
const arch = process.argv[2] || process.arch;
if (process.platform !== "darwin" || !manifest.sha256[arch])
  throw new Error("Supported runtime targets: darwin arm64 / x64");
const out = join(root, "runtime");
const stamp = `${manifest.version}-${arch}`;
if (
  existsSync(join(out, "node")) &&
  existsSync(join(out, "version")) &&
  readFileSync(join(out, "version"), "utf8").trim() === stamp
) {
  console.log(`Bundled runtime ready: ${stamp}`);
} else {
  const temp = mkdtempSync(join(tmpdir(), "excal-runtime-"));
  try {
    const archive = `node-${manifest.version}-darwin-${arch}.tar.gz`;
    const path = join(temp, archive);
    execFileSync(
      "/usr/bin/curl",
      [
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--tlsv1.2",
        "--retry",
        "2",
        "--connect-timeout",
        "20",
        "--max-time",
        "300",
        "-o",
        path,
        `https://nodejs.org/dist/${manifest.version}/${archive}`,
      ],
      { stdio: "inherit" },
    );
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (hash !== manifest.sha256[arch])
      throw new Error("Node archive SHA-256 mismatch");
    execFileSync("/usr/bin/tar", ["-xzf", path, "-C", temp]);
    const unpacked = join(temp, `node-${manifest.version}-darwin-${arch}`);
    mkdirSync(out, { recursive: true });
    copyFileSync(join(unpacked, "bin/node"), join(out, "node"));
    chmodSync(join(out, "node"), 0o755);
    copyFileSync(join(unpacked, "LICENSE"), join(out, "NODE-LICENSE"));
    writeFileSync(join(out, "version"), stamp + "\n");
    console.log(`Prepared verified Node ${stamp}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
