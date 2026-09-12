/** Error conversion utilities for SAP AI Core to Vercel AI SDK error types. */
import type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

import {
  APICallError,
  InvalidPromptError,
  LoadAPIKeyError,
  NoSuchModelError,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider";
import { isErrorWithCause } from "@sap-cloud-sdk/util";

import type { SAPAIApiType } from "./sap-ai-settings.js";

interface AxiosResponse {
  data?: unknown;
  headers?: unknown;
  status?: number;
}

/** Request metadata used when translating SAP failures. */
interface ErrorContext {
  httpStatusCode?: number;
  modelId?: string;
  modelType?: "embeddingModel" | "languageModel";
  operation?: string;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  url?: string;
}

/** Diagnostic response body is retained explicitly, never appended to the message. */
interface ResolvedErrorContext extends ErrorContext {
  responseBody?: string;
}

/**
 * @internal
 */
const HTTP_STATUS = {
  BAD_REQUEST: 400,
  CLIENT_CLOSED_REQUEST: 499,
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
 * // Rejects the request: content filtering requires the Orchestration API.
 * ```
 * @see {@link validateSettings} - Main validation function that throws this error
 * @see {@link ApiSwitchError} - Related error for API switching conflicts
 */
export class UnsupportedFeatureError extends Error {
  /**
   * Creates a new UnsupportedFeatureError.
   * @param feature - The name of the unsupported feature (e.g., "Content filtering").
   * @param api - The API being used that does not support the feature.
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
    super(`${feature} is not supported by ${apiName} API. Use ${suggestedApiName} API instead.`);
    this.name = "UnsupportedFeatureError";
  }
}

/**
 * Converts a structured SAP error response to the appropriate Vercel AI SDK error.
 * @param errorResponse - SAP orchestration error response.
 * @param context - Request context.
 * @param context.modelId - Known requested model ID, preferred over message-based extraction.
 * @param context.modelType - Requested model kind (defaults to languageModel).
 * @param context.httpStatusCode - Fallback HTTP status when the body code is missing or outside the HTTP status range.
 * @param context.requestBody - Original request body.
 * @param context.responseHeaders - Response headers.
 * @param context.url - Request URL.
 * @returns LoadAPIKeyError for 401/403, NoSuchModelError for 404, or APICallError otherwise.
 */
export function convertSAPErrorToAPICallError(
  errorResponse: OrchestrationErrorResponse,
  context?: ErrorContext,
): APICallError | LoadAPIKeyError | NoSuchModelError {
  const { code, location, message, requestId } = extractErrorFields(errorResponse);

  const statusCode = getStatusCodeFromSAPError(code, context?.httpStatusCode);

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
    const modelId = context?.modelId ?? extractModelIdentifier(message, location);
    return new NoSuchModelError({
      message: enhancedMessage,
      modelId: modelId ?? "unknown",
      modelType: context?.modelType ?? "languageModel",
    });
  }

  if (statusCode === HTTP_STATUS.RATE_LIMIT) {
    enhancedMessage +=
      "\n\nRate limit exceeded. Please try again later or contact your SAP administrator." +
      "\nSee: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/rate-limits";
  } else if (statusCode >= HTTP_STATUS.INTERNAL_ERROR) {
    enhancedMessage +=
      "\n\nSAP AI Core service error. This is typically a temporary issue. Retries depend on the caller's retry configuration." +
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
 * Converts SAP failures while preserving standard request and API errors across SDK versions.
 * @param error - Error to convert.
 * @param context - Request context.
 * @param context.modelId - Known requested model ID, preferred over message-based extraction.
 * @param context.modelType - Requested model kind (defaults to languageModel).
 * @param context.operation - Operation name.
 * @param context.requestBody - Original request body.
 * @param context.responseHeaders - Response headers.
 * @param context.url - Request URL.
 * @returns Vercel AI SDK error.
 */
export function convertToAISDKError(
  error: unknown,
  context?: ErrorContext,
):
  | APICallError
  | InvalidPromptError
  | LoadAPIKeyError
  | NoSuchModelError
  | UnsupportedFunctionalityError {
  if (
    APICallError.isInstance(error) ||
    LoadAPIKeyError.isInstance(error) ||
    NoSuchModelError.isInstance(error) ||
    InvalidPromptError.isInstance(error) ||
    UnsupportedFunctionalityError.isInstance(error)
  ) {
    return error;
  }

  const { aborted, response, rootError } = inspectError(error);
  const responseHeaders = context?.responseHeaders ?? normalizeHeaders(response?.headers);
  if (!aborted) {
    const errorResponse = findStructuredErrorResponse(
      rootError instanceof SyntaxError ? undefined : rootError,
      response?.data,
    );
    if (errorResponse) {
      return convertSAPErrorToAPICallError(errorResponse, {
        ...context,
        httpStatusCode: response?.status ?? context?.httpStatusCode,
        responseHeaders,
      });
    }
  }

  const resolvedContext: ResolvedErrorContext = {
    ...context,
    responseBody: serializeAxiosResponseData(response?.data),
    responseHeaders,
  };
  if (aborted) {
    return createAPICallError(
      error,
      {
        isRetryable: false,
        message: "Request was aborted by the client",
        statusCode: HTTP_STATUS.CLIENT_CLOSED_REQUEST,
      },
      resolvedContext,
    );
  }

  if (isHttpStatus(response?.status)) {
    return createAPICallError(
      error,
      {
        isRetryable: isRetryable(response.status),
        message:
          rootError instanceof SyntaxError && error instanceof Error
            ? error.message
            : rootError instanceof Error
              ? rootError.message
              : "SAP AI Core request failed",
        statusCode: response.status,
      },
      resolvedContext,
    );
  }

  // Native parser messages can contain credential or response fragments. Keep the
  // enclosing SDK message instead, with the original chain available only as cause.
  if (rootError instanceof SyntaxError) {
    return createAPICallError(
      error,
      {
        isRetryable: false,
        message:
          error instanceof Error && error !== rootError
            ? error.message
            : "Failed to parse SAP AI Core data.",
        statusCode: HTTP_STATUS.INTERNAL_ERROR,
      },
      resolvedContext,
    );
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
      const modelId = context?.modelId ?? extractModelIdentifier(originalErrorMsg);
      return new NoSuchModelError({
        message:
          `SAP AI Core deployment error: ${originalErrorMsg}\n\n` +
          `Make sure you have a running orchestration deployment in your SAP AI Core instance.\n` +
          `See: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-deployment-for-orchestration`,
        modelId: modelId ?? "unknown",
        modelType: context?.modelType ?? "languageModel",
      });
    }

    const statusMatch = /status code (\d+)/i.exec(originalErrorMsg);
    const extractedStatus = statusMatch?.[1] ? Number.parseInt(statusMatch[1], 10) : undefined;
    if (isHttpStatus(extractedStatus)) {
      return createAPICallError(
        error,
        {
          isRetryable: isRetryable(extractedStatus),
          message: `SAP AI Core request failed: ${originalErrorMsg}`,
          statusCode: extractedStatus,
        },
        resolvedContext,
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
          resolvedContext,
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
    resolvedContext,
  );
}

/**
 * Normalizes various header formats to a string record.
 * @param headers - Headers to normalize.
 * @returns Normalized headers record.
 */
export function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out = Object.fromEntries(headers.entries());
    return Object.keys(out).length === 0 ? undefined : out;
  }

  const record = headers as Record<string, unknown>;
  const entries = Object.entries(record).flatMap(([key, value]) => {
    const k = key.toLowerCase();
    if (typeof value === "string") return [[k, value]];
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === "string").join("; ");
      return strings.length > 0 ? [[k, strings]] : [];
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return [[k, String(value)]];
    }
    return [];
  });

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Builds an API error with diagnostics kept separate from the message.
 * @param error - Original error.
 * @param options - Error options.
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
    isRetryable: boolean;
    message: string;
    statusCode: number;
  },
  context?: ResolvedErrorContext,
): APICallError {
  return new APICallError({
    cause: error,
    isRetryable: options.isRetryable,
    message: options.message,
    requestBodyValues: context?.requestBody,
    responseBody: context?.responseBody,
    responseHeaders: context?.responseHeaders,
    statusCode: options.statusCode,
    url: context?.url ?? "",
  });
}

/**
 * @param response - SAP orchestration error response.
 * @returns Destructured error fields (message, code, location, requestId).
 * @internal
 */
function extractErrorFields(response: OrchestrationErrorResponse): {
  code?: number;
  location?: string;
  message: string;
  requestId?: string;
} {
  const innerError = response.error;
  if (Array.isArray(innerError)) {
    const first = innerError[0] as
      undefined | { code?: number; location?: string; message: string; request_id?: string };
    return {
      code: first?.code,
      location: first?.location,
      message: first?.message ?? "Unknown SAP AI error",
      requestId: first?.request_id,
    };
  }
  const entry = innerError as {
    code?: number;
    location?: string;
    message: string;
    request_id?: string;
  };
  return {
    code: entry.code,
    location: entry.location,
    message: entry.message,
    requestId: entry.request_id,
  };
}

/**
 * @param message - Error message.
 * @param location - Error location.
 * @returns Extracted model identifier.
 * @internal
 */
function extractModelIdentifier(message: string, location?: string): string | undefined {
  const patterns = [
    /deployment[:\s]+([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/i,
    /model[:\s]+([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/i,
    /resource[:\s]+([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[1]) {
      return match[1];
    }
  }

  if (location) {
    const locationMatch = /([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)/.exec(location);
    if (locationMatch?.[1]) {
      return locationMatch[1];
    }
  }

  return undefined;
}

/**
 * @param rootError - Root cause after inspecting the chain.
 * @param axiosData - Response data retained from an Axios wrapper.
 * @returns A structured SAP response when available.
 */
function findStructuredErrorResponse(
  rootError: unknown,
  axiosData: unknown,
): OrchestrationErrorResponse | undefined {
  if (isStructuredErrorResponse(rootError)) return rootError;
  if (isStructuredErrorResponse(axiosData)) return axiosData;
  if (rootError instanceof Error) {
    const parsed = tryExtractSAPErrorFromMessage(rootError.message);
    if (isStructuredErrorResponse(parsed)) return parsed;
  }
  return undefined;
}

/**
 * @param code - SAP error code.
 * @param httpStatusCode - HTTP status code from the response, used as fallback.
 * @returns HTTP status code.
 * @internal
 */
function getStatusCodeFromSAPError(code?: number, httpStatusCode?: number): number {
  if (isHttpStatus(code)) {
    return code;
  }

  if (isHttpStatus(httpStatusCode)) {
    return httpStatusCode;
  }

  return HTTP_STATUS.INTERNAL_ERROR;
}

/**
 * Inspects native and SAP cause chains once, keeping transport metadata from wrappers.
 * @param error - Raw SDK error.
 * @returns The terminal cause, nearest Axios response, and cancellation state.
 */
function inspectError(error: unknown): {
  aborted: boolean;
  response?: AxiosResponse;
  rootError: unknown;
} {
  const seen = new Set<object>();
  let rootError = error;
  let current = error;
  let response: AxiosResponse | undefined;
  let aborted = false;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    rootError = current;
    aborted ||= isAbortError(current);
    const entry = current as { cause?: unknown; isAxiosError?: boolean; response?: AxiosResponse };
    if (response === undefined && entry.isAxiosError === true) response = entry.response;
    // SAP ErrorWithCause exposes a native cause too. Avoid its recursive rootCause
    // getter when that cause is present so cyclic chains cannot overflow the stack.
    const cause =
      "cause" in entry
        ? entry.cause
        : current instanceof Error && isErrorWithCause(current)
          ? current.rootCause
          : undefined;
    if (cause === undefined || (typeof cause === "object" && cause !== null && seen.has(cause))) {
      break;
    }
    rootError = cause;
    current = cause;
  }
  return { aborted, response, rootError };
}

/**
 * Identifies native aborts and Axios cancellations retained in SAP error causes.
 * @param error - Error to check.
 * @returns Whether the error represents request cancellation.
 * @internal
 */
function isAbortError(error: object): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  const transportError = error as { code?: unknown; isAxiosError?: unknown };
  return transportError.isAxiosError === true && transportError.code === "ERR_CANCELED";
}

/**
 * @param status - Candidate HTTP status.
 * @returns Whether the value is an integer HTTP status.
 */
function isHttpStatus(status: unknown): status is number {
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status < 600;
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
 * @param error - Error to check.
 * @returns True if error is an orchestration error response.
 * @internal
 */
function isStructuredErrorResponse(error: unknown): error is OrchestrationErrorResponse {
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
      if ("code" in entry && errorEntry.code != null && typeof errorEntry.code !== "number") {
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
  if ("code" in innerError && errorObj.code != null && typeof errorObj.code !== "number") {
    return false;
  }

  return true;
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
      const json: unknown = JSON.stringify(data, null, 2);
      serialized = typeof json === "string" ? json : `[Unable to serialize: ${typeof data}]`;
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
  const startIdx = message.indexOf("{");
  if (startIdx === -1) return null;

  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < message.length; i++) {
    const character = message.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (character === 0x5c) escaped = true;
      else if (character === 0x22) inString = false;
      continue;
    }
    if (character === 0x22) inString = true;
    else if (character === 0x7b) depth++;
    else if (character === 0x7d) {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return null;

  try {
    const parsed: unknown = JSON.parse(message.slice(startIdx, endIdx + 1));

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
