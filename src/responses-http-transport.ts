/** Fetch-compatible Responses transport backed by the SAP SDK HTTP client. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { FetchFunction } from "@ai-sdk/provider-utils";

import { getFoundationModelDeploymentId, getResourceGroup } from "@sap-ai-sdk/ai-api/internal.js";
import { executeRequest, getAiCoreDestination } from "@sap-ai-sdk/core";
import { getTargetUrl } from "@sap-ai-sdk/core/internal.js";

import type { SAPAISettings } from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import {
  buildModelDeployment,
  createAISDKRequestBodySummary,
  mergeRequestConfig,
} from "./strategy-utils.js";
import { createAbortError } from "./stream-transformer.js";

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
): Promise<{ baseURL: string; fetch: FetchFunction }> {
  throwIfAborted(options.abortSignal);
  const deployment = buildModelDeployment(config, settings.modelVersion);
  const [deploymentId, destination] = await Promise.all([
    getFoundationModelDeploymentId(deployment, "azure-openai", config.destination),
    getAiCoreDestination(config.destination),
  ]);
  throwIfAborted(options.abortSignal);

  const deploymentPath = `/inference/deployments/${encodeURIComponent(deploymentId)}`;
  const baseURL = getTargetUrl(destination.url, deploymentPath);
  const endpoint = new URL(`${baseURL}/responses`);
  const requestConfig = mergeRequestConfig(
    config.requestConfig,
    options.abortSignal,
    options.headers,
  );

  const fetch: FetchFunction = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname) {
      throw new TypeError("SAP Responses requests must target the configured deployment.");
    }
    if (init?.method !== "POST" || typeof init.body !== "string") {
      throw new TypeError("SAP Responses requires a POST request with a JSON body.");
    }
    const body: unknown = JSON.parse(init.body);
    const controller = new AbortController();
    const signal = options.abortSignal ?? init.signal;
    const onAbort = () => {
      controller.abort(signal?.reason);
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    throwIfAborted(signal ?? undefined);
    signal?.addEventListener("abort", onAbort, { once: true });

    const headers = new Headers(init.headers);
    // Authentication belongs to the SAP destination, not the delegate's placeholder key.
    headers.delete("authorization");
    const configuredHeaders = Object.fromEntries(
      Object.entries(requestConfig?.headers ?? {}).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );

    try {
      const response = await executeRequest(
        {
          apiVersion: "2024-10-21",
          resourceGroup: getResourceGroup(deployment),
          url: `${deploymentPath}/responses`,
        },
        body,
        {
          ...requestConfig,
          headers: { ...Object.fromEntries(headers), ...configuredHeaders },
          responseType: "stream",
          signal: controller.signal,
        },
        config.destination,
      );
      const responseBody: unknown = response.data;
      return new Response(createByteStream(responseBody, controller, cleanup, config, options), {
        headers: normalizeHeaders(response.headers),
        status: response.status,
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  };

  return { baseURL, fetch };
}

/**
 * Converts SAP's streaming response without buffering or losing cancellation.
 * @param body - The SAP HTTP client's Node stream.
 * @param requestController - Controls the upstream SAP request.
 * @param cleanup - Removes the caller's abort listener.
 * @param config - Model configuration for safe error conversion.
 * @param options - Standard AI SDK call options.
 * @returns A native byte stream consumed by the OpenAI provider.
 */
function createByteStream(
  body: unknown,
  requestController: AbortController,
  cleanup: () => void,
  config: LanguageModelStrategyConfig,
  options: LanguageModelV3CallOptions,
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

  return new ReadableStream<Uint8Array>(
    {
      async cancel(reason) {
        requestController.abort(reason);
        cleanup();
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
            cleanup();
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
          source.destroy?.();
          cleanup();
          controller.error(
            convertToAISDKError(failure, {
              modelId: config.modelId,
              modelType: "languageModel",
              operation: "doStream",
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
 * Preserves cancellation classification for arbitrary caller-provided reasons.
 * @param signal - The caller's abort signal.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError(signal.reason);
}
