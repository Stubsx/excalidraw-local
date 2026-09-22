import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const options = process.argv.slice(2);
if (options.some((v) => v !== "--preview"))
  throw new Error("Usage: yarn release [--preview]");
if (process.platform !== "darwin")
  throw new Error("DMG releases require macOS");
const preview = options.includes("--preview");
const pkg = JSON.parse(readFileSync(join(root, "package.json")));
const config = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.conf.json")),
);
const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];
const version = pkg.version;
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  version !== config.version ||
  version !== cargo
)
  throw new Error(
    "Version mismatch: package.json / tauri.conf.json / Cargo.toml must agree",
  );
const identity = process.env.APPLE_SIGNING_IDENTITY;
const profile = process.env.APPLE_NOTARY_PROFILE;
const notaryCredentials = [
  "--keychain-profile",
  profile,
  ...(process.env.APPLE_NOTARY_KEYCHAIN
    ? ["--keychain", process.env.APPLE_NOTARY_KEYCHAIN]
    : []),
];
if (!preview && (!identity || !profile))
  throw new Error(
    "A signed release requires APPLE_SIGNING_IDENTITY and APPLE_NOTARY_PROFILE. Use --preview only for an explicitly unsigned test build.",
  );
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
const capture = (cmd, args) =>
  execFileSync(cmd, args, { cwd: repo, encoding: "utf8" }).trim();
const arch = process.arch;
if (!["arm64", "x64"].includes(arch))
  throw new Error(`Unsupported architecture: ${arch}`);
const output = join(
  root,
  "dist-release",
  version,
  preview ? "preview" : "signed",
  arch,
);
const dmgName = `Excalidraw-Local-macOS-${arch}.dmg`;
const dmg = join(output, dmgName);
if (existsSync(dmg))
  throw new Error(
    `Release artifact already exists: ${dmg}. Increase version instead of replacing an existing release.`,
  );
// Verify the selected signing identity before spending time building.
if (!preview) {
  const identities = capture("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  if (
    !identities
      .split("\n")
      .some(
        (line) =>
          line.includes(identity) && line.includes("Developer ID Application"),
      )
  )
    throw new Error(
      "The configured Developer ID Application identity is not available in this keychain",
    );
}
run("yarn", ["test:typecheck"], repo);
run("yarn", ["typecheck"]);
run("yarn", ["test"]);
run("yarn", ["test:cli"]);
run(process.execPath, ["scripts/prepare-runtime.mjs", arch]);
run("cargo", ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]);
if (!preview)
  run("/usr/bin/codesign", [
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--entitlements",
    "src-tauri/node.entitlements.plist",
    "--sign",
    identity,
    "runtime/node",
  ]);
run("yarn", ["tauri", "build", "--bundles", "app"]);
const app = join(
  root,
  "src-tauri/target/release/bundle/macos/Excalidraw Local.app",
);
if (!preview) {
  run("/usr/bin/codesign", [
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--sign",
    identity,
    app,
  ]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
}
const temporary = mkdtempSync(join(tmpdir(), "excal-release-"));
try {
  if (!preview) {
    const zip = join(temporary, "notarize.zip");
    run("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, zip]);
    run("/usr/bin/xcrun", [
      "notarytool",
      "submit",
      zip,
      ...notaryCredentials,
      "--wait",
      "--timeout",
      "30m",
    ]);
    run("/usr/bin/xcrun", ["stapler", "staple", app]);
    run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose", app]);
  }
  const stage = join(temporary, "image");
  mkdirSync(stage);
  cpSync(app, join(stage, "Excalidraw Local.app"), { recursive: true });
  run("/bin/ln", ["-s", "/Applications", join(stage, "Applications")]);
  mkdirSync(output, { recursive: true });
  const candidate = join(temporary, dmgName);
  run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    `Excalidraw Local ${version}`,
    "-srcfolder",
    stage,
    "-format",
    "UDZO",
    candidate,
  ]);
  if (!preview) {
    run("/usr/bin/codesign", ["--timestamp", "--sign", identity, candidate]);
    run("/usr/bin/xcrun", [
      "notarytool",
      "submit",
      candidate,
      ...notaryCredentials,
      "--wait",
      "--timeout",
      "30m",
    ]);
    run("/usr/bin/xcrun", ["stapler", "staple", candidate]);
    run("/usr/bin/xcrun", ["stapler", "validate", candidate]);
  }
  cpSync(candidate, dmg);
  const sha = createHash("sha256").update(readFileSync(dmg)).digest("hex");
  writeFileSync(join(output, "SHA256SUMS"), `${sha}  ${dmgName}\n`);
  writeFileSync(
    join(output, "release.json"),
    JSON.stringify(
      {
        version,
        arch,
        commit: capture("git", ["rev-parse", "HEAD"]),
        signed: !preview,
        notarized: !preview,
        sha256: sha,
        artifact: dmgName,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `\n${preview ? "UNSIGNED PREVIEW" : "SIGNED & NOTARIZED"}: ${dmg}`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
