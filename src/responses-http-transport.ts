/** Fetch-compatible Responses transport backed by the SAP SDK HTTP client. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";

import { AISDKError, APICallError } from "@ai-sdk/provider";
import { getFoundationModelDeploymentId, getResourceGroup } from "@sap-ai-sdk/ai-api/internal.js";
import { executeRequest, getAiCoreDestination } from "@sap-ai-sdk/core";
import { getTargetUrl } from "@sap-ai-sdk/core/internal.js";
import { isErrorWithCause } from "@sap-cloud-sdk/util";

import type { SAPAISettings } from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import {
  buildModelDeployment,
  createAISDKRequestBodySummary,
  mergeRequestConfig,
} from "./strategy-utils.js";
import { createAbortError } from "./stream-transformer.js";

interface FailedHttpRequest extends Error {
  isAxiosError: true;
  response: SAPHttpResponse;
}

interface HttpResponseEvents {
  destroy: (error?: Error) => void;
  once: (event: string, listener: () => void) => unknown;
  removeListener: (event: string, listener: () => void) => unknown;
}

type SAPHttpMiddleware = NonNullable<CustomRequestConfig["middleware"]>[number];

type SAPHttpResponse = Awaited<ReturnType<typeof executeRequest>>;

const ERROR_BODY_TRUNCATION = "...[truncated]";
// Reserve the marker inside the shared HTTP diagnostic serializer's 2,000-character limit.
const MAX_ERROR_BODY_BYTES = 2_000 - ERROR_BODY_TRUNCATION.length;
const ERROR_BODY_READ_FAILURE = Symbol("sap-ai.responsesErrorBodyReadFailure");

/**
 * Resolves a SAP deployment and adapts its HTTP transport to the OpenAI provider.
 * @param config - SAP deployment and transport configuration.
 * @param settings - Resolved model settings.
 * @param options - Standard AI SDK call options.
 * @returns The deployment base URL and a fetch-compatible SAP transport.
 * @internal
 */
export async function createResponsesTransport(
  config: LanguageModelStrategyConfig,
  settings: SAPAISettings,
  options: LanguageModelV3CallOptions,
): Promise<{ baseURL: string; dispose: (reason?: unknown) => void; fetch: FetchFunction }> {
  throwIfAborted(options.abortSignal);
  const deployment = buildModelDeployment(config, settings.modelVersion);
  // SAP's discovery helpers expose no signal; cancel the wait and observe late rejections.
  const [deploymentId, destination] = await waitWithAbort(
    Promise.all([
      getFoundationModelDeploymentId(deployment, "azure-openai", config.destination),
      getAiCoreDestination(config.destination),
    ]),
    options.abortSignal,
  );
  throwIfAborted(options.abortSignal);

  const deploymentPath = `/inference/deployments/${encodeURIComponent(deploymentId)}`;
  const baseURL = getTargetUrl(destination.url, deploymentPath);
  const endpoint = new URL(`${baseURL}/responses`);
  const requestConfig = mergeRequestConfig(
    config.requestConfig,
    options.abortSignal,
    options.headers,
  );
  const activeRequests = new Set<(reason?: unknown) => void>();
  let disposed = false;
  let disposalReason: unknown;
  const dispose = (reason?: unknown) => {
    if (disposed) return;
    disposed = true;
    disposalReason = reason;
    for (const release of activeRequests) {
      try {
        release(reason);
      } catch {
        // Disposal must never replace the invocation's primary failure.
      }
    }
    activeRequests.clear();
  };

  const fetch: FetchFunction = async (input, init) => {
    if (disposed) throw createAbortError(disposalReason);
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname) {
      throw new TypeError("SAP Responses requests must target the configured deployment.");
    }
    if (init?.method !== "POST" || typeof init.body !== "string") {
      throw new TypeError("SAP Responses requires a POST request with a JSON body.");
    }
    const body: unknown = JSON.parse(init.body);
    const operation =
      typeof body === "object" && body !== null && "stream" in body && body.stream === true
        ? "doStream"
        : "doGenerate";
    const controller = new AbortController();
    const signal = options.abortSignal ?? init.signal;
    const bodyTimeoutCleanups = new Set<() => void>();
    let abortFailedRequest: (() => void) | undefined;
    let activeResponse: SAPHttpResponse | undefined;
    const onAbort = () => {
      controller.abort(signal?.reason);
    };
    const cleanup = () => {
      activeRequests.delete(disposeRequest);
      signal?.removeEventListener("abort", onAbort);
      if (abortFailedRequest) controller.signal.removeEventListener("abort", abortFailedRequest);
      for (const dispose of bodyTimeoutCleanups) dispose();
      activeResponse = undefined;
    };
    const disposeRequest = (reason?: unknown) => {
      try {
        controller.abort(reason);
      } finally {
        try {
          if (activeResponse) destroyHttpResponse(activeResponse);
        } finally {
          cleanup();
        }
      }
    };
    throwIfAborted(signal ?? undefined);
    signal?.addEventListener("abort", onAbort, { once: true });
    activeRequests.add(disposeRequest);

    const headers = new Headers(init.headers);
    // Authentication belongs to the SAP destination, not the delegate's placeholder key.
    headers.delete("authorization");
    const configuredHeaders = Object.fromEntries(
      Object.entries(requestConfig?.headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );

    let failedRequest: FailedHttpRequest | undefined;
    let failedError: unknown;
    const watchResponse = (response: SAPHttpResponse, request: CustomRequestConfig) => {
      activeResponse = response;
      if (controller.signal.aborted) destroyHttpResponse(response);
      else preserveResponseBodyTimeout(response, request, bodyTimeoutCleanups);
      return response;
    };
    const preserveBodyTimeout: SAPHttpMiddleware =
      ({ fn }) =>
      async (request) => {
        try {
          return watchResponse(await fn(request), request);
        } catch (error) {
          const failed = findFailedHttpRequest(error);
          if (failed) watchResponse(failed.response, request);
          throw error;
        }
      };
    const preserveErrorResponse: SAPHttpMiddleware =
      ({ fn }) =>
      async (request) => {
        try {
          return await fn(request);
        } catch (error) {
          const failed = findFailedHttpRequest(error);
          if (!failed) throw error;
          // SAP's stream error parser assumes JSON. Retain the response before it can
          // discard status and headers when an intermediary returns HTML or an empty body.
          failedRequest = failed;
          failedError = error;
          const request: unknown = failed.response.request;
          if (isDestroyableRequest(request)) {
            // A rejected Axios request no longer observes the request abort signal.
            abortFailedRequest = () => {
              request.destroy();
            };
            if (controller.signal.aborted) abortFailedRequest();
            else controller.signal.addEventListener("abort", abortFailedRequest, { once: true });
          }
          return failed.response;
        }
      };

    try {
      const pendingResponse = executeRequest(
        {
          apiVersion: "2024-10-21",
          resourceGroup: getResourceGroup(deployment),
          url: `${deploymentPath}/responses`,
        },
        body,
        {
          ...requestConfig,
          headers: { ...Object.fromEntries(headers), ...configuredHeaders },
          middleware: [
            preserveErrorResponse,
            ...(requestConfig?.middleware ?? []),
            preserveBodyTimeout,
          ],
          responseType: "stream",
          signal: controller.signal,
        },
        config.destination,
      );
      const response = await waitWithAbort(pendingResponse, controller.signal, destroyHttpResponse);
      activeResponse = response;
      if (controller.signal.aborted) {
        destroyHttpResponse(response);
        throw createAbortError(controller.signal.reason);
      }
      const responseBody: unknown = response.data;
      const responseStream = createByteStream(
        responseBody,
        controller,
        cleanup,
        config,
        options,
        operation,
      );
      if (failedRequest) {
        const decoder = new TextDecoder();
        const reader = responseStream.getReader();
        let retainedBytes = 0;
        let text = "";
        let truncated = false;
        let readFailure: unknown;
        try {
          for (;;) {
            const chunk = await reader.read();
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
        } finally {
          reader.releaseLock();
        }
        failedRequest.response.data = truncated ? text + ERROR_BODY_TRUNCATION : text;
        if (!truncated) {
          try {
            failedRequest.response.data = JSON.parse(text) as unknown;
          } catch {
            failedRequest.response.data = text;
          }
        }
        throwIfAborted(signal ?? undefined);
        const failure = convertToAISDKError(failedError, {
          modelId: config.modelId,
          modelType: "languageModel",
          operation,
          requestBody: createAISDKRequestBodySummary(options),
          url: "sap-ai:responses",
        });
        // Secondary body diagnostics must not enter the native cause chain:
        // the delegate scans that chain for network codes and can override HTTP retryability.
        if (readFailure !== undefined && APICallError.isInstance(failure)) {
          Object.defineProperty(failure, ERROR_BODY_READ_FAILURE, { value: readFailure });
        }
        throw failure;
      }
      return new Response(responseStream, {
        headers: normalizeHeaders(response.headers),
        status: response.status,
      });
    } catch (error) {
      dispose(error);
      throw error;
    }
  };

  return { baseURL, dispose, fetch };
}

/**
 * Converts SAP's streaming response without buffering or losing cancellation.
 * @param body - The SAP HTTP client's Node stream.
 * @param requestController - Controls the upstream SAP request.
 * @param cleanup - Removes the caller's abort listener.
 * @param config - Model configuration for safe error conversion.
 * @param options - Standard AI SDK call options.
 * @param operation - Operation derived from the delegate's request body.
 * @returns A native byte stream consumed by the OpenAI provider.
 */
function createByteStream(
  body: unknown,
  requestController: AbortController,
  cleanup: () => void,
  config: LanguageModelStrategyConfig,
  options: LanguageModelV3CallOptions,
  operation: "doGenerate" | "doStream",
): ReadableStream<Uint8Array> {
  if (
    typeof body !== "object" ||
    body === null ||
    !(Symbol.asyncIterator in body) ||
    typeof body[Symbol.asyncIterator] !== "function"
  ) {
    requestController.abort();
    cleanup();
    throw new TypeError("SAP Responses did not return a readable response body.");
  }

  const source = body as AsyncIterable<unknown> & { destroy?: () => void };
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  // Axios may already have rejected at the headers of a non-success response.
  const onAbort = () => source.destroy?.();
  const cleanupStream = () => {
    requestController.signal.removeEventListener("abort", onAbort);
    cleanup();
  };
  requestController.signal.addEventListener("abort", onAbort, { once: true });
  if (requestController.signal.aborted) onAbort();

  return new ReadableStream<Uint8Array>(
    {
      async cancel(reason) {
        requestController.abort(reason);
        cleanupStream();
        if (source.destroy) {
          source.destroy();
        } else {
          await iterator.return?.();
        }
      },
      async pull(controller) {
        try {
          throwIfAborted(requestController.signal);
          const chunk = await iterator.next();
          throwIfAborted(requestController.signal);
          if (chunk.done) {
            cleanupStream();
            controller.close();
          } else if (typeof chunk.value === "string") {
            controller.enqueue(encoder.encode(chunk.value));
          } else if (chunk.value instanceof Uint8Array) {
            controller.enqueue(chunk.value);
          } else {
            throw new TypeError("SAP Responses returned a non-byte response chunk.");
          }
        } catch (error) {
          const failure = requestController.signal.aborted
            ? createAbortError(requestController.signal.reason)
            : error;
          requestController.abort(error);
          cleanupStream();
          source.destroy?.();
          controller.error(
            convertToAISDKError(failure, {
              modelId: config.modelId,
              modelType: "languageModel",
              operation,
              requestBody: createAISDKRequestBodySummary(options),
              url: "sap-ai:responses",
            }),
          );
        }
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Releases an HTTP response that arrives after its caller has cancelled.
 * @param response - A late SDK response whose stream has no consumer.
 */
function destroyHttpResponse(response: SAPHttpResponse): void {
  const body: unknown = response.data;
  const request: unknown = response.request;
  if (isDestroyableRequest(body)) body.destroy();
  if (isDestroyableRequest(request)) request.destroy();
}

/**
 * Finds the final Axios failure without crossing a classified AI SDK boundary.
 * @param error - Original rejection from the configured middleware chain.
 * @returns The nested failed request, if reachable within the bounded cause chain.
 */
function findFailedHttpRequest(error: unknown): FailedHttpRequest | undefined {
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
function isDestroyableRequest(request: unknown): request is { destroy: () => void } {
  return (
    typeof request === "object" &&
    request !== null &&
    "destroy" in request &&
    typeof request.destroy === "function"
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
 * Keeps Axios's socket inactivity timeout effective after streamed headers settle.
 * @param response - Native response observed before configured middleware resumes.
 * @param requestConfig - Fallback settings when resolved Axios metadata is unavailable.
 * @param cleanups - Disposes responses abandoned by cancellation or middleware retries.
 */
function preserveResponseBodyTimeout(
  response: SAPHttpResponse,
  requestConfig: CustomRequestConfig,
  cleanups: Set<() => void>,
): void {
  const body: unknown = response.data;
  const request: unknown = response.request;
  if (!isHttpResponseEvents(body) || !isHttpResponseEvents(request)) return;
  const responseConfig: unknown = "config" in response ? response.config : undefined;
  const timeoutConfig =
    typeof responseConfig === "object" && responseConfig !== null && !Array.isArray(responseConfig)
      ? (responseConfig as Record<string, unknown>)
      : requestConfig;

  const release = () => {
    request.removeListener("timeout", onTimeout);
    body.removeListener("end", release);
    body.removeListener("error", onFailure);
    body.removeListener("close", onFailure);
    cleanups.delete(dispose);
  };
  const onFailure = () => {
    request.destroy();
    release();
  };
  const dispose = () => {
    request.removeListener("timeout", onTimeout);
    // Keep the error observer until close: destruction can emit an error asynchronously.
    body.destroy();
    request.destroy();
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
}

/**
 * Preserves cancellation classification for arbitrary caller-provided reasons.
 * @param signal - The caller's abort signal.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

/**
 * Cancels a caller's wait even when a SAP preparation step cannot accept a signal.
 * @param pending - SDK work whose late rejection must remain observed.
 * @param signal - Cancellation for the caller's wait.
 * @param onAbortedValue - Releases a result delivered after cancellation.
 * @returns The result or a classified abort error.
 */
function waitWithAbort<T>(
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
    pending.then(
      (value) => {
        cleanup();
        if (signal.aborted) {
          onAbortedValue?.(value);
          reject(createAbortError(signal.reason));
        } else {
          resolve(value);
        }
      },
      (error: unknown) => {
        cleanup();
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve SDK rejection values for the shared error converter.
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}
