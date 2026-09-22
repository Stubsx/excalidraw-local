import { afterEach, expect, it, vi } from "vitest";

import { createAutosave } from "../src/autosave";
afterEach(() => vi.useRealTimers());
it("flushes the most recent change before a fast tab switch and does not repeat the delayed write", async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockResolvedValue(undefined);
  const saved = vi.fn();
  const save = createAutosave(write, saved, vi.fn());
  save.schedule("first");
  save.schedule("latest");
  await save.flush();
  await vi.runAllTimersAsync();
  expect(write.mock.calls).toEqual([["latest"]]);
  expect(saved).toHaveBeenCalledTimes(1);
});
it("serializes edits arriving during a write and shares concurrent flushes", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const write = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const save = createAutosave(write, vi.fn(), vi.fn());
  save.schedule("first");
  const one = save.flush();
  save.schedule("second");
  const two = save.flush();
  expect(write).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([one, two]);
  expect(write.mock.calls).toEqual([["first"], ["second"]]);
});
it("retains a failed write for retry and never reports it saved", async () => {
  vi.useFakeTimers();
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined);
  const saved = vi.fn();
  const error = vi.fn();
  const save = createAutosave(write, saved, error);
  save.schedule("important");
  await expect(save.flush()).rejects.toThrow("disk full");
  expect(saved).not.toHaveBeenCalled();
  await save.flush();
  expect(write.mock.calls).toEqual([["important"], ["important"]]);
  expect(saved).toHaveBeenCalledTimes(1);
});
