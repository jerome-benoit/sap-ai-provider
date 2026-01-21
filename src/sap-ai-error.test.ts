/**
 * Tests for SAP AI Core error conversion to AI SDK error types.
 */
import type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { convertSAPErrorToAPICallError, convertToAISDKError } from "./sap-ai-error";

interface ParsedResponseBody {
  error: {
    code?: number;
    location?: string;
    message?: string;
    request_id?: string;
  };
}

describe("convertSAPErrorToAPICallError", () => {
  describe("basic conversion", () => {
    it("should convert SAP error with single error object", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 500,
          location: "LLM Module",
          message: "Test error message",
          request_id: "test-request-123",
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError) {
        expect(result.statusCode).toBe(500);
        expect(result.isRetryable).toBe(true);
      }
      expect(result.message).toContain("Test error message");
    });

    it("should convert SAP error with error list (array)", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: [
          {
            code: 400,
            location: "Input Module",
            message: "First error",
            request_id: "test-request-456",
          },
        ],
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError) {
        expect(result.statusCode).toBe(400);
      }
      expect(result.message).toContain("First error");
    });

    it("should handle error list with multiple entries (uses first)", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: [
          {
            code: 400,
            location: "First Module",
            message: "First error in list",
            request_id: "first-123",
          },
          {
            code: 500,
            location: "Second Module",
            message: "Second error in list",
            request_id: "second-456",
          },
        ],
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result.message).toContain("First error in list");
      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError) {
        expect(result.statusCode).toBe(400);
      }
    });
  });

  describe("retryable status codes", () => {
    it.each([
      { code: 408, description: "Request Timeout" },
      { code: 409, description: "Conflict" },
      { code: 429, description: "Rate Limit" },
      { code: 500, description: "Internal Server Error" },
      { code: 502, description: "Bad Gateway" },
      { code: 503, description: "Service Unavailable" },
      { code: 504, description: "Gateway Timeout" },
    ])("should mark $code ($description) errors as retryable", ({ code }) => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code,
          location: "Gateway",
          message: `Error ${String(code)}`,
          request_id: `error-${String(code)}`,
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError) {
        expect(result.statusCode).toBe(code);
        expect(result.isRetryable).toBe(true);
      }
    });
  });

  describe("authentication errors", () => {
    it.each([
      { code: 401, description: "Unauthorized" },
      { code: 403, description: "Forbidden" },
    ])("should convert $code ($description) errors to LoadAPIKeyError", ({ code }) => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code,
          location: "Auth",
          message: `${String(code)} error`,
          request_id: `error-${String(code)}`,
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result).toBeInstanceOf(LoadAPIKeyError);
      expect(result.message).toContain("Authentication failed");
      expect(result.message).toContain("AICORE_SERVICE_KEY");
    });
  });

  describe("not found errors", () => {
    it("should convert 404 errors to NoSuchModelError", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 404,
          location: "Deployment",
          message: "Model deployment-abc-123 not found",
          request_id: "error-404",
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result).toBeInstanceOf(NoSuchModelError);
      expect(result.message).toContain("Resource not found");
      if (result instanceof NoSuchModelError) {
        expect(result.modelId).toBe("deployment-abc-123");
        expect(result.modelType).toBe("languageModel");
      }
    });
  });

  describe("context handling", () => {
    it("should preserve SAP metadata in responseBody", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 500,
          location: "Test Module",
          message: "Test error",
          request_id: "metadata-test-123",
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError && result.responseBody) {
        const body = JSON.parse(result.responseBody) as ParsedResponseBody;
        expect(body.error.message).toBe("Test error");
        expect(body.error.code).toBe(500);
        expect(body.error.location).toBe("Test Module");
        expect(body.error.request_id).toBe("metadata-test-123");
      }
    });

    it("should add context URL, headers, and requestBody to error", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: { code: 500, location: "Module", message: "Test error", request_id: "context-test" },
      };

      const result = convertSAPErrorToAPICallError(errorResponse, {
        requestBody: { prompt: "test" },
        responseHeaders: { "x-request-id": "test-123" },
        url: "https://api.sap.com/v1/chat",
      });

      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError) {
        expect(result.url).toBe("https://api.sap.com/v1/chat");
        expect(result.responseHeaders).toEqual({ "x-request-id": "test-123" });
        expect(result.requestBodyValues).toEqual({ prompt: "test" });
      }
    });

    it("should add request ID to error message", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 500,
          location: "Module",
          message: "Test error",
          request_id: "message-test-123",
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result.message).toContain("Request ID: message-test-123");
    });
  });

  describe("missing fields handling", () => {
    it.each([
      {
        errorResponse: { error: { message: "Unknown error", request_id: "unknown-123" } },
        expectedRetryable: true,
        expectedStatus: 500,
        field: "code",
      },
      {
        errorResponse: { error: { code: 400, message: "Error without location" } },
        expectedStatus: 400,
        field: "location",
        notContains: "Error location:",
      },
      {
        errorResponse: { error: { code: 400, message: "Error without request ID" } },
        expectedStatus: 400,
        field: "request_id",
        notContains: "Request ID:",
      },
    ])(
      "should handle error without $field",
      ({ errorResponse, expectedRetryable, expectedStatus, notContains }) => {
        const result = convertSAPErrorToAPICallError(
          errorResponse as unknown as OrchestrationErrorResponse,
        );

        expect(result).toBeInstanceOf(APICallError);
        if (result instanceof APICallError) {
          expect(result.statusCode).toBe(expectedStatus);
          if (expectedRetryable !== undefined) {
            expect(result.isRetryable).toBe(expectedRetryable);
          }
        }
        if (notContains) {
          expect(result.message).not.toContain(notContains);
        }
      },
    );

    it("should include location in error message for 4xx errors", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 400,
          location: "Input Validation",
          message: "Bad request",
          request_id: "validation-123",
        },
      };

      const result = convertSAPErrorToAPICallError(errorResponse);

      expect(result.message).toContain("Error location: Input Validation");
    });
  });
});

describe("convertToAISDKError", () => {
  describe("passthrough", () => {
    it.each([
      {
        error: new APICallError({
          message: "Test",
          requestBodyValues: {},
          statusCode: 500,
          url: "https://test.com",
        }),
        type: "APICallError",
      },
      { error: new LoadAPIKeyError({ message: "API key error" }), type: "LoadAPIKeyError" },
      {
        error: new NoSuchModelError({
          message: "No model",
          modelId: "test",
          modelType: "languageModel",
        }),
        type: "NoSuchModelError",
      },
    ])("should return $type as-is", ({ error }) => {
      const result = convertToAISDKError(error);
      expect(result).toBe(error);
    });
  });

  describe("orchestration error conversion", () => {
    it("should convert OrchestrationErrorResponse", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 500,
          location: "Module",
          message: "Orchestration error",
          request_id: "conversion-test-123",
        },
      };

      const result = convertToAISDKError(errorResponse);

      expect(result).toBeInstanceOf(APICallError);
      expect(result.message).toContain("Orchestration error");
    });

    it.each([
      { desc: "non-string message", errorObject: { error: { message: 123 } } },
      { desc: "array with non-object entries", errorObject: { error: ["not an object"] } },
      { desc: "array with null entries", errorObject: { error: [null, { message: "valid" }] } },
      { desc: "array with entries missing message", errorObject: { error: [{ code: 400 }] } },
      {
        desc: "array with non-string message",
        errorObject: { error: [{ message: { nested: "object" } }] },
      },
      { desc: "undefined error property", errorObject: { error: undefined } },
    ])("should not treat $desc as orchestration errors", ({ errorObject }) => {
      const result = convertToAISDKError(errorObject);

      expect(result).toBeInstanceOf(APICallError);
      expect((result as APICallError).statusCode).toBe(500);
    });
  });

  describe("authentication error detection", () => {
    it.each([
      "Authentication failed for AICORE_SERVICE_KEY",
      "Request unauthorized",
      "Invalid credentials provided",
      "Service credentials not found",
      "Service binding error",
    ])("should convert '%s' to LoadAPIKeyError", (message) => {
      const result = convertToAISDKError(new Error(message));

      expect(result).toBeInstanceOf(LoadAPIKeyError);
      expect(result.message).toContain("SAP AI Core authentication failed");
    });
  });

  describe("network error detection", () => {
    it.each([
      { desc: "ECONNREFUSED", message: "ECONNREFUSED: Connection refused" },
      { desc: "ENOTFOUND", message: "getaddrinfo ENOTFOUND api.sap.com" },
      { desc: "network", message: "NETWORK connection failed" },
      { desc: "timeout", message: "Request timeout exceeded" },
    ])("should convert $desc errors to retryable APICallError", ({ message }) => {
      const result = convertToAISDKError(new Error(message));

      expect(result).toBeInstanceOf(APICallError);
      expect((result as APICallError).isRetryable).toBe(true);
      expect((result as APICallError).statusCode).toBe(503);
    });

    it("should include response body for network errors when available", () => {
      const axiosError = new Error("Network timeout");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: {
            code: 503,
            message: "Service temporarily unavailable",
          },
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(503);
      expect(result.responseBody).toBeDefined();
      expect(result.message).toContain("SAP AI Core Error Response:");
      expect(result.message).toContain("Service temporarily unavailable");
    });
  });

  describe("generic error handling", () => {
    it("should convert generic errors to non-retryable APICallError", () => {
      const result = convertToAISDKError(new Error("Something went wrong"));

      expect(result).toBeInstanceOf(APICallError);
      expect((result as APICallError).isRetryable).toBe(false);
      expect((result as APICallError).statusCode).toBe(500);
    });

    it.each([
      { desc: "string", value: "An error occurred" },
      { desc: "null", value: null },
      { desc: "undefined", value: undefined },
      { desc: "number", value: 42 },
      { desc: "unknown object", value: { weird: "object" } },
    ])("should handle $desc error values", ({ value }) => {
      const result = convertToAISDKError(value);

      expect(result).toBeInstanceOf(APICallError);
      if (typeof value === "string") {
        expect(result.message).toContain(value);
      } else {
        expect(result.message).toContain("Unknown error occurred");
      }
    });
  });

  describe("context handling", () => {
    it("should add operation context to error message", () => {
      const result = convertToAISDKError(new Error("Test error"), { operation: "doGenerate" });
      expect(result.message).toContain("doGenerate");
    });

    it("should handle error without operation context", () => {
      const result = convertToAISDKError(new Error("Simple error"));
      expect(result.message).toContain("SAP AI Core error:");
      expect(result.message).not.toContain("undefined");
    });

    it("should pass through context URL and requestBody", () => {
      const result = convertToAISDKError(new Error("Test"), {
        operation: "doStream",
        requestBody: { test: "data" },
        url: "https://api.sap.com",
      }) as APICallError;

      expect(result.url).toBe("https://api.sap.com");
      expect(result.requestBodyValues).toEqual({ test: "data" });
    });

    it("should preserve response headers from context", () => {
      const result = convertToAISDKError(new Error("Request failed"), {
        responseHeaders: { "x-request-id": "axios-123" },
      }) as APICallError;

      expect(result.responseHeaders).toEqual({ "x-request-id": "axios-123" });
    });
  });

  describe("axios header normalization", () => {
    const createAxiosError = (headers: Record<string, unknown>) => {
      const err = new Error("Request failed") as unknown as {
        isAxiosError: boolean;
        response: { headers: Record<string, unknown> };
      };
      err.isAxiosError = true;
      err.response = { headers };
      return err;
    };

    it.each([
      {
        desc: "array values joined with semicolon",
        expected: { "x-multi": "a; b; c" },
        headers: { "x-multi": ["a", "b", "c"] },
      },
      {
        desc: "non-string values filtered from arrays",
        expected: { "x-mixed": "valid; also" },
        headers: { "x-mixed": ["valid", 123, null, "also"] },
      },
      {
        desc: "arrays with only non-strings excluded",
        expected: { "x-valid": "keep" },
        headers: { "x-invalid": [123, null], "x-valid": "keep" },
      },
      {
        desc: "number values converted to strings",
        expected: { "content-length": "1024" },
        headers: { "content-length": 1024 },
      },
      {
        desc: "boolean values converted to strings",
        expected: { "x-disabled": "false", "x-enabled": "true" },
        headers: { "x-disabled": false, "x-enabled": true },
      },
      {
        desc: "object values skipped",
        expected: { "x-valid": "keep" },
        headers: { "x-object": { nested: "obj" }, "x-valid": "keep" },
      },
    ])("should handle $desc", ({ expected, headers }) => {
      const result = convertToAISDKError(createAxiosError(headers)) as APICallError;
      expect(result.responseHeaders).toEqual(expected);
    });

    it.each([
      { desc: "all unsupported types", headers: { "x-object": { nested: "object" } } },
      { desc: "null headers", headers: null },
    ])("should return undefined for $desc", ({ headers }) => {
      const err = new Error("Request failed") as unknown as {
        isAxiosError: boolean;
        response: { headers: unknown };
      };
      err.isAxiosError = true;
      err.response = { headers };

      const result = convertToAISDKError(err) as APICallError;
      expect(result.responseHeaders).toBeUndefined();
    });

    it("should return undefined when rootCause is not an object", () => {
      const result = convertToAISDKError("just a string error") as APICallError;
      expect(result.responseHeaders).toBeUndefined();
    });
  });
});

describe("sse error handling", () => {
  it("should extract SAP error from SSE message (wrapped format)", () => {
    const sapError = {
      error: {
        code: 429,
        location: "Rate Limiter",
        message: "Too many requests",
        request_id: "sse-error-123",
      },
    };
    const error = new Error(`Error received from the server.\\n${JSON.stringify(sapError)}`);

    const result = convertToAISDKError(error) as APICallError;

    expect(result).toBeInstanceOf(APICallError);
    expect(result.statusCode).toBe(429);
    expect(result.message).toContain("Too many requests");
    expect(result.isRetryable).toBe(true);
    const responseBody = JSON.parse(result.responseBody ?? "{}") as ParsedResponseBody;
    expect(responseBody.error.request_id).toBe("sse-error-123");
  });

  it("should extract SAP error from SSE message (direct format)", () => {
    const sapErrorDirect = {
      code: 503,
      message: "Service unavailable",
      request_id: "sse-direct-123",
    };
    const error = new Error(`Error received from the server.\\n${JSON.stringify(sapErrorDirect)}`);

    const result = convertToAISDKError(error) as APICallError;

    expect(result.statusCode).toBe(503);
    expect(result.isRetryable).toBe(true);
  });

  it("should extract SAP error from ErrorWithCause rootCause", () => {
    const sapError = {
      error: { code: 500, message: "Model overloaded", request_id: "wrapped-123" },
    };
    const innerError = new Error(`Error received from the server.\n${JSON.stringify(sapError)}`);
    const wrappedError = new Error("Error while iterating over SSE stream.");
    Object.defineProperty(wrappedError, "name", { value: "ErrorWithCause" });
    Object.defineProperty(wrappedError, "rootCause", { get: () => innerError });

    const result = convertToAISDKError(wrappedError) as APICallError;

    expect(result.statusCode).toBe(500);
    const responseBody = JSON.parse(result.responseBody ?? "{}") as ParsedResponseBody;
    expect(responseBody.error.request_id).toBe("wrapped-123");
  });

  it.each([
    {
      contains: "stream consumption",
      desc: "stream iteration",
      message: "Cannot iterate over a consumed stream.",
      retryable: false,
    },
    {
      contains: "streaming error",
      desc: "message parsing",
      message: "Could not parse message into JSON",
      retryable: true,
    },
    {
      contains: "streaming error",
      desc: "no body",
      message: "Attempted to iterate over a response with no body",
      retryable: true,
    },
    {
      desc: "malformed JSON",
      message: "Error received from the server.\n{invalid json}",
      status: 500,
    },
  ])("should handle $desc errors", ({ contains, message, retryable, status }) => {
    const result = convertToAISDKError(new Error(message)) as APICallError;

    expect(result).toBeInstanceOf(APICallError);
    if (contains) expect(result.message).toContain(contains);
    if (retryable !== undefined) expect(result.isRetryable).toBe(retryable);
    if (status) expect(result.statusCode).toBe(status);
  });

  it("should handle streaming errors with wrapped parsing failures", () => {
    const innerError = new Error("Could not parse message into JSON");
    const wrappedError = new Error("Error while iterating over SSE stream.");
    Object.defineProperty(wrappedError, "name", { value: "ErrorWithCause" });
    Object.defineProperty(wrappedError, "rootCause", { get: () => innerError });

    const result = convertToAISDKError(wrappedError) as APICallError;

    expect(result.message).toContain("streaming error");
    expect(result.isRetryable).toBe(true);
  });

  it("should traverse nested ErrorWithCause chain", () => {
    const rootError = new Error("Network timeout");
    const topError = new Error("SSE stream error");
    Object.defineProperty(topError, "name", { value: "ErrorWithCause" });
    Object.defineProperty(topError, "rootCause", { get: () => rootError });

    const result = convertToAISDKError(topError) as APICallError;

    expect(result.message).toContain("Network timeout");
  });

  it("should handle server errors received during streaming", () => {
    const serverError = { code: 429, message: "Rate limited", request_id: "test-123" };
    const error = new Error(`Error received from the server.\n${JSON.stringify(serverError)}`);

    const result = convertToAISDKError(error) as APICallError;

    expect(result.statusCode).toBe(429);
    expect(result.isRetryable).toBe(true);
  });
});

describe("sdk-specific error handling", () => {
  describe("destination and deployment errors", () => {
    it("should handle destination resolution errors", () => {
      const result = convertToAISDKError(
        new Error("Could not resolve destination."),
      ) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.isRetryable).toBe(false);
      expect(result.message).toContain("destination");
    });

    it("should handle deployment resolution errors", () => {
      const result = convertToAISDKError(new Error("Failed to resolve deployment: d123abc"));

      expect(result).toBeInstanceOf(NoSuchModelError);
      if (result instanceof NoSuchModelError) {
        expect(result.modelId).toBe("d123abc");
        expect(result.modelType).toBe("languageModel");
      }
    });

    it("should handle ErrorWithCause chain with network error as root", () => {
      const networkError = new Error("getaddrinfo ENOTFOUND api.ai.sap.com");
      const outerError = new Error("Failed to fetch deployments");
      Object.defineProperty(outerError, "name", { value: "ErrorWithCause" });
      Object.defineProperty(outerError, "rootCause", { get: () => networkError });

      const result = convertToAISDKError(outerError) as APICallError;

      expect(result.statusCode).toBe(503);
      expect(result.isRetryable).toBe(true);
    });

    it("should include response body for destination errors", () => {
      const axiosError = new Error("Could not resolve destination");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: {
            error: "DESTINATION_NOT_FOUND",
            message: "Destination 'my-dest' does not exist",
          },
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.responseBody).toBeDefined();
      expect(result.message).toContain("SAP AI Core Error Response:");
      expect(result.message).toContain("DESTINATION_NOT_FOUND");
    });
  });

  describe("content and configuration errors (non-retryable 400)", () => {
    it.each([
      "Content was filtered by the output filter.",
      "Either a prompt template or messages must be defined.",
      "Filtering parameters cannot be empty",
      "Could not access response data. Response was not an axios response.",
      "Could not parse JSON: invalid syntax",
      "Error parsing YAML: unexpected token",
      "Prompt Template YAML does not conform to the defined type. Validation errors: missing required field",
      "Templating YAML string must be non-empty.",
    ])("should handle '%s' as non-retryable 400", (message) => {
      const result = convertToAISDKError(new Error(message)) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.isRetryable).toBe(false);
    });

    it("should include response body for configuration errors", () => {
      const axiosError = new Error("Filtering parameters cannot be empty");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: {
            code: 400,
            details: "At least one filter must be specified",
            message: "Invalid filter configuration",
          },
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.responseBody).toBeDefined();
      expect(result.message).toContain("SAP AI Core Error Response:");
      expect(result.message).toContain("Invalid filter configuration");
    });
  });

  describe("server errors", () => {
    it.each([
      {
        message: "Response is required to process completion post response streaming.",
        retryable: true,
      },
      { message: "Response is required to process stream end.", retryable: true },
      {
        message: "The stream is still open, the requested data is not available yet.",
        retryable: true,
      },
      { message: "Response stream is undefined.", retryable: false },
      { message: "Unexpected: Buffer is not available as globals.", retryable: false },
      {
        message: "Unexpected: received non-Uint8Array (ArrayBuffer) stream chunk",
        retryable: false,
      },
    ])("should handle '$message' with retryable=$retryable", ({ message, retryable }) => {
      const result = convertToAISDKError(new Error(message)) as APICallError;

      expect(result.statusCode).toBe(500);
      expect(result.isRetryable).toBe(retryable);
    });

    it("should handle deployment list fetch error as retryable 503", () => {
      const result = convertToAISDKError(
        new Error("Failed to fetch the list of deployments."),
      ) as APICallError;

      expect(result.statusCode).toBe(503);
      expect(result.isRetryable).toBe(true);
    });

    it("should handle invalid SSE payload errors as retryable 500", () => {
      const result = convertToAISDKError(
        new Error("Invalid SSE payload: malformed event data"),
      ) as APICallError;

      expect(result.statusCode).toBe(500);
      expect(result.isRetryable).toBe(true);
    });
  });

  describe("status code extraction", () => {
    it("should extract status code from error message", () => {
      const result = convertToAISDKError(
        new Error("Request failed with status code 429."),
      ) as APICallError;

      expect(result.statusCode).toBe(429);
      expect(result.isRetryable).toBe(true);
    });

    it("should extract and format axios error response body", () => {
      const axiosError = new Error("Request failed with status code 400.");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: {
            code: 400,
            location: "Input Parameters",
            message:
              "400 - Input Parameters: Error validating parameters. Unused parameters: ['question'].",
            request_id: "258f5390-51f6-93cc-a066-858be2558a64",
          },
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.responseBody).toBeDefined();
      expect(result.message).toContain("SAP AI Core Error Response:");
      expect(result.message).toContain("request_id");
      expect(result.message).toContain("258f5390-51f6-93cc-a066-858be2558a64");
    });

    it("should handle axios error with string response data", () => {
      const axiosError = new Error("Request failed with status code 500.");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: "Internal Server Error",
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(500);
      expect(result.responseBody).toBe("Internal Server Error");
      expect(result.message).toContain("SAP AI Core Error Response:");
      expect(result.message).toContain("Internal Server Error");
    });

    it("should truncate large response bodies", () => {
      const largeData = { error: "x".repeat(3000) };
      const axiosError = new Error("Request failed with status code 400.");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: largeData,
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.responseBody).toBeDefined();
      if (result.responseBody) {
        expect(result.responseBody.length).toBeLessThanOrEqual(2014); // 2000 + "...[truncated]"
      }
      expect(result.responseBody).toContain("...[truncated]");
      expect(result.message).toContain("...[truncated]");
    });

    it("should handle JSON.stringify errors gracefully", () => {
      const circularData: { a: number; self?: unknown } = { a: 1 };
      circularData.self = circularData; // Create circular reference

      const axiosError = new Error("Request failed with status code 400.");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: circularData,
        },
      });

      const result = convertToAISDKError(axiosError) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.responseBody).toBeDefined();
      expect(result.message).toContain("SAP AI Core Error Response:");
      // Should fall back to type indication for circular references
      expect(result.responseBody).toContain("[Unable to serialize: object]");
    });

    it("should extract axios error nested in ErrorWithCause", () => {
      const axiosError = new Error("Request failed with status code 401.");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: {
            code: 401,
            message: "Unauthorized",
          },
        },
      });

      const outerError = new Error("Request failed with status code 401.");
      Object.defineProperty(outerError, "name", { value: "ErrorWithCause" });
      Object.defineProperty(outerError, "rootCause", { get: () => axiosError });

      const result = convertToAISDKError(outerError) as APICallError;

      expect(result.statusCode).toBe(401);
      expect(result.responseBody).toBeDefined();
      expect(result.message).toContain("Unauthorized");
    });

    it("should handle errors without axios response body", () => {
      const simpleError = new Error("Network timeout");

      const result = convertToAISDKError(simpleError) as APICallError;

      expect(result.statusCode).toBe(503);
      expect(result.responseBody).toBeUndefined();
      expect(result.message).not.toContain("SAP AI Core Error Response:");
    });
  });
});
