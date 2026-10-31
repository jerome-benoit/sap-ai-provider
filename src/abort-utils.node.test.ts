/** Wait cancellation observes late work without retaining provider listeners. */
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { waitWithAbort } from "./abort-utils.js";

/**
 * Exposes controlled asynchronous work using ES2022-compatible promises.
 * @returns Pending work and its settlement callbacks.
 */
function pendingWork<T>(): {
  promise: Promise<T>;
  reject: (reason: Error) => void;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("shared cancellable SDK waits", () => {
  it.each(["success", "failure", "abort"] as const)(
    "removes its listener after %s",
    async (outcome) => {
      const pending = pendingWork<string>();
      const caller = new AbortController();
      const waited = waitWithAbort(pending.promise, caller.signal);
      const failure = new Error("original SDK failure");
      if (outcome === "success") {
        pending.resolve("result");
        await expect(waited).resolves.toBe("result");
      } else if (outcome === "failure") {
        pending.reject(failure);
        await expect(waited).rejects.toBe(failure);
      } else {
        caller.abort(failure);
        await expect(waited).rejects.toMatchObject({ cause: failure, name: "AbortError" });
        pending.reject(new Error("late SDK failure"));
      }
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    },
  );

  it.each(["fulfillment", "rejection"] as const)(
    "observes late %s after startup cancellation",
    async (outcome) => {
      const caller = new AbortController();
      const pending = pendingWork<string>();
      const unhandled = vi.fn();
      const disposer = vi.fn(() => {
        throw new Error("late disposal failure");
      });
      process.on("unhandledRejection", unhandled);
      caller.abort("cancelled during synchronous SDK startup");
      try {
        const waited = waitWithAbort(pending.promise, caller.signal, disposer);
        await expect(waited).rejects.toMatchObject({
          cause: caller.signal.reason as unknown,
          name: "AbortError",
        });
        if (outcome === "fulfillment") pending.resolve("late stream");
        else pending.reject(new Error("late discovery failure"));
        await setImmediate();
        if (outcome === "fulfillment") expect(disposer).toHaveBeenCalledWith("late stream");
        else expect(disposer).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );
});
