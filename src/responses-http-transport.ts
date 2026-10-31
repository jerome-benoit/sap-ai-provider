/** Fetch-compatible Responses transport backed by the SAP SDK HTTP client. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";

import { APICallError } from "@ai-sdk/provider";
import { getFoundationModelDeploymentId, getResourceGroup } from "@sap-ai-sdk/ai-api/internal.js";
import { executeRequest, getAiCoreDestination } from "@sap-ai-sdk/core";
import { getTargetUrl } from "@sap-ai-sdk/core/internal.js";

import type { SAPAISettings } from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { createAbortError, throwIfAborted, waitWithAbort } from "./abort-utils.js";
import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import {
  destroyHttpResponse,
  ERROR_BODY_READ_FAILURE,
  type FailedHttpRequest,
  findFailedHttpRequest,
  isDestroyableRequest,
  preserveResponseBodyTimeout,
  readHttpErrorBody,
  type SAPHttpMiddleware,
  type SAPHttpResponse,
} from "./sap-http-stream.js";
import {
  buildModelDeployment,
  createAISDKRequestBodySummary,
  mergeRequestConfig,
} from "./strategy-utils.js";

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
        const readFailure = await readHttpErrorBody(
          failedRequest.response,
          responseStream,
          signal ?? undefined,
        );
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
