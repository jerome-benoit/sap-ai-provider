/**
 * Tests for SAP AI Core error conversion to AI SDK error types.
 */
import type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import {
  APICallError as APICallErrorV2,
  InvalidPromptError as InvalidPromptErrorV2,
  LoadAPIKeyError as LoadAPIKeyErrorV2,
  NoSuchModelError as NoSuchModelErrorV2,
  UnsupportedFunctionalityError as UnsupportedFunctionalityErrorV2,
} from "@ai-sdk/provider-v2";
import { ErrorWithCause } from "@sap-cloud-sdk/util";
import { describe, expect, it } from "vitest";

import {
  convertSAPErrorToAPICallError,
  convertToAISDKError,
  normalizeHeaders,
} from "./sap-ai-error";

interface ParsedResponseBody {
  error: {
    code?: number;
    location?: string;
    message?: string;
    request_id?: string;
  };
}

describe("normalizeHeaders", () => {
  describe("invalid inputs", () => {
    it.each([
      { description: "null", input: null },
      { description: "undefined", input: undefined },
      { description: "string", input: "string" },
      { description: "number", input: 123 },
    ])("should return undefined for $description input", ({ input }) => {
      expect(normalizeHeaders(input)).toBeUndefined();
    });
  });

  describe("value conversions", () => {
    it.each([
      {
        description: "string values unchanged",
        expected: { "content-type": "application/json", "x-custom": "value" },
        input: { "content-type": "application/json", "x-custom": "value" },
      },
      {
        description: "number values to strings",
        expected: { "content-length": "1024" },
        input: { "content-length": 1024 },
      },
      {
        description: "boolean values to strings",
        expected: { "x-disabled": "false", "x-enabled": "true" },
        input: { "x-disabled": false, "x-enabled": true },
      },
      {
        description: "array values joined with semicolon",
        expected: { "x-multi": "a; b; c" },
        input: { "x-multi": ["a", "b", "c"] },
      },
      {
        description: "arrays with non-string values filtered",
        expected: { "x-mixed": "valid; also" },
        input: { "x-mixed": ["valid", 123, null, "also"] },
      },
    ])("should convert $description", ({ expected, input }) => {
      expect(normalizeHeaders(input)).toEqual(expected);
    });
  });

  describe("exclusions", () => {
    it.each([
      {
        description: "arrays with only non-string values",
        expected: { "x-valid": "keep" },
        input: { "x-invalid": [123, null], "x-valid": "keep" },
      },
      {
        description: "object values",
        expected: { "x-valid": "keep" },
        input: { "x-object": { nested: "obj" }, "x-valid": "keep" },
      },
    ])("should exclude $description", ({ expected, input }) => {
      expect(normalizeHeaders(input)).toEqual(expected);
    });
  });

  describe("empty results", () => {
    it.each([
      { description: "only invalid values", input: { "x-object": { nested: "obj" } } },
      { description: "empty object", input: {} },
    ])("should return undefined for $description", ({ input }) => {
      expect(normalizeHeaders(input)).toBeUndefined();
    });
  });

  describe("case-insensitive keys", () => {
    it("should lower-case all header keys", () => {
      expect(
        normalizeHeaders({
          "Content-Type": "application/json",
          "X-Request-Id": "rid",
          "x-Trace": "t",
        }),
      ).toEqual({
        "content-type": "application/json",
        "x-request-id": "rid",
        "x-trace": "t",
      });
    });

    it("should resolve mixed-case duplicates with last-write-wins", () => {
      expect(normalizeHeaders({ "X-Request-Id": "old", "x-request-id": "new" })).toEqual({
        "x-request-id": "new",
      });
    });

    it("should normalize Web Headers instances", () => {
      const headers = new Headers({
        "Content-Length": "512",
        "X-Request-Id": "rid-123",
      });
      expect(normalizeHeaders(headers)).toEqual({
        "content-length": "512",
        "x-request-id": "rid-123",
      });
    });

    it("should return undefined for an empty Headers instance", () => {
      expect(normalizeHeaders(new Headers())).toBeUndefined();
    });

    it("should preserve prototype-named Web Headers as own data properties", () => {
      const headers = new Headers([["__proto__", "trace"]]);
      const result = normalizeHeaders(headers);
      expect(result).toEqual({ ["__proto__"]: "trace" });
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });
  });
});

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
        expect(result.isRetryable).toBe(false);
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

      expect(result).toBeInstanceOf(APICallError);
      if (result instanceof APICallError) {
        expect(result.statusCode).toBe(400);
        expect(result.isRetryable).toBe(false);
      }
      expect(result.message).toContain("First error in list");
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
      if (result instanceof APICallError) {
        expect(result.responseBody).toBeDefined();
        const body = JSON.parse(result.responseBody ?? "null") as ParsedResponseBody;
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
  });
});

describe("convertToAISDKError", () => {
  describe("passthrough", () => {
    it("should preserve SDK errors from another installed provider version", () => {
      const errors = [
        new APICallErrorV2({
          message: "Capacity exhausted",
          requestBodyValues: { prompt: "hello" },
          responseHeaders: { "retry-after": "7" },
          statusCode: 429,
          url: "https://example.test/chat",
        }),
        new LoadAPIKeyErrorV2({ message: "Missing key" }),
        new NoSuchModelErrorV2({ modelId: "missing", modelType: "languageModel" }),
        new InvalidPromptErrorV2({ message: "Invalid arguments", prompt: "not json" }),
        new UnsupportedFunctionalityErrorV2({ functionality: "file data" }),
      ];

      for (const error of errors) {
        expect(convertToAISDKError(error)).toBe(error);
      }
    });

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

  describe("structured error conversion", () => {
    it("should convert OrchestrationErrorResponse", () => {
      const errorResponse: OrchestrationErrorResponse = {
        error: {
          code: 500,
          location: "Module",
          message: "Orchestration error",
          request_id: "conversion-test-123",
        },
      };

      const result = convertToAISDKError(errorResponse) as APICallError;

      expect(result).toBeInstanceOf(APICallError);
      expect(result.statusCode).toBe(500);
      expect(result.isRetryable).toBe(true);
      expect(result.message).toContain("Orchestration error");
    });

    it("should convert Azure OpenAI error format (code: null)", () => {
      const errorResponse = {
        error: {
          code: null,
          message: "Invalid request parameters.",
          param: null,
          type: "invalid_request_error",
        },
      };

      const result = convertToAISDKError(errorResponse) as APICallError;

      expect(result.statusCode).toBe(500);
      expect(result.isRetryable).toBe(true);
      expect(result.message).toContain("Invalid request parameters.");
    });

    it("should use HTTP status code as fallback when error body code is null", () => {
      const axiosError = new Error("Request failed with status code 400.");
      Object.assign(axiosError, {
        isAxiosError: true,
        response: {
          data: {
            error: {
              code: null,
              message: "Invalid request parameters.",
              param: null,
              type: "invalid_request_error",
            },
          },
          status: 400,
        },
      });

      const outerError = new Error("Request failed with status code 400.");
      Object.defineProperty(outerError, "name", { value: "ErrorWithCause" });
      Object.defineProperty(outerError, "rootCause", { get: () => axiosError });

      const result = convertToAISDKError(outerError) as APICallError;

      expect(result.statusCode).toBe(400);
      expect(result.isRetryable).toBe(false);
      expect(result.message).toContain("Invalid request parameters.");
    });

    it.each([
      { desc: "non-string message", errorObject: { error: { message: 123 } } },
      { desc: "string code", errorObject: { error: { code: "invalid", message: "test" } } },
      { desc: "array with non-object entries", errorObject: { error: ["not an object"] } },
      { desc: "array with null entries", errorObject: { error: [null, { message: "valid" }] } },
      { desc: "array with entries missing message", errorObject: { error: [{ code: 400 }] } },
      {
        desc: "array with non-string message",
        errorObject: { error: [{ message: { nested: "object" } }] },
      },
      { desc: "undefined error property", errorObject: { error: undefined } },
    ])("should not treat $desc as structured error responses", ({ errorObject }) => {
      const result = convertToAISDKError(errorObject);

      expect(result).toBeInstanceOf(APICallError);
      expect((result as APICallError).statusCode).toBe(500);
    });
  });

  describe("abort error handling", () => {
    it.each([
      {
        createError: () => new DOMException("The operation was aborted", "AbortError"),
        desc: "DOMException AbortError",
      },
      {
        createError: () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          return err;
        },
        desc: "Error with name AbortError",
      },
    ])("should convert $desc to APICallError with status 499", ({ createError }) => {
      const result = convertToAISDKError(createError()) as APICallError;

      expect(result).toBeInstanceOf(APICallError);
      expect(result.statusCode).toBe(499);
      expect(result.isRetryable).toBe(false);
    });

    it("should include context in abort error", () => {
      const abortError = new DOMException("Aborted", "AbortError");

      const result = convertToAISDKError(abortError, {
        operation: "doStream",
        url: "https://api.example.com/chat",
      }) as APICallError;

      expect(result.statusCode).toBe(499);
      expect(result.url).toBe("https://api.example.com/chat");
    });

    it.each([
      {
        createError: () => new DOMException("Something else", "InvalidStateError"),
        desc: "regular DOMException",
      },
      { createError: () => new Error("Request failed"), desc: "regular Error" },
    ])("should not treat $desc as abort error", ({ createError }) => {
      const result = convertToAISDKError(createError()) as APICallError;

      expect(result.statusCode).not.toBe(499);
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

  describe("SSE error handling", () => {
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
      const error = new Error(
        `Error received from the server.\\n${JSON.stringify(sapErrorDirect)}`,
      );

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

    it("should handle server errors received during streaming", () => {
      const serverError = { code: 429, message: "Rate limited", request_id: "test-123" };
      const error = new Error(`Error received from the server.\n${JSON.stringify(serverError)}`);

      const result = convertToAISDKError(error) as APICallError;

      expect(result.statusCode).toBe(429);
      expect(result.isRetryable).toBe(true);
    });
  });

  describe("SDK-specific error handling", () => {
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
        expect(result.responseBody).toContain("258f5390-51f6-93cc-a066-858be2558a64");
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
        expect(result.cause).toBe(axiosError);
      });

      it("should extract OrchestrationErrorResponse from Axios error nested in ErrorWithCause", () => {
        const axiosError = new Error("Request failed with status code 400.");
        Object.assign(axiosError, {
          isAxiosError: true,
          response: {
            data: {
              error: {
                code: 400,
                location: "LLM Module",
                message: "Model rejected the request.",
                request_id: "axios-wrapped-123",
              },
            },
          },
        });

        const outerError = new Error("Request failed with status code 400.");
        Object.defineProperty(outerError, "name", { value: "ErrorWithCause" });
        Object.defineProperty(outerError, "rootCause", { get: () => axiosError });

        const result = convertToAISDKError(outerError) as APICallError;

        expect(result.statusCode).toBe(400);
        expect(result.isRetryable).toBe(false);
        expect(result.responseBody).toBeDefined();
        expect(result.message).toContain("Model rejected the request.");
        const responseBody = JSON.parse(result.responseBody ?? "{}") as ParsedResponseBody;
        expect(responseBody.error.request_id).toBe("axios-wrapped-123");
      });

      it("should fall back to status code extraction for non-orchestration Axios data in ErrorWithCause", () => {
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
        expect(result.isRetryable).toBe(false);
        expect(result.responseBody).toBeDefined();
      });

      it("should handle errors without axios response body", () => {
        const simpleError = new Error("Network timeout");

        const result = convertToAISDKError(simpleError) as APICallError;

        expect(result.statusCode).toBe(503);
        expect(result.responseBody).toBeUndefined();
      });
    });
  });
  describe("error boundary regressions", () => {
    it("keeps parser input out of public summaries while retaining the original diagnostic cause", () => {
      let parsingError: unknown;
      try {
        JSON.parse("credential-sentinel-network-timeout");
      } catch (error) {
        parsingError = error;
      }
      expect(parsingError).toBeInstanceOf(SyntaxError);
      const wrapper = new Error("Could not parse service configuration", { cause: parsingError });
      const converted = convertToAISDKError(wrapper) as APICallError;
      expect(converted.statusCode).toBe(500);
      expect(converted.isRetryable).toBe(false);
      expect(converted.message).not.toContain("credential-sentinel");
      expect(converted.cause).toBe(wrapper);

      const transport = Object.assign(
        new Error("Response parsing failed", { cause: parsingError }),
        {
          isAxiosError: true,
          response: { headers: { "retry-after": "5" }, status: 429 },
        },
      );
      const transportResult = convertToAISDKError(transport) as APICallError;
      expect(transportResult.statusCode).toBe(429);
      expect(transportResult.isRetryable).toBe(true);
      expect(transportResult.message).not.toContain("credential-sentinel");
      expect(transportResult.cause).toBe(transport);
      expect(transportResult.responseHeaders?.["retry-after"]).toBe("5");
    });

    it("should parse braces and escaped quotes inside a structured SSE error string", () => {
      const message = 'Unexpected } token with { and "quoted" text';
      const result = convertToAISDKError(
        new Error(
          "Error received from the server. " + JSON.stringify({ error: { code: 400, message } }),
        ),
      ) as APICallError;
      expect(result.statusCode).toBe(400);
      expect(result.isRetryable).toBe(false);
      expect(JSON.parse(result.responseBody ?? "null")).toMatchObject({ error: { message } });
    });

    it("should preserve HTTP status and diagnostics through mixed native and SAP causes", () => {
      const transport = Object.assign(new Error("Service unavailable"), {
        isAxiosError: true,
        response: { data: "gateway", headers: { "retry-after": "5" }, status: 503 },
      });
      const wrapper = new Error("native wrapper", {
        cause: new ErrorWithCause("SAP wrapper", transport),
      });
      const result = convertToAISDKError(wrapper) as APICallError;
      expect(result.statusCode).toBe(503);
      expect(result.isRetryable).toBe(true);
      expect(result.responseHeaders?.["retry-after"]).toBe("5");
      expect(result.responseBody).toBe("gateway");
    });

    it("should retain Axios metadata when its deeper native cause has no response", () => {
      const transport = Object.assign(new Error("HTTP failure", { cause: new Error("backend") }), {
        isAxiosError: true,
        response: { data: { error: { message: "throttled" } }, status: 429 },
      });
      const result = convertToAISDKError(transport) as APICallError;
      expect(result.statusCode).toBe(429);
      expect(result.isRetryable).toBe(true);
    });

    it("should preserve wrapped cancellation without looping on cyclic causes", () => {
      const abort = new DOMException("aborted", "AbortError");
      const wrapper = new ErrorWithCause("SAP wrapper", new Error("native", { cause: abort }));
      const result = convertToAISDKError(wrapper) as APICallError;
      expect(result.statusCode).toBe(499);
      expect(result.isRetryable).toBe(false);
      const cyclic = new ErrorWithCause("cycle", new Error("inner"));
      Object.defineProperty(cyclic, "cause", { value: cyclic });
      expect(convertToAISDKError(cyclic)).toBeInstanceOf(APICallError);
    });

    it("should keep arbitrary response data out of the message while retaining explicit diagnostics", () => {
      const body = { access_token: "credential-sentinel", prompt: "private-prompt-sentinel" };
      const result = convertToAISDKError(
        Object.assign(new Error("Request rejected"), {
          isAxiosError: true,
          response: { data: body, status: 400 },
        }),
      ) as APICallError;
      expect(JSON.parse(result.responseBody ?? "null")).toEqual(body);
      expect(result.message).not.toContain(body.access_token);
      expect(result.message).not.toContain(body.prompt);
    });

    it.each([Symbol("body"), () => undefined, { toJSON: () => undefined }])(
      "should retain the original error when response serialization produces no string",
      (data) => {
        const original = Object.assign(new Error("Request rejected"), {
          isAxiosError: true,
          response: { data, status: 400 },
        });
        const result = convertToAISDKError(original) as APICallError;
        expect(result.statusCode).toBe(400);
        expect(result.cause).toBe(original);
      },
    );

    it("should preserve dotted model IDs and prefer known embedding request identity", () => {
      const error = {
        error: { code: 404, message: "Model anthropic--claude-4.5-sonnet not found." },
      };
      expect((convertToAISDKError(error) as NoSuchModelError).modelId).toBe(
        "anthropic--claude-4.5-sonnet",
      );
      const context = { modelId: "text-embedding-3-small", modelType: "embeddingModel" as const };
      for (const failure of [error, new Error("Failed to resolve deployment: guessed")]) {
        const result = convertToAISDKError(failure, context) as NoSuchModelError;
        expect(result.modelId).toBe(context.modelId);
        expect(result.modelType).toBe("embeddingModel");
      }
    });
  });
});
