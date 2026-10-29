/** Stream conversion must preserve consumer demand, cancellation, and failures. */
import { describe, expect, it, vi } from "vitest";

import { mapReadableStream } from "./map-readable-stream.js";

describe("mapReadableStream", () => {
  it("skips unsupported values within the same consumer read and releases completed sources", async () => {
    const source = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.enqueue(3);
        controller.close();
      },
    });
    const reader = mapReadableStream(source, (value) =>
      value % 2 ? null : String(value),
    ).getReader();

    expect(await reader.read()).toEqual({ done: false, value: "2" });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(source.locked).toBe(false);
  });

  it("cancels a pending source read without converting or emitting another value", async () => {
    const cancel = vi.fn();
    const convert = vi.fn((value: number) => value);
    const source = new ReadableStream<number>({ cancel }, { highWaterMark: 0 });
    const reader = mapReadableStream(source, convert).getReader();
    const pending = reader.read();

    await reader.cancel("consumer stopped");

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(cancel).toHaveBeenCalledExactlyOnceWith("consumer stopped");
    expect(convert).not.toHaveBeenCalled();
    expect(source.locked).toBe(false);
  });

  it("preserves upstream error identity and releases the reader", async () => {
    const failure = new Error("upstream failed");
    const source = new ReadableStream<number>({
      start(controller) {
        controller.error(failure);
      },
    });
    const reader = mapReadableStream(source, (value) => value).getReader();

    await expect(reader.read()).rejects.toBe(failure);
    expect(source.locked).toBe(false);
  });

  it("cancels upstream on conversion failure without replacing the original error", async () => {
    const failure = new Error("conversion failed");
    const cancel = vi.fn(() => Promise.reject(new Error("cleanup failed")));
    const source = new ReadableStream<number>({
      cancel,
      start(controller) {
        controller.enqueue(1);
      },
    });
    const reader = mapReadableStream(source, () => {
      throw failure;
    }).getReader();

    await expect(reader.read()).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(failure);
    expect(source.locked).toBe(false);
  });

  it("preserves cancellation failures while releasing the source reader", async () => {
    const failure = new Error("cancel failed");
    const source = new ReadableStream<number>({
      cancel: () => Promise.reject(failure),
    });
    const stream = mapReadableStream(source, (value) => value);

    await expect(stream.cancel("consumer stopped")).rejects.toBe(failure);
    expect(source.locked).toBe(false);
  });
});
