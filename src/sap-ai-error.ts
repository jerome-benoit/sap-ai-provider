/**
 * Error conversion utilities for SAP AI Core to Vercel AI SDK error types.
 */
import type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { isErrorWithCause } from "@sap-cloud-sdk/util";

/**
 * @internal
 */
const HTTP_STATUS = {
  BAD_REQUEST: 400,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  REQUEST_TIMEOUT: 408,
  SERVICE_UNAVAILABLE: 503,
  UNAUTHORIZED: 401,
} as const;

/**
 * Converts SAP AI SDK OrchestrationErrorResponse to Vercel AI SDK APICallError.
 * @param errorResponse - The error response from SAP AI SDK.
 * @param context - Optional context for error details.
 * @param context.requestBody - The original request body.
 * @param context.responseHeaders - The response headers.
 * @param context.url - The request URL.
 * @returns An appropriate Vercel AI SDK error type.
 */
export function convertSAPErrorToAPICallError(
  errorResponse: OrchestrationErrorResponse,
  context?: {
    requestBody?: unknown;
    responseHeaders?: Record<string, string>;
    url?: string;
  },
): APICallError | LoadAPIKeyError | NoSuchModelError {
  const error = errorResponse.error;

  let message: string;
  let code: number | undefined;
  let location: string | undefined;
  let requestId: string | undefined;

  if (Array.isArray(error)) {
    const firstError = error[0];
    message = firstError.message;
    code = firstError.code;
    location = firstError.location;
    requestId = firstError.request_id;
  } else {
    message = error.message;
    code = error.code;
    location = error.location;
    requestId = error.request_id;
  }

  const statusCode = getStatusCodeFromSAPError(code);

  const responseBody = JSON.stringify({
    error: {
      code,
      location,
      message,
      request_id: requestId,
    },
  });

  let enhancedMessage = message;

  if (statusCode === HTTP_STATUS.UNAUTHORIZED || statusCode === HTTP_STATUS.FORBIDDEN) {
    enhancedMessage +=
      "\n\nAuthentication failed. Verify your AICORE_SERVICE_KEY environment variable is set correctly." +
      "\nSee: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-service-key";
    if (requestId) {
      enhancedMessage += `\nRequest ID: ${requestId}`;
    }
    return new LoadAPIKeyError({
      message: enhancedMessage,
    });
  }

  if (statusCode === HTTP_STATUS.NOT_FOUND) {
    enhancedMessage +=
      "\n\nResource not found. The model or deployment may not exist in your SAP AI Core instance." +
      "\nSee: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-deployment-for-orchestration";
    if (requestId) {
      enhancedMessage += `\nRequest ID: ${requestId}`;
    }
    const modelId = extractModelIdentifier(message, location);
    return new NoSuchModelError({
      message: enhancedMessage,
      modelId: modelId ?? "unknown",
      modelType: "languageModel",
    });
  }

  if (statusCode === HTTP_STATUS.RATE_LIMIT) {
    enhancedMessage +=
      "\n\nRate limit exceeded. Please try again later or contact your SAP administrator." +
      "\nSee: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/rate-limits";
  } else if (statusCode >= HTTP_STATUS.INTERNAL_ERROR) {
    enhancedMessage +=
      "\n\nSAP AI Core service error. This is typically a temporary issue. The request will be retried automatically." +
      "\nSee: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/troubleshooting";
  } else if (location) {
    enhancedMessage += `\n\nError location: ${location}`;
  }

  if (requestId) {
    enhancedMessage += `\nRequest ID: ${requestId}`;
  }

  return new APICallError({
    isRetryable: isRetryable(statusCode),
    message: enhancedMessage,
    requestBodyValues: context?.requestBody,
    responseBody,
    responseHeaders: context?.responseHeaders,
    statusCode,
    url: context?.url ?? "",
  });
}

/**
 * Converts a generic error to an appropriate Vercel AI SDK error.
 * @param error - The error to convert.
 * @param context - Optional context for error details.
 * @param context.operation - The operation name for error messages.
 * @param context.requestBody - The original request body.
 * @param context.responseHeaders - The response headers.
 * @param context.url - The request URL.
 * @returns An appropriate Vercel AI SDK error type.
 */
export function convertToAISDKError(
  error: unknown,
  context?: {
    operation?: string;
    requestBody?: unknown;
    responseHeaders?: Record<string, string>;
    url?: string;
  },
): APICallError | LoadAPIKeyError | NoSuchModelError {
  if (
    error instanceof APICallError ||
    error instanceof LoadAPIKeyError ||
    error instanceof NoSuchModelError
  ) {
    return error;
  }

  const rootError = error instanceof Error && isErrorWithCause(error) ? error.rootCause : error;

  if (isOrchestrationErrorResponse(rootError)) {
    return convertSAPErrorToAPICallError(rootError, {
      ...context,
      responseHeaders: context?.responseHeaders ?? getAxiosResponseHeaders(error),
    });
  }

  if (rootError instanceof Error) {
    const parsedError = tryExtractSAPErrorFromMessage(rootError.message);
    if (parsedError && isOrchestrationErrorResponse(parsedError)) {
      return convertSAPErrorToAPICallError(parsedError, {
        ...context,
        responseHeaders: context?.responseHeaders ?? getAxiosResponseHeaders(error),
      });
    }
  }

  if (rootError instanceof Error) {
    const errorMsg = rootError.message.toLowerCase();
    const originalErrorMsg = rootError.message;

    if (
      errorMsg.includes("authentication") ||
      errorMsg.includes("unauthorized") ||
      errorMsg.includes("aicore_service_key") ||
      errorMsg.includes("invalid credentials") ||
      errorMsg.includes("service credentials") ||
      errorMsg.includes("service binding")
    ) {
      return new LoadAPIKeyError({
        message:
          `SAP AI Core authentication failed: ${originalErrorMsg}\n\n` +
          `Make sure your AICORE_SERVICE_KEY environment variable is set correctly.\n` +
          `See: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-service-key`,
      });
    }

    if (
      errorMsg.includes("econnrefused") ||
      errorMsg.includes("enotfound") ||
      errorMsg.includes("network") ||
      errorMsg.includes("timeout")
    ) {
      return createAPICallError(
        error,
        {
          isRetryable: true,
          message: `Network error connecting to SAP AI Core: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
        },
        context,
      );
    }

    if (errorMsg.includes("could not resolve destination")) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message:
            `SAP AI Core destination error: ${originalErrorMsg}\n\n` +
            `Check your destination configuration or provide a valid destinationName.`,
          statusCode: HTTP_STATUS.BAD_REQUEST,
        },
        context,
      );
    }

    if (
      errorMsg.includes("failed to resolve deployment") ||
      errorMsg.includes("no deployment matched")
    ) {
      const modelId = extractModelIdentifier(originalErrorMsg);
      return new NoSuchModelError({
        message:
          `SAP AI Core deployment error: ${originalErrorMsg}\n\n` +
          `Make sure you have a running orchestration deployment in your AI Core instance.\n` +
          `See: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-deployment-for-orchestration`,
        modelId: modelId ?? "unknown",
        modelType: "languageModel",
      });
    }

    if (errorMsg.includes("filtered by the output filter")) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message:
            `Content was filtered: ${originalErrorMsg}\n\n` +
            `The model's response was blocked by content safety filters. Try a different prompt.`,
          statusCode: HTTP_STATUS.BAD_REQUEST,
        },
        context,
      );
    }

    const statusMatch = /status code (\d+)/i.exec(originalErrorMsg);
    if (statusMatch) {
      const extractedStatus = Number.parseInt(statusMatch[1], 10);
      return createAPICallError(
        error,
        {
          isRetryable: isRetryable(extractedStatus),
          message: `SAP AI Core request failed: ${originalErrorMsg}`,
          statusCode: extractedStatus,
        },
        context,
      );
    }

    if (errorMsg.includes("consumed stream")) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message: `SAP AI Core stream consumption error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.INTERNAL_ERROR,
        },
        context,
      );
    }

    if (
      errorMsg.includes("iterating over") ||
      errorMsg.includes("parse message into json") ||
      errorMsg.includes("received from") ||
      errorMsg.includes("no body") ||
      errorMsg.includes("invalid sse payload")
    ) {
      return createAPICallError(
        error,
        {
          isRetryable: true,
          message: `SAP AI Core streaming error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.INTERNAL_ERROR,
        },
        context,
      );
    }

    if (
      errorMsg.includes("prompt template or messages must be defined") ||
      errorMsg.includes("filtering parameters cannot be empty") ||
      errorMsg.includes("templating yaml string must be non-empty") ||
      errorMsg.includes("could not access response data") ||
      errorMsg.includes("could not parse json") ||
      errorMsg.includes("error parsing yaml") ||
      errorMsg.includes("yaml does not conform") ||
      errorMsg.includes("validation errors")
    ) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message: `SAP AI Core configuration error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.BAD_REQUEST,
        },
        context,
      );
    }

    if (errorMsg.includes("buffer is not available as globals")) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message: `SAP AI Core environment error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.INTERNAL_ERROR,
        },
        context,
      );
    }

    if (errorMsg.includes("response stream is undefined")) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message: `SAP AI Core response stream error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.INTERNAL_ERROR,
        },
        context,
      );
    }

    if (
      errorMsg.includes("response is required to process") ||
      errorMsg.includes("stream is still open") ||
      errorMsg.includes("data is not available yet")
    ) {
      return createAPICallError(
        error,
        {
          isRetryable: true,
          message: `SAP AI Core response processing error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.INTERNAL_ERROR,
        },
        context,
      );
    }

    if (errorMsg.includes("failed to fetch the list of deployments")) {
      return createAPICallError(
        error,
        {
          isRetryable: true,
          message: `SAP AI Core deployment retrieval error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
        },
        context,
      );
    }

    if (errorMsg.includes("received non-uint8array")) {
      return createAPICallError(
        error,
        {
          isRetryable: false,
          message: `SAP AI Core stream buffer error: ${originalErrorMsg}`,
          statusCode: HTTP_STATUS.INTERNAL_ERROR,
        },
        context,
      );
    }
  }

  const message =
    rootError instanceof Error
      ? rootError.message
      : typeof rootError === "string"
        ? rootError
        : "Unknown error occurred";

  const fullMessage = context?.operation
    ? `SAP AI Core ${context.operation} failed: ${message}`
    : `SAP AI Core error: ${message}`;

  return createAPICallError(
    error,
    {
      isRetryable: false,
      message: fullMessage,
      statusCode: HTTP_STATUS.INTERNAL_ERROR,
    },
    context,
  );
}

/**
 * Normalizes various header formats to a string record.
 * @param headers - The headers to normalize (various formats accepted).
 * @returns The normalized headers, or undefined if empty or invalid.
 */
export function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  const record = headers as Record<string, unknown>;
  const entries = Object.entries(record).flatMap(([key, value]) => {
    if (typeof value === "string") return [[key, value]];
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === "string").join("; ");
      return strings.length > 0 ? [[key, strings]] : [];
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return [[key, String(value)]];
    }
    return [];
  });

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Creates an APICallError with automatic response extraction and optional message enrichment.
 * @param error - The original error to extract response data from.
 * @param options - Error configuration options.
 * @param options.enrichMessage - Whether to append response body to message.
 * @param options.isRetryable - Whether the error should be retried.
 * @param options.message - The error message.
 * @param options.statusCode - The HTTP status code.
 * @param context - Optional context for error details.
 * @param context.operation - The operation that failed.
 * @param context.requestBody - The original request body.
 * @param context.responseHeaders - Pre-extracted response headers (if available).
 * @param context.url - The request URL.
 * @returns A configured APICallError instance with extracted response data.
 * @internal
 */
function createAPICallError(
  error: unknown,
  options: {
    enrichMessage?: boolean;
    isRetryable: boolean;
    message: string;
    statusCode: number;
  },
  context?: {
    operation?: string;
    requestBody?: unknown;
    responseHeaders?: Record<string, string>;
    url?: string;
  },
): APICallError {
  const responseBody = getAxiosResponseBody(error);
  const responseHeaders = context?.responseHeaders ?? getAxiosResponseHeaders(error);

  const enrichMessage = options.enrichMessage ?? true;
  const message =
    enrichMessage && responseBody
      ? `${options.message}\n\nSAP AI Core Error Response:\n${responseBody}`
      : options.message;

  return new APICallError({
    cause: error,
    isRetryable: options.isRetryable,
    message: message,
    requestBodyValues: context?.requestBody,
    responseBody,
    responseHeaders,
    statusCode: options.statusCode,
    url: context?.url ?? "",
  });
}

/**
 * Extracts model identifier from error message or location.
 * @param message - The error message to parse.
 * @param location - Optional error location string.
 * @returns The extracted model identifier, or undefined if not found.
 * @internal
 */
function extractModelIdentifier(message: string, location?: string): string | undefined {
  const patterns = [
    /deployment[:\s]+([a-zA-Z0-9_-]+)/i,
    /model[:\s]+([a-zA-Z0-9_-]+)/i,
    /resource[:\s]+([a-zA-Z0-9_-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[1]) {
      return match[1];
    }
  }

  if (location) {
    const locationMatch = /([a-zA-Z0-9_-]+)/.exec(location);
    if (locationMatch?.[1]) {
      return locationMatch[1];
    }
  }

  return undefined;
}

/**
 * Extracts the root cause from an error, handling ErrorWithCause chains.
 * @param error - The error to extract the root cause from.
 * @returns The root cause if it's an axios error, undefined otherwise.
 * @internal
 */
function getAxiosError(
  error: unknown,
): undefined | { isAxiosError: true; response?: { data?: unknown; headers?: unknown } } {
  if (!(error instanceof Error)) return undefined;

  const rootCause = isErrorWithCause(error) ? error.rootCause : error;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- typeof null === "object" in JS
  if (typeof rootCause !== "object" || rootCause === null) return undefined;

  const maybeAxios = rootCause as {
    isAxiosError?: boolean;
    response?: { data?: unknown; headers?: unknown };
  };

  if (maybeAxios.isAxiosError !== true) return undefined;
  return maybeAxios as { isAxiosError: true; response?: { data?: unknown; headers?: unknown } };
}

/**
 * Extracts and formats axios response body from an error.
 * @param error - The error to extract response body from.
 * @returns The formatted response body, or undefined if not available.
 * @internal
 */
function getAxiosResponseBody(error: unknown): string | undefined {
  const axiosError = getAxiosError(error);
  if (!axiosError?.response?.data) return undefined;
  return serializeAxiosResponseData(axiosError.response.data);
}

/**
 * Extracts response headers from an Axios error.
 * @param error - The error to extract headers from.
 * @returns The response headers, or undefined if not available.
 * @internal
 */
function getAxiosResponseHeaders(error: unknown): Record<string, string> | undefined {
  const axiosError = getAxiosError(error);
  if (!axiosError) return undefined;
  return normalizeHeaders(axiosError.response?.headers);
}

/**
 * Maps SAP error codes to HTTP status codes (100-599 range, fallback to 500).
 * @param code - The SAP error code to map.
 * @returns The corresponding HTTP status code (500 if unmappable).
 * @internal
 */
function getStatusCodeFromSAPError(code?: number): number {
  if (!code) return HTTP_STATUS.INTERNAL_ERROR;

  if (code >= 100 && code < 600) {
    return code;
  }

  return HTTP_STATUS.INTERNAL_ERROR;
}

/**
 * Type guard for SAP AI SDK OrchestrationErrorResponse.
 * @param error - The value to check.
 * @returns True if the value is an OrchestrationErrorResponse.
 * @internal
 */
function isOrchestrationErrorResponse(error: unknown): error is OrchestrationErrorResponse {
  if (error === null || typeof error !== "object" || !("error" in error)) {
    return false;
  }

  const errorEnvelope = error as { error?: unknown };
  const innerError = errorEnvelope.error;

  if (innerError === undefined) return false;

  if (Array.isArray(innerError)) {
    return innerError.every((entry) => {
      if (entry === null || typeof entry !== "object" || !("message" in entry)) {
        return false;
      }
      const errorEntry = entry as { code?: unknown; message?: unknown };
      if (typeof errorEntry.message !== "string") {
        return false;
      }
      if ("code" in entry && typeof errorEntry.code !== "number") {
        return false;
      }
      return true;
    });
  }

  if (typeof innerError !== "object" || innerError === null || !("message" in innerError)) {
    return false;
  }

  const errorObj = innerError as { code?: unknown; message?: unknown };
  if (typeof errorObj.message !== "string") {
    return false;
  }
  if ("code" in innerError && typeof errorObj.code !== "number") {
    return false;
  }

  return true;
}

/**
 * Checks if HTTP status code is retryable (408, 409, 429, 5xx).
 * @param statusCode - The HTTP status code to check.
 * @returns True if the request should be retried.
 * @internal
 */
function isRetryable(statusCode: number): boolean {
  return (
    statusCode === HTTP_STATUS.REQUEST_TIMEOUT ||
    statusCode === HTTP_STATUS.CONFLICT ||
    statusCode === HTTP_STATUS.RATE_LIMIT ||
    (statusCode >= HTTP_STATUS.INTERNAL_ERROR && statusCode < 600)
  );
}

/**
 * Serializes and truncates axios response data for error messages.
 * @param data - The response data to serialize.
 * @param maxLength - Maximum length before truncation.
 * @returns Serialized and truncated string, or undefined if data is undefined.
 * @internal
 */
function serializeAxiosResponseData(data: unknown, maxLength = 2000): string | undefined {
  if (data === undefined) return undefined;

  let serialized: string;
  try {
    if (typeof data === "string") {
      serialized = data;
    } else {
      serialized = JSON.stringify(data, null, 2);
    }
  } catch {
    serialized = `[Unable to serialize: ${typeof data}]`;
  }

  if (serialized.length > maxLength) {
    return serialized.slice(0, maxLength) + "...[truncated]";
  }
  return serialized;
}

/**
 * Attempts to extract a SAP error from an error message.
 * @param message - The error message to parse for embedded JSON.
 * @returns The extracted error object, or null if not found.
 * @internal
 */
function tryExtractSAPErrorFromMessage(message: string): unknown {
  const jsonMatch = /\{[\s\S]*\}/.exec(message);
  if (!jsonMatch) return null;

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);

    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return parsed;
    }

    if (parsed && typeof parsed === "object" && "message" in parsed) {
      return { error: parsed as Record<string, unknown> };
    }

    return null;
  } catch {
    return null;
  }
}

export type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";
