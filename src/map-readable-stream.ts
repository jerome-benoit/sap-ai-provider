/** Demand-driven stream conversion shared by the public model facades. */

/**
 * Maps source values only when requested, skipping null conversion results.
 * @param source - Stream whose cancellation and errors must be preserved.
 * @param convert - Synchronous conversion; null drops an unsupported event.
 * @returns A stream that does not prefetch source values.
 * @internal
 */
export function mapReadableStream<TInput, TOutput>(
  source: ReadableStream<TInput>,
  convert: (value: TInput) => null | TOutput,
): ReadableStream<TOutput> {
  const reader = source.getReader();
  let cancelled = false;

  return new ReadableStream<TOutput>(
    {
      async cancel(reason) {
        cancelled = true;
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
      async pull(controller) {
        try {
          for (;;) {
            const next = await reader.read();
            if (cancelled) return;
            if (next.done) {
              reader.releaseLock();
              controller.close();
              return;
            }
            const converted = convert(next.value);
            if (converted !== null) {
              controller.enqueue(converted);
              return;
            }
          }
        } catch (error) {
          if (cancelled) return;
          // Source cleanup must not replace the conversion or upstream failure.
          await reader.cancel(error).catch(() => undefined);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Cancellation can race asynchronous cleanup.
          if (cancelled) return;
          reader.releaseLock();
          controller.error(error);
        }
      },
    },
    { highWaterMark: 0 },
  );
}
