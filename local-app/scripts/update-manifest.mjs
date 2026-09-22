export function createUpdateManifest({
  version,
  arch,
  preview,
  signature,
  notes,
  pubDate = new Date().toISOString(),
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid release version");
  if (!["arm64", "x64"].includes(arch))
    throw new Error("Unsupported updater architecture");
  if (!signature?.trim()) throw new Error("An updater signature is required");
  const target = arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64";
  const tag = `v${version}${preview ? "-preview" : ""}`;
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [target]: {
        signature: signature.trim(),
        url: `https://github.com/Stubsx/excalidraw-local/releases/download/${tag}/Excalidraw-Local-macOS-${arch}.app.tar.gz`,
      },
    },
  };
}

export function mergeUpdateManifests(manifests) {
  if (!manifests.length) throw new Error("No updater manifests found");
  const merged = { ...manifests[0], platforms: {} };
  for (const manifest of manifests) {
    if (manifest.version !== merged.version)
      throw new Error("Updater versions must match");
    for (const [target, value] of Object.entries(manifest.platforms)) {
      if (merged.platforms[target])
        throw new Error(`Duplicate updater target: ${target}`);
      merged.platforms[target] = value;
    }
  }
  return merged;
}
