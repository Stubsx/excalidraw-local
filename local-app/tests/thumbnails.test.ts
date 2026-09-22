import { beforeEach, expect, it, vi } from "vitest";

import { ensureThumbnail } from "../src/thumbnails";

const mocks = vi.hoisted(() => ({
  getScene: vi.fn(),
  setThumbnail: vi.fn(),
  exportToBlob: vi.fn(),
}));
vi.mock("../src/db/sceneStore", () => ({
  getScene: mocks.getScene,
  setThumbnail: mocks.setThumbnail,
}));
vi.mock("@excalidraw/utils/export", () => ({
  exportToBlob: mocks.exportToBlob,
}));
vi.mock("@excalidraw/element", () => ({
  getNonDeletedElements: (elements: { isDeleted?: boolean }[]) =>
    elements.filter((e) => !e.isDeleted),
}));

const scene = (id: string) => ({
  id,
  updatedAt: 1,
  elements: [{ id: "shape", type: "rectangle" }],
  appState: {},
  files: {},
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getScene.mockImplementation(async (id: string) => scene(id));
  mocks.setThumbnail.mockResolvedValue(true);
  mocks.exportToBlob.mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
});

it("generates missing imported previews and shares repeated requests", async () => {
  const first = ensureThumbnail("imported", 1);
  expect(ensureThumbnail("imported", 1)).toBe(first);
  const image = await first;
  expect(image).toMatch(/^data:image\/png;base64,/);
  expect(mocks.exportToBlob).toHaveBeenCalledTimes(1);
  expect(mocks.setThumbnail).toHaveBeenCalledExactlyOnceWith(
    "imported",
    image,
    scene("imported"),
  );
});

it("caches empty canvases without asking the renderer to export empty content", async () => {
  mocks.getScene.mockResolvedValue({
    ...scene("blank"),
    elements: [{ isDeleted: true }],
  });
  expect(await ensureThumbnail("blank", 1)).toBe("");
  expect(mocks.exportToBlob).not.toHaveBeenCalled();
  expect(mocks.setThumbnail.mock.calls[0][1]).toBe("");
});

it("reuses cached previews and ignores removed or superseded rows", async () => {
  mocks.getScene
    .mockResolvedValueOnce({
      ...scene("cached"),
      thumbnail: "data:image/png;base64,cached",
    })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...scene("newer"), updatedAt: 2 });
  expect(await ensureThumbnail("cached", 1)).toContain("cached");
  expect(await ensureThumbnail("removed", 1)).toBeNull();
  expect(await ensureThumbnail("newer", 1)).toBeNull();
  expect(mocks.exportToBlob).not.toHaveBeenCalled();
});

it("does not display a thumbnail rejected because the source changed during rendering", async () => {
  mocks.setThumbnail.mockResolvedValue(false);
  expect(await ensureThumbnail("edited", 1)).toBeNull();
});

it("processes one preview at a time and continues after a failed image", async () => {
  let rejectFirst!: (error: Error) => void;
  mocks.exportToBlob.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectFirst = reject;
    }),
  );
  const first = ensureThumbnail("bad", 1);
  const failed = expect(first).rejects.toThrow("bad image");
  const second = ensureThumbnail("good", 1);
  await vi.waitFor(() => expect(mocks.exportToBlob).toHaveBeenCalledTimes(1));
  rejectFirst(new Error("bad image"));
  await failed;
  expect(await second).toMatch(/^data:image\/png;base64,/);
  expect(mocks.exportToBlob).toHaveBeenCalledTimes(2);
});
