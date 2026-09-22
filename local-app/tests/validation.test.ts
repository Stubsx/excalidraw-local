import { expect, it } from "vitest";

import { parseScene } from "../src/sceneValidation";
it.each([
  "null",
  "{}",
  '{"elements":{}}',
  '{"elements":[null]}',
  '{"elements":[],"files":[]}',
])("rejects malformed scenes without replacing the file: %s", (input) => {
  expect(() => parseScene(input)).toThrow();
});
it("loads a legacy elements array", () => {
  expect(parseScene("[]").elements).toEqual([]);
});
