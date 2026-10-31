/** Cancellation helpers shared by SDK calls and stream transports. */
/**
 * Preserves a caller-provided reason while retaining standard abort classification.
 * @param reason - The original cancellation reason.
 * @returns An AbortError carrying the reason as its cause.
 * @internal
 */
export function createAbortError(reason: unknown): Error {
  const error = new Error("The operation was aborted.", { cause: reason });
  error.name = "AbortError";
  return error;
}
/**
 * Preserves cancellation classification for arbitrary caller-provided reasons.
 * @param signal - The caller's abort signal.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

/**
 * Cancels a caller's wait even when a SAP preparation step cannot accept a signal.
 * @param pending - SDK work whose late rejection must remain observed.
 * @param signal - Cancellation for the caller's wait.
 * @param onAbortedValue - Releases a result delivered after cancellation.
 * @returns The result or a classified abort error.
 */
export function waitWithAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
  onAbortedValue?: (value: T) => void,
): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    let listening = true;
    const cleanup = () => {
      if (!listening) return;
      listening = false;
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending
      .then(
        (value) => {
          cleanup();
          if (signal.aborted) {
            try {
              onAbortedValue?.(value);
            } finally {
              reject(createAbortError(signal.reason));
            }
          } else {
            resolve(value);
          }
        },
        (error: unknown) => {
          cleanup();
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve SDK rejection values for the shared error converter.
          reject(error);
        },
      )
      .catch((error: unknown) => {
        cleanup();
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve synchronous disposal failures without unhandled rejections.
        reject(error);
      });
    if (signal.aborted) onAbort();
  });
}
