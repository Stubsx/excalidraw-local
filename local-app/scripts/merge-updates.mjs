import { readFileSync, writeFileSync } from "node:fs";
import { mergeUpdateManifests } from "./update-manifest.mjs";

const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length)
  throw new Error("Usage: merge-updates.mjs <output> <manifest> [...]");
const manifest = mergeUpdateManifests(
  inputs.map((path) => JSON.parse(readFileSync(path, "utf8"))),
);
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
