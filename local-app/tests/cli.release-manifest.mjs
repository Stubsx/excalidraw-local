import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUpdateManifest,
  mergeUpdateManifests,
} from "../scripts/update-manifest.mjs";

const input = {
  version: "0.2.7",
  signature: "test-signature",
  preview: true,
  notes: "更新说明",
};
test("release manifests point at the correct version and CPU architecture", () => {
  const arm = createUpdateManifest({ ...input, arch: "arm64" });
  const intel = createUpdateManifest({ ...input, arch: "x64", preview: false });
  assert.match(
    arm.platforms["darwin-aarch64"].url,
    /v0.2.7-preview\/.*arm64.app.tar.gz$/,
  );
  assert.match(
    intel.platforms["darwin-x86_64"].url,
    /v0.2.7\/.*x64.app.tar.gz$/,
  );
  assert.equal(arm.platforms["darwin-aarch64"].signature, input.signature);
  assert.throws(() =>
    createUpdateManifest({ ...input, arch: "arm64", signature: "" }),
  );
  assert.throws(() => createUpdateManifest({ ...input, arch: "unsupported" }));
});
test("combines both architectures and rejects mismatched or duplicate releases", () => {
  const arm = createUpdateManifest({ ...input, arch: "arm64" });
  const intel = createUpdateManifest({ ...input, arch: "x64" });
  assert.deepEqual(
    Object.keys(mergeUpdateManifests([arm, intel]).platforms).sort(),
    ["darwin-aarch64", "darwin-x86_64"],
  );
  assert.throws(() =>
    mergeUpdateManifests([arm, { ...intel, version: "0.2.8" }]),
  );
  assert.throws(() => mergeUpdateManifests([arm, arm]));
});
