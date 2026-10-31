/** Native SAP HTTP stream lifecycle and bounded failure diagnostics. */
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { HttpResponse } from "@sap-cloud-sdk/http-client";

import { AISDKError } from "@ai-sdk/provider";
import { isErrorWithCause } from "@sap-cloud-sdk/util";

import { throwIfAborted, waitWithAbort } from "./abort-utils.js";
export interface FailedHttpRequest extends Error {
  isAxiosError: true;
  response: SAPHttpResponse;
}
export type SAPHttpMiddleware = NonNullable<CustomRequestConfig["middleware"]>[number];

export type SAPHttpResponse = HttpResponse;

interface HttpResponseEvents {
  destroy: (error?: Error) => void;
  once: (event: string, listener: () => void) => unknown;
  removeListener: (event: string, listener: () => void) => unknown;
}

interface HttpStreamResources {
  readonly data: unknown;
  readonly request?: unknown;
}
interface NativeStreamResponse {
  readonly rawResponse: SAPHttpResponse;
  readonly stream: { readonly controller: AbortController };
}

type ResponseBodyDisposer = (retainedRequest?: unknown) => void;

interface StreamResponseOwnership extends HttpStreamResources {
  disposeTimeout: ResponseBodyDisposer | undefined;
  readonly fromTransport: boolean;
}

const ERROR_BODY_TRUNCATION = "...[truncated]";
// Reserve the marker inside the shared HTTP diagnostic serializer's 2,000-character limit.
const MAX_ERROR_BODY_BYTES = 2_000 - ERROR_BODY_TRUNCATION.length;
export const ERROR_BODY_READ_FAILURE = Symbol("sap-ai.httpErrorBodyReadFailure");
const disposedStreams = new WeakSet();
// Retain provenance after release so later cancellation cannot use raw fallback cleanup.
const leasedStreams = new WeakSet();
const streamLeases = new WeakMap<object, () => void>();
/**
 * Releases an HTTP response that arrives after its caller has cancelled.
 * @param response - A late SDK response whose stream has no consumer.
 * @param retainedRequest - A request transferred to a recovered successful stream.
 */
export function destroyHttpResponse(
  response: HttpStreamResources,
  retainedRequest?: unknown,
): void {
  const body: unknown = response.data;
  const request: unknown = response.request;
  try {
    if (isDestroyableRequest(body)) body.destroy();
  } finally {
    if (request !== retainedRequest && isDestroyableRequest(request)) request.destroy();
  }
}
/**
 * Releases an abandoned SDK stream without starting its SSE iterator.
 * @param response - Raw stream response returned by either SAP client.
 */
export function disposeSapStream(response: NativeStreamResponse): void {
  if (disposedStreams.has(response)) return;
  disposedStreams.add(response);
  try {
    response.stream.controller.abort();
  } finally {
    if (leasedStreams.has(response)) releaseSapStream(response);
    else destroyHttpResponse(response.rawResponse);
  }
}
/**
 * Preserves only the final middleware failure before SAP's JSON-only stream parser.
 * @param execute - Starts the raw SDK stream with the supplied middleware chain.
 * @param signal - Caller cancellation forwarded separately to the SDK.
 * @param requestConfig - Existing caller transport and retry middleware.
 * @returns A live SDK stream, with successful ownership transferred to its caller.
 */
export async function executeSapStream<T extends NativeStreamResponse>(
  execute: (requestConfig: CustomRequestConfig) => Promise<T>,
  signal: AbortSignal | undefined,
  requestConfig: CustomRequestConfig | undefined,
): Promise<T> {
  const responses: StreamResponseOwnership[] = [];
  const cleanups = new Set<() => void>();
  let closed = false;
  let transferred = false;
  let failedRequest: FailedHttpRequest | undefined;
  let failedError: unknown;

  const release = () => {
    closed = true;
    signal?.removeEventListener("abort", release);
    // Each snapshot owns the resources observed before middleware can replace them.
    // A consumed native body has already returned its request's socket to the pool.
    for (const response of responses) {
      if (response.fromTransport && isConsumedHttpBody(response.data)) continue;
      const consumedRequest = responses.some(
        (other) =>
          other.fromTransport &&
          other.request === response.request &&
          isConsumedHttpBody(other.data),
      );
      try {
        const dispose = response.disposeTimeout;
        const retainedRequest = consumedRequest ? response.request : undefined;
        if (dispose && cleanups.has(dispose)) dispose(retainedRequest);
        else destroyHttpResponse(response, retainedRequest);
      } catch {
        // Cleanup must not replace the operation's primary outcome.
      }
    }
    responses.length = 0;
    cleanups.clear();
  };
  const ownResponse = (
    response: SAPHttpResponse,
    request: CustomRequestConfig,
    fromTransport: boolean,
    failed: boolean,
  ) => {
    const data: unknown = response.data;
    const nativeRequest: unknown = response.request;
    const owned = responses.find((other) => other.data === data && other.request === nativeRequest);
    if (owned) {
      if (failed && !owned.disposeTimeout) {
        owned.disposeTimeout = preserveResponseBodyTimeout(response, request, cleanups);
      }
    } else {
      responses.push({
        data,
        disposeTimeout: failed
          ? preserveResponseBodyTimeout(response, request, cleanups)
          : undefined,
        fromTransport,
        request: nativeRequest,
      });
    }
    if (closed || signal?.aborted) release();
  };
  const observeResponse: SAPHttpMiddleware =
    ({ fn }) =>
    async (request) => {
      try {
        const response = await fn(request);
        ownResponse(response, request, true, false);
        return response;
      } catch (error) {
        const failed = findFailedHttpRequest(error);
        if (failed) ownResponse(failed.response, request, true, true);
        throw error;
      }
    };
  const captureFinalFailure: SAPHttpMiddleware =
    ({ fn }) =>
    async (request) => {
      try {
        const response = await fn(request);
        ownResponse(response, request, false, false);
        return response;
      } catch (error) {
        const failed = findFailedHttpRequest(error);
        if (!failed) throw error;
        failedRequest = failed;
        failedError = error;
        // Middleware can reject a successful response or substitute its body.
        ownResponse(failed.response, request, false, true);
        return failed.response;
      }
    };
  try {
    const response = await waitWithAbort(
      execute({
        ...requestConfig,
        middleware: [captureFinalFailure, ...(requestConfig?.middleware ?? []), observeResponse],
      }),
      signal,
      disposeSapStream,
    );
    if (signal?.aborted) {
      try {
        disposeSapStream(response);
      } finally {
        throwIfAborted(signal);
      }
    }
    if (failedRequest) {
      try {
        await readHttpErrorBody(
          failedRequest.response,
          createErrorByteStream(failedRequest.response),
          signal,
        );
      } catch {
        // Diagnostic failures never replace the final native HTTP failure.
        throwIfAborted(signal);
      }
      throw failedError;
    }
    if (responses.length > 0) {
      // Do not inspect optional rawResponse metadata here. A lease keeps both
      // replacement streams and wrappers around original bodies alive until done.
      streamLeases.set(response, release);
      leasedStreams.add(response);
      signal?.addEventListener("abort", release, { once: true });
      if (signal?.aborted) {
        releaseSapStream(response);
        throwIfAborted(signal);
      }
      transferred = true;
    }
    return response;
  } finally {
    if (!transferred) release();
  }
}

/**
 * Finds the final Axios failure without crossing a classified AI SDK boundary.
 * @param error - Original rejection from the configured middleware chain.
 * @returns The nested failed request, if reachable within the bounded cause chain.
 */
export function findFailedHttpRequest(error: unknown): FailedHttpRequest | undefined {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 32; depth++) {
    if (typeof current !== "object" || current === null || seen.has(current)) return undefined;
    if (AISDKError.isInstance(current)) return undefined;
    seen.add(current);
    if (isFailedHttpRequest(current)) return current;
    // SAP's legacy rootCause getter can recurse. Prefer its native cause even
    // when undefined, and never inspect both representations of the same chain.
    current =
      "cause" in current
        ? current.cause
        : current instanceof Error && isErrorWithCause(current)
          ? current.rootCause
          : undefined;
  }
  return undefined;
}

/**
 * Identifies the native request used to close a preserved HTTP-error response.
 * @param request - Request attached to an Axios response.
 * @returns Whether the request supports cancellation by destruction.
 */
export function isDestroyableRequest(request: unknown): request is { destroy: () => void } {
  return (
    typeof request === "object" &&
    request !== null &&
    "destroy" in request &&
    typeof request.destroy === "function"
  );
}

/**
 * Keeps Axios's socket inactivity timeout effective after streamed headers settle.
 * @param response - Native response observed before configured middleware resumes.
 * @param requestConfig - Fallback settings when resolved Axios metadata is unavailable.
 * @param cleanups - Disposes responses abandoned by cancellation or middleware retries.
 * @returns The setup disposer; omit it from setup cleanup when the body is transferred.
 */
export function preserveResponseBodyTimeout(
  response: SAPHttpResponse,
  requestConfig: CustomRequestConfig,
  cleanups: Set<() => void>,
): ResponseBodyDisposer | undefined {
  const body: unknown = response.data;
  const request: unknown = response.request;
  if (!isHttpResponseEvents(body) || !isHttpResponseEvents(request)) return;
  const responseConfig: unknown = "config" in response ? response.config : undefined;
  const timeoutConfig =
    typeof responseConfig === "object" && responseConfig !== null && !Array.isArray(responseConfig)
      ? (responseConfig as Record<string, unknown>)
      : requestConfig;
  let ownsRequest = true;

  const release = () => {
    request.removeListener("timeout", onTimeout);
    body.removeListener("end", release);
    body.removeListener("error", onFailure);
    body.removeListener("close", onFailure);
    cleanups.delete(dispose);
  };
  const onFailure = () => {
    try {
      if (ownsRequest) request.destroy();
    } finally {
      release();
    }
  };
  const dispose: ResponseBodyDisposer = (retainedRequest) => {
    ownsRequest = request !== retainedRequest;
    request.removeListener("timeout", onTimeout);
    // Keep the error observer until close: destruction can emit an error asynchronously.
    try {
      body.destroy();
    } finally {
      if (ownsRequest) request.destroy();
    }
  };
  const onTimeout = () => {
    const nativeResponse: unknown = "res" in request ? request.res : undefined;
    // A fully received body can remain buffered while configured middleware waits.
    if (
      typeof nativeResponse === "object" &&
      nativeResponse !== null &&
      "complete" in nativeResponse &&
      nativeResponse.complete === true
    ) {
      release();
      return;
    }
    const timeout: unknown = timeoutConfig.timeout;
    const timeoutErrorMessage: unknown = timeoutConfig.timeoutErrorMessage;
    const transitional: unknown = timeoutConfig.transitional;
    const clarifyTimeoutError =
      typeof transitional === "object" &&
      transitional !== null &&
      "clarifyTimeoutError" in transitional &&
      transitional.clarifyTimeoutError === true;
    const message =
      typeof timeoutErrorMessage === "string" && timeoutErrorMessage
        ? timeoutErrorMessage
        : (typeof timeout === "number" || typeof timeout === "string") && timeout
          ? `timeout of ${String(timeout)}ms exceeded`
          : "timeout exceeded";
    // Aborting the controller here would misclassify inactivity as caller cancellation.
    body.destroy(
      Object.assign(new Error(message), {
        code: clarifyTimeoutError ? "ETIMEDOUT" : "ECONNABORTED",
      }),
    );
    request.destroy();
  };
  request.once("timeout", onTimeout);
  body.once("end", release);
  body.once("error", onFailure);
  body.once("close", onFailure);
  cleanups.add(dispose);
  return dispose;
}

/**
 * Retains bounded UTF-8 diagnostics, parsing JSON only after a complete body.
 * @param response - Native failed response whose data will hold the diagnostic.
 * @param stream - Byte stream owned by this failure.
 * @param signal - Caller cancellation, distinct from diagnostic truncation.
 * @returns Any secondary read failure, kept outside the native cause chain.
 */
export async function readHttpErrorBody(
  response: SAPHttpResponse,
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<unknown> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let retainedBytes = 0;
  let text = "";
  let truncated = false;
  let readFailure: unknown;
  try {
    for (;;) {
      const chunk = await waitWithAbort(reader.read(), signal);
      if (chunk.done) {
        text += decoder.decode();
        break;
      }
      const remaining = MAX_ERROR_BODY_BYTES - retainedBytes;
      text += decoder.decode(chunk.value.subarray(0, remaining), { stream: true });
      retainedBytes += Math.min(chunk.value.byteLength, remaining);
      if (chunk.value.byteLength > remaining) {
        truncated = true;
        await reader.cancel("HTTP error diagnostic limit exceeded");
        break;
      }
    }
  } catch (error) {
    readFailure = error;
    if (!truncated) text += decoder.decode();
    void reader.cancel(error).catch(() => {
      // The original diagnostic read failure remains primary.
    });
  } finally {
    if (signal?.aborted) {
      destroyHttpResponse(response);
      void reader.cancel(signal.reason).catch(() => {
        // Caller cancellation remains primary while teardown settles.
      });
    }
    reader.releaseLock();
  }
  response.data = truncated ? text + ERROR_BODY_TRUNCATION : text;
  if (!truncated && readFailure === undefined) {
    try {
      response.data = JSON.parse(text) as unknown;
    } catch {
      response.data = text;
    }
  }
  throwIfAborted(signal);
  return readFailure;
}
/**
 * Keeps observed transport resources alive until the returned SSE iterator ends.
 * @param response - SDK response holding the operation's resource lease.
 * @param stream - SDK iterator, which must not start during setup.
 * @returns The iterator with finalization cleanup, or the unchanged unowned iterator.
 */
export function withSapStreamCleanup<T>(
  response: NativeStreamResponse,
  stream: AsyncIterable<T>,
): AsyncIterable<T> {
  if (!streamLeases.has(response)) return stream;
  return iterate();

  /**
   * Iterates SDK chunks while releasing the owned transport on every exit.
   * @returns The unchanged SDK chunk sequence.
   */
  async function* iterate(): AsyncGenerator<T> {
    try {
      yield* stream;
    } finally {
      releaseSapStream(response);
    }
  }
}

/**
 * Adapts only failed native bodies; successful SDK SSE ownership stays untouched.
 * @param response - Failed native HTTP response.
 * @returns Byte stream consumed by the shared bounded diagnostic reader.
 */
function createErrorByteStream(response: SAPHttpResponse): ReadableStream<Uint8Array> {
  const body: unknown = response.data;
  if (
    typeof body !== "object" ||
    body === null ||
    !(Symbol.asyncIterator in body) ||
    typeof body[Symbol.asyncIterator] !== "function"
  ) {
    throw new TypeError("SAP did not return a readable HTTP error body.");
  }
  const iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>(
    {
      cancel() {
        destroyHttpResponse(response);
      },
      async pull(controller) {
        try {
          const chunk = await iterator.next();
          if (chunk.done) controller.close();
          else if (typeof chunk.value === "string") controller.enqueue(encoder.encode(chunk.value));
          else if (chunk.value instanceof Uint8Array) controller.enqueue(chunk.value);
          else throw new TypeError("SAP returned a non-byte HTTP error chunk.");
        } catch (error) {
          try {
            destroyHttpResponse(response);
          } catch {
            // Teardown cannot replace the native HTTP failure or its diagnostics.
          } finally {
            controller.error(error);
          }
        }
      },
    },
    { highWaterMark: 0 },
  );
}
/**
 * Identifies a consumed native body whose request may have released its socket.
 * @param body - Original body observed at the transport boundary.
 * @returns Whether the native readable has reached its end.
 */
function isConsumedHttpBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "readableEnded" in body &&
    body.readableEnded === true
  );
}
/**
 * Identifies the HTTP errors whose response streams need preservation.
 * @param error - Failure reported by the SAP HTTP middleware chain.
 * @returns Whether the failure includes a native Axios response.
 */
function isFailedHttpRequest(error: unknown): error is FailedHttpRequest {
  return (
    error instanceof Error &&
    "isAxiosError" in error &&
    error.isAxiosError === true &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null
  );
}
/**
 * Identifies native HTTP requests and response streams without importing Node APIs.
 * @param value - Native object returned by the SAP HTTP client.
 * @returns Whether lifecycle listeners and destruction are supported.
 */
function isHttpResponseEvents(value: unknown): value is HttpResponseEvents {
  return (
    isDestroyableRequest(value) &&
    "once" in value &&
    typeof value.once === "function" &&
    "removeListener" in value &&
    typeof value.removeListener === "function"
  );
}
/**
 * Releases the transport resources leased to a recovered SDK stream.
 * @param response - SDK response whose iteration has ended or been cancelled.
 */
function releaseSapStream(response: NativeStreamResponse): void {
  const release = streamLeases.get(response);
  streamLeases.delete(response);
  release?.();
}
