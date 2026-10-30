/** Error responses must survive the real SAP SDK before its stream-body parser runs. */
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type {
  HttpMiddlewareContext,
  HttpRequestConfig,
  HttpResponse,
} from "@sap-cloud-sdk/http-client";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";
import { retry } from "@sap-cloud-sdk/resilience";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

interface ErrorReply {
  body: string;
  chunks?: readonly Uint8Array[];
  contentType: string;
  pending?: boolean;
  status: number;
}

/**
 * Creates a fixture signal with an ES2022-compatible promise.
 * @returns A promise and the callback that completes it.
 */
function fixtureSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/**
 * Observes the first error-body bytes without consuming or replacing SDK streams.
 * @param observed - Called after the HTTP error body is readable.
 * @param onFailure - Optional observer for the actual response-body failure.
 * @returns Middleware for synchronizing socket failure and cancellation fixtures.
 */
function observeErrorBody(
  observed: () => void,
  onFailure?: (error: unknown) => void,
): NonNullable<CustomRequestConfig["middleware"]>[number] {
  return ({ fn }) =>
    async (request) => {
      try {
        return await fn(request);
      } catch (error) {
        const response = error instanceof Error && "response" in error ? error.response : undefined;
        if (
          typeof response === "object" &&
          response !== null &&
          "data" in response &&
          response.data instanceof Readable
        ) {
          if (onFailure) response.data.once("error", onFailure);
          if (response.data.readableLength > 0) observed();
          else response.data.once("readable", observed);
        }
        throw error;
      }
    };
}

const failures: ErrorReply[] = [
  { body: "<html><body>Gateway unavailable</body></html>", contentType: "text/html", status: 502 },
  { body: "", contentType: "application/json", status: 503 },
  { body: '{"error":', contentType: "application/json", status: 429 },
  { body: "Invalid request", contentType: "text/plain", status: 400 },
];
const prompt = [{ content: [{ text: "Hello", type: "text" as const }], role: "user" as const }];

describe("Responses HTTP error preservation", () => {
  let fixture: ErrorReply;
  let destinationUrl: string;
  let pendingResponse: ServerResponse | undefined;
  const headers: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    request.resume();
    headers.push(request.headers);
    response.writeHead(fixture.status, {
      "content-type": fixture.contentType,
      "retry-after": "7",
      "x-request-id": "fixture-error-request",
    });
    if (fixture.chunks) {
      const chunks = fixture.chunks;
      const pending = fixture.pending;
      pendingResponse = response;
      void (async () => {
        for (const chunk of chunks) {
          if (response.destroyed) return;
          response.write(chunk);
          await setImmediate();
        }
        if (!pending) response.end();
      })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
      return;
    }
    if (fixture.pending) {
      pendingResponse = response;
      response.write(fixture.body);
      response.flushHeaders();
    } else {
      response.end(fixture.body);
    }
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    destinationUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  beforeEach(() => {
    headers.length = 0;
    pendingResponse = undefined;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  });

  it.each(
    failures.flatMap((failure) => [
      { ...failure, streaming: false },
      { ...failure, streaming: true },
    ]),
  )(
    "retains HTTP $status metadata for $contentType, streaming=$streaming",
    async ({ streaming, ...failure }) => {
      fixture = failure;
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: { headers: { "x-custom-header": "fixture" }, proxy: false },
      })("gpt-6.1-sol");
      const result = streaming ? model.doStream({ prompt }) : model.doGenerate({ prompt });
      const error: unknown = await result.catch((error: unknown) => error);

      expect(APICallError.isInstance(error)).toBe(true);
      expect(error).toMatchObject({
        isRetryable: failure.status === 429 || failure.status >= 500,
        responseBody: failure.body,
        responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
        statusCode: failure.status,
      });
      expect(headers).toHaveLength(1);
      expect(headers[0]?.["x-custom-header"]).toBe("fixture");
      expect(headers[0]?.authorization).toBeUndefined();
    },
  );

  it("preserves configured middleware retries before translating the final HTTP failure", async () => {
    fixture = { body: "Gateway temporarily unavailable", contentType: "text/plain", status: 502 };
    const observedFailures: unknown[] = [];
    const model = createSAPAIProvider({
      api: "responses",
      deploymentId: "error-fixture",
      destination: { authentication: "NoAuthentication", url: destinationUrl },
      requestConfig: {
        headers: { "x-custom-header": "retried-fixture" },
        middleware: [
          ({ fn }) =>
            async (request) => {
              try {
                return await fn(request);
              } catch (error) {
                observedFailures.push(error);
                const response = (error as { response?: { data?: unknown } }).response;
                if (response?.data instanceof Readable) response.data.resume();
                return fn(request);
              }
            },
        ],
      },
    })("gpt-6.1-sol");

    const error: unknown = await model.doGenerate({ prompt }).catch((error: unknown) => error);

    expect(observedFailures).toHaveLength(1);
    expect(observedFailures[0]).toMatchObject({ response: { status: 502 } });
    expect(headers).toHaveLength(2);
    expect(headers.every((header) => header["x-custom-header"] === "retried-fixture")).toBe(true);
    expect(error).toMatchObject({
      isRetryable: true,
      responseBody: fixture.body,
      responseHeaders: { "retry-after": "7" },
      statusCode: 502,
    });
  });

  it.each(
    [429, 502].flatMap((status) =>
      (["doGenerate", "doStream"] as const).map((operation) => ({ operation, status })),
    ),
  )(
    "retains the final retry(0) HTTP $status body and wrapper during $operation",
    async ({ operation, status }) => {
      const value = { error: { code: status, message: "Fixture wrapped quota failure" } };
      fixture = {
        body:
          status === 429 ? JSON.stringify(value) : "<html>Fixture wrapped gateway failure</html>",
        contentType: status === 429 ? "application/json" : "text/html",
        status,
      };
      const wrappers: unknown[] = [];
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "wrapped-error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: {
          middleware: [
            ({ fn }) =>
              async (request) => {
                try {
                  return await fn(request);
                } catch (error) {
                  wrappers.push(error);
                  throw error;
                }
              },
            retry(0),
          ],
        },
      })("gpt-6.1-sol");

      const error: unknown = await model[operation]({ prompt }).catch((error: unknown) => error);

      expect(APICallError.isInstance(error)).toBe(true);
      if (!APICallError.isInstance(error))
        throw new Error("Expected the final wrapped HTTP failure");
      expect(error).toMatchObject({
        isRetryable: true,
        responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
        statusCode: status,
      });
      expect(wrappers).toHaveLength(1);
      expect(error.cause).toBe(wrappers[0]);
      if (status === 429) expect(JSON.parse(error.responseBody ?? "") as unknown).toEqual(value);
      else expect(error.responseBody).toBe(fixture.body);
      expect(headers).toHaveLength(1);
    },
  );

  it("allows a configured retry to recover from HTTP 502 before final-error preservation", async () => {
    fixture = { body: "Fixture transient gateway failure", contentType: "text/plain", status: 502 };
    let failedAttempts = 0;
    const model = createSAPAIProvider({
      api: "responses",
      deploymentId: "recovering-error-fixture",
      destination: { authentication: "NoAuthentication", url: destinationUrl },
      requestConfig: {
        middleware: [
          ({ fn }) =>
            async (request) => {
              try {
                return await fn(request);
              } catch (error) {
                failedAttempts++;
                const response =
                  error instanceof Error && "response" in error ? error.response : undefined;
                if (
                  typeof response === "object" &&
                  response !== null &&
                  "data" in response &&
                  response.data instanceof Readable
                )
                  response.data.resume();
                fixture = {
                  body: JSON.stringify({
                    created_at: 1_798_000_000,
                    id: "recovered-response",
                    model: "gpt-6.1-sol",
                    output: [
                      {
                        content: [{ annotations: [], text: "Recovered", type: "output_text" }],
                        id: "recovered-message",
                        role: "assistant",
                        type: "message",
                      },
                    ],
                    status: "completed",
                    usage: { input_tokens: 3, output_tokens: 1 },
                  }),
                  contentType: "application/json",
                  status: 200,
                };
                return fn(request);
              }
            },
        ],
      },
    })("gpt-6.1-sol");

    const result = await model.doGenerate({ prompt });

    expect(result.content).toContainEqual(
      expect.objectContaining({ text: "Recovered", type: "text" }),
    );
    expect(failedAttempts).toBe(1);
    expect(headers).toHaveLength(2);
  });

  it.each(
    [401, 403].flatMap((status) =>
      (["doGenerate", "doStream"] as const).map((operation) => ({ operation, status })),
    ),
  )(
    "preserves retry(0) authentication errors for HTTP $status during $operation",
    async ({ operation, status }) => {
      fixture = {
        body: JSON.stringify({ error: { code: status, message: "Fixture authentication failed" } }),
        contentType: "application/json",
        status,
      };
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: { middleware: [retry(0)] },
      })("gpt-6.1-sol");
      const error: unknown = await model[operation]({ prompt }).catch((error: unknown) => error);
      if (!LoadAPIKeyError.isInstance(error)) {
        throw new Error("Expected a structured authentication failure");
      }
      expect(error.message).toContain("Fixture authentication failed");
      expect(headers).toHaveLength(1);
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      [false, true].map((wrapped) => ({ operation, wrapped })),
    ),
  )(
    "bounds an oversized never-ending HTTP error body during $operation, retry(0)=$wrapped",
    async ({ operation, wrapped }) => {
      const body = "<html>fixture gateway unavailable " + "x".repeat(256 * 1024);
      fixture = { body, contentType: "text/html", pending: true, status: 502 };
      const readable = fixtureSignal();
      const controller = new AbortController();
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: {
          middleware: [
            ...(wrapped ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)] : []),
            observeErrorBody(readable.resolve),
          ],
        },
      })("gpt-6.1-sol");
      const result = model[operation]({ abortSignal: controller.signal, prompt }).catch(
        (error: unknown) => error,
      );
      await readable.promise;
      const response = pendingResponse;
      if (!response) throw new Error("Expected an oversized pending HTTP error response");
      const closed = new Promise<void>((resolve) => response.once("close", resolve));
      const timeout = setTimeout(() => {
        controller.abort("fixture fallback: unbounded error read");
      }, 500);
      let error: unknown;
      try {
        error = await result;
        await closed;
      } finally {
        clearTimeout(timeout);
      }
      expect(APICallError.isInstance(error)).toBe(true);
      expect(error).toMatchObject({
        isRetryable: true,
        responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
        statusCode: 502,
      });
      if (!APICallError.isInstance(error) || error.responseBody === undefined)
        throw new Error("Expected captured HTTP error diagnostics");
      expect(error.responseBody).toMatch(/\.\.\.\[truncated\]$/);
      const prefix = error.responseBody.replace(/\.\.\.\[truncated\]$/, "");
      expect(prefix.length).toBeGreaterThan(0);
      expect(body.startsWith(prefix)).toBe(true);
      expect(Buffer.byteLength(error.responseBody, "utf8")).toBeLessThanOrEqual(2_000);
      expect(controller.signal.aborted).toBe(false);
      expect(response.destroyed).toBe(true);
    },
  );

  it.each([
    { body: "a".repeat(1_985) + "😀" + "z".repeat(256 * 1024), name: "split emoji" },
    { body: "a" + "€".repeat(128 * 1024), name: "split UTF-8 code point" },
    {
      body:
        JSON.stringify({
          error: { code: 401, message: "Truncated prefix must not override gateway status" },
        }) +
        " ".repeat(256 * 1024) +
        "invalid JSON suffix",
      name: "complete JSON prefix with missing suffix",
    },
    {
      body: JSON.stringify({
        error: { code: 401, message: "Large JSON failure " + "z".repeat(256 * 1024) },
      }),
      name: "oversized JSON document",
    },
  ])("keeps a valid text prefix and original status for $name", async ({ body }) => {
    const bytes = Buffer.from(body);
    fixture = {
      body,
      chunks: [
        bytes.subarray(0, 1_000),
        bytes.subarray(1_000, 1_986),
        bytes.subarray(1_986, 1_988),
        bytes.subarray(1_988),
      ],
      contentType: "application/json",
      status: 502,
    };
    const model = createSAPAIProvider({
      api: "responses",
      deploymentId: "error-fixture",
      destination: { authentication: "NoAuthentication", url: destinationUrl },
    })("gpt-6.1-sol");

    const error: unknown = await model.doGenerate({ prompt }).catch((error: unknown) => error);

    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ isRetryable: true, statusCode: 502 });
    if (!APICallError.isInstance(error) || error.responseBody === undefined)
      throw new Error("Expected captured HTTP error diagnostics");
    expect(error.responseBody).toMatch(/\.\.\.\[truncated\]$/);
    const prefix = error.responseBody.replace(/\.\.\.\[truncated\]$/, "");
    expect(prefix).not.toContain("�");
    expect(new TextDecoder().decode(new TextEncoder().encode(prefix))).toBe(prefix);
    expect(body.startsWith(prefix)).toBe(true);
    expect(Buffer.byteLength(error.responseBody, "utf8")).toBeLessThanOrEqual(2_000);
  });

  it.each(["doGenerate", "doStream"] as const)(
    "preserves a small complete JSON error split across UTF-8 chunks during %s",
    async (operation) => {
      const value = { error: { code: 429, message: "Fixture quota ☕ exhausted" } };
      const body = JSON.stringify(value);
      const bytes = Buffer.from(body);
      const split = bytes.indexOf(Buffer.from("☕")) + 1;
      fixture = {
        body,
        chunks: [bytes.subarray(0, split), bytes.subarray(split)],
        contentType: "application/json",
        status: 429,
      };
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
      })("gpt-6.1-sol");

      const error: unknown = await model[operation]({ prompt }).catch((error: unknown) => error);

      expect(APICallError.isInstance(error)).toBe(true);
      expect(error).toMatchObject({ isRetryable: true, statusCode: 429 });
      if (!APICallError.isInstance(error) || error.responseBody === undefined)
        throw new Error("Expected complete JSON error diagnostics");
      expect(JSON.parse(error.responseBody) as unknown).toEqual(value);
      expect(error.message).toContain(value.error.message);
      expect(error.responseBody).not.toContain("[truncated]");
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "preserves HTTP metadata and the received prefix when %s loses the error-body socket",
    async (operation) => {
      const prefix = "<html>Gateway unavailable";
      fixture = { body: prefix, contentType: "text/html", pending: true, status: 502 };
      const readable = fixtureSignal();
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: { middleware: [observeErrorBody(readable.resolve)] },
      })("gpt-6.1-sol");
      const result = model[operation]({ prompt }).catch((error: unknown) => error);
      await readable.promise;
      await setImmediate();
      if (!pendingResponse) throw new Error("Expected a pending HTTP error response");
      pendingResponse.destroy();

      const error: unknown = await result;
      expect(APICallError.isInstance(error)).toBe(true);
      expect(error).toMatchObject({
        isRetryable: true,
        responseBody: prefix,
        responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
        statusCode: 502,
      });
      expect(headers).toHaveLength(1);
    },
  );
  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      [false, true].map((wrapped) => ({ operation, wrapped })),
    ),
  )(
    "keeps HTTP 400 authoritative after complete JSON then a socket reset during $operation, retry(0)=$wrapped",
    async ({ operation, wrapped }) => {
      const value = { error: { code: 400, message: "Fixture request is invalid" } };
      fixture = {
        body: JSON.stringify(value),
        contentType: "application/json",
        pending: true,
        status: 400,
      };
      const readable = fixtureSignal();
      const bodyFailures: unknown[] = [];
      let wrapper: unknown;
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "reset-error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: {
          middleware: [
            ({ fn }) =>
              async (request) => {
                try {
                  return await fn(request);
                } catch (error) {
                  wrapper = error;
                  throw error;
                }
              },
            ...(wrapped ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)] : []),
            observeErrorBody(readable.resolve, (error) => bodyFailures.push(error)),
          ],
        },
      })("gpt-6.1-sol");
      const result = model[operation]({ prompt }).catch((error: unknown) => error);
      await readable.promise;
      await setImmediate();
      if (!pendingResponse) throw new Error("Expected a pending structured HTTP error response");
      pendingResponse.destroy();

      const error: unknown = await result;

      expect(bodyFailures).toContainEqual(expect.objectContaining({ code: "ECONNRESET" }));
      expect(APICallError.isInstance(error)).toBe(true);
      if (!APICallError.isInstance(error)) throw new Error("Expected the authoritative HTTP error");
      expect(error).toMatchObject({
        isRetryable: false,
        responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
        statusCode: 400,
      });
      expect(JSON.parse(error.responseBody ?? "") as unknown).toEqual(value);
      expect(error.cause).toBe(wrapper);
      expect(headers).toHaveLength(1);
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      [false, true].map((wrapped) => ({ operation, wrapped })),
    ),
  )(
    "keeps caller cancellation distinct during $operation HTTP errors, retry(0)=$wrapped",
    async ({ operation, wrapped }) => {
      fixture = {
        body: "<html>Pending gateway error",
        contentType: "text/html",
        pending: true,
        status: 502,
      };
      const readable = fixtureSignal();
      const controller = new AbortController();
      const model = createSAPAIProvider({
        api: "responses",
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
        requestConfig: {
          middleware: [
            ...(wrapped ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)] : []),
            observeErrorBody(readable.resolve),
          ],
        },
      })("gpt-6.1-sol");
      const result = model[operation]({ abortSignal: controller.signal, prompt }).catch(
        (error: unknown) => error,
      );
      await readable.promise;
      await setImmediate();
      const response = pendingResponse;
      if (!response) throw new Error("Expected a pending HTTP error response");
      const closed = new Promise<void>((resolve) => response.once("close", resolve));
      controller.abort("cancelled while reading HTTP error");

      expect(await result).toMatchObject({ isRetryable: false, statusCode: 499 });
      await closed;
      expect(headers).toHaveLength(1);
    },
  );
});
