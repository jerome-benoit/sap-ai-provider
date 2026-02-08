/** Error conversion utilities for SAP AI Core to Vercel AI SDK error types. */
import type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { isErrorWithCause } from "@sap-cloud-sdk/util";

import type { SAPAIApiType } from "./sap-ai-settings.js";

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
 * Error message matchers for categorization and retryability.
 * @internal
 */
const ERROR_MATCHERS = [
  {
    category: "network",
    isRetryable: true,
    keywords: ["econnrefused", "enotfound", "network", "timeout"],
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
  },
  {
    category: "destination",
    isRetryable: false,
    keywords: ["could not resolve destination"],
    message: (original: string) =>
      `SAP AI Core destination error: ${original}\n\n` +
      `Check your destination configuration or provide a valid destinationName.`,
    statusCode: HTTP_STATUS.BAD_REQUEST,
  },
  {
    category: "content filtered",
    isRetryable: false,
    keywords: ["filtered by the output filter"],
    message: (original: string) =>
      `Content was filtered: ${original}\n\n` +
      `The model's response was blocked by content safety filters. Try a different prompt.`,
    statusCode: HTTP_STATUS.BAD_REQUEST,
  },
  {
    category: "stream consumption",
    isRetryable: false,
    keywords: ["consumed stream"],
    statusCode: HTTP_STATUS.INTERNAL_ERROR,
  },
  {
    category: "streaming",
    isRetryable: true,
    keywords: [
      "iterating over",
      "parse message into json",
      "received from",
      "no body",
      "invalid sse payload",
    ],
    statusCode: HTTP_STATUS.INTERNAL_ERROR,
  },
  {
    category: "configuration",
    isRetryable: false,
    keywords: [
      "prompt template or messages must be defined",
      "filtering parameters cannot be empty",
      "templating yaml string must be non-empty",
      "could not access response data",
      "could not parse json",
      "error parsing yaml",
      "yaml does not conform",
      "validation errors",
    ],
    statusCode: HTTP_STATUS.BAD_REQUEST,
  },
  {
    category: "environment",
    isRetryable: false,
    keywords: ["buffer is not available as globals"],
    statusCode: HTTP_STATUS.INTERNAL_ERROR,
  },
  {
    category: "response stream",
    isRetryable: false,
    keywords: ["response stream is undefined"],
    statusCode: HTTP_STATUS.INTERNAL_ERROR,
  },
  {
    category: "response processing",
    isRetryable: true,
    keywords: [
      "response is required to process",
      "stream is still open",
      "data is not available yet",
    ],
    statusCode: HTTP_STATUS.INTERNAL_ERROR,
  },
  {
    category: "deployment retrieval",
    isRetryable: true,
    keywords: ["failed to fetch the list of deployments"],
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
  },
  {
    category: "stream buffer",
    isRetryable: false,
    keywords: ["received non-uint8array"],
    statusCode: HTTP_STATUS.INTERNAL_ERROR,
  },
] as const;

/**
 * Keywords that indicate an authentication error.
 * @internal
 */
const AUTHENTICATION_ERROR_KEYWORDS = [
  "authentication",
  "unauthorized",
  "aicore_service_key",
  "invalid credentials",
  "service credentials",
  "service binding",
] as const;

/**
 * Keywords that indicate a deployment/model resolution error.
 * @internal
 */
const DEPLOYMENT_ERROR_KEYWORDS = [
  "failed to resolve deployment",
  "no deployment matched",
] as const;

/**
 * Error thrown when attempting to switch APIs at invocation time with conflicting model settings.
 * @example
 * ```typescript
 * const model = provider("gpt-4.1", { filtering: { ... } });
 *
 * await generateText({
 *   model,
 *   providerOptions: { [SAP_AI_PROVIDER_NAME]: { api: "foundation-models" } },
 *   prompt: "Hello",
 * });
 * // Throws: ApiSwitchError("orchestration", "foundation-models", "filtering")
 * ```
 * @see {@link validateSettings} - Main validation function that throws this error
 * @see {@link UnsupportedFeatureError} - Related error for features unsupported by an API
 */
export class ApiSwitchError extends Error {
  /**
   * Creates a new ApiSwitchError.
   * @param fromApi - The API the model was configured with.
   * @param toApi - The API being switched to at invocation time.
   * @param conflictingFeature - The feature that prevents the API switch.
   */
  constructor(
    public readonly fromApi: SAPAIApiType,
    public readonly toApi: SAPAIApiType,
    public readonly conflictingFeature: string,
  ) {
    super(
      `Cannot switch from ${fromApi} to ${toApi} API at invocation time because ` +
        `${conflictingFeature} would be ignored. Create a new model instance without ` +
        `${fromApi}-specific features, or keep using the ${fromApi} API.`,
    );
    this.name = "ApiSwitchError";
  }
}

/**
 * Error thrown when a feature is used with an incompatible API.
 * @example
 * ```typescript
 * throw new UnsupportedFeatureError("Content filtering", "foundation-models", "orchestration");
 * // "Content filtering is only available with Orchestration API and will be ignored by Foundation Models API."
 * ```
 * @see {@link validateSettings} - Main validation function that throws this error
 * @see {@link ApiSwitchError} - Related error for API switching conflicts
 */
export class UnsupportedFeatureError extends Error {
  /**
   * Creates a new UnsupportedFeatureError.
   * @param feature - The name of the unsupported feature (e.g., "Content filtering").
   * @param api - The API being used where the feature will be ignored.
   * @param suggestedApi - The API that supports this feature.
   */
  constructor(
    public readonly feature: string,
    public readonly api: SAPAIApiType,
    public readonly suggestedApi: SAPAIApiType,
  ) {
    const apiName = api === "foundation-models" ? "Foundation Models" : "Orchestration";
    const suggestedApiName =
      suggestedApi === "foundation-models" ? "Foundation Models" : "Orchestration";
    super(
      `${feature} is only available with ${suggestedApiName} API and will be ignored by ${apiName} API.`,
    );
    this.name = "UnsupportedFeatureError";
  }
}

/**
 * Converts SAP AI SDK OrchestrationErrorResponse to Vercel AI SDK APICallError.
 * @param errorResponse - SAP orchestration error response.
 * @param context - Request context.
 * @param context.requestBody - Original request body.
 * @param context.responseHeaders - Response headers.
 * @param context.url - Request URL.
 * @returns Vercel AI SDK error.
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
    if (firstError) {
      message = firstError.message;
      code = firstError.code;
      location = firstError.location;
      requestId = firstError.request_id;
    } else {
      message = "Unknown SAP AI error";
    }
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
 * @param error - Error to convert.
 * @param context - Request context.
 * @param context.operation - Operation name.
 * @param context.requestBody - Original request body.
 * @param context.responseHeaders - Response headers.
 * @param context.url - Request URL.
 * @returns Vercel AI SDK error.
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

    if (AUTHENTICATION_ERROR_KEYWORDS.some((keyword) => errorMsg.includes(keyword))) {
      return new LoadAPIKeyError({
        message:
          `SAP AI Core authentication failed: ${originalErrorMsg}\n\n` +
          `Make sure your AICORE_SERVICE_KEY environment variable is set correctly.\n` +
          `See: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-service-key`,
      });
    }

    if (DEPLOYMENT_ERROR_KEYWORDS.some((keyword) => errorMsg.includes(keyword))) {
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

    const statusMatch = /status code (\d+)/i.exec(originalErrorMsg);
    if (statusMatch?.[1]) {
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

    for (const matcher of ERROR_MATCHERS) {
      if (matcher.keywords.some((keyword) => errorMsg.includes(keyword))) {
        const message =
          "message" in matcher
            ? matcher.message(originalErrorMsg)
            : `SAP AI Core ${matcher.category} error: ${originalErrorMsg}`;
        return createAPICallError(
          error,
          {
            isRetryable: matcher.isRetryable,
            message,
            statusCode: matcher.statusCode,
          },
          context,
        );
      }
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
 * @param headers - Headers to normalize.
 * @returns Normalized headers record.
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
 * @param error - Original error.
 * @param options - Error options.
 * @param options.enrichMessage - Whether to enrich message with response body.
 * @param options.isRetryable - Whether error is retryable.
 * @param options.message - Error message.
 * @param options.statusCode - HTTP status code.
 * @param context - Request context.
 * @param context.operation - Operation name.
 * @param context.requestBody - Original request body.
 * @param context.responseHeaders - Response headers.
 * @param context.url - Request URL.
 * @returns API call error.
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
 * @param message - Error message.
 * @param location - Error location.
 * @returns Extracted model identifier.
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
 * @param error - Error to extract Axios error from.
 * @returns Axios error if found.
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
 * @param error - Error to extract response body from.
 * @returns Serialized response body.
 * @internal
 */
function getAxiosResponseBody(error: unknown): string | undefined {
  const axiosError = getAxiosError(error);
  if (!axiosError?.response?.data) return undefined;
  return serializeAxiosResponseData(axiosError.response.data);
}

/**
 * @param error - Error to extract response headers from.
 * @returns Normalized response headers.
 * @internal
 */
function getAxiosResponseHeaders(error: unknown): Record<string, string> | undefined {
  const axiosError = getAxiosError(error);
  if (!axiosError) return undefined;
  return normalizeHeaders(axiosError.response?.headers);
}

/**
 * @param code - SAP error code.
 * @returns HTTP status code.
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
 * @param error - Error to check.
 * @returns True if error is an orchestration error response.
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
 * @param statusCode - HTTP status code.
 * @returns True if error is retryable.
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
 * @param data - Data to serialize.
 * @param maxLength - Maximum output length.
 * @returns Serialized data.
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
 * @param message - Error message to parse.
 * @returns Extracted SAP error or null.
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
