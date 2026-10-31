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
import { Console } from "node:console";
import { createServer } from "node:http";
import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

interface ErrorReply {
  body: string;
  chunks?: readonly Uint8Array[];
  contentType: string;
  pending?: boolean;
  reset?: boolean;
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
  { body: "<html>Service temporarily unavailable</html>", contentType: "text/html", status: 503 },
  { body: "", contentType: "application/json", status: 503 },
  { body: '{"error":', contentType: "application/json", status: 429 },
  { body: "Invalid request", contentType: "text/plain", status: 400 },
];
const prompt = [{ content: [{ text: "Hello", type: "text" as const }], role: "user" as const }];

describe.each(["responses", "orchestration", "foundation-models"] as const)(
  "%s HTTP error preservation",
  (api) => {
    const operations =
      api === "responses" ? (["doGenerate", "doStream"] as const) : (["doStream"] as const);
    let fixture: ErrorReply;
    let destinationUrl: string;
    let pendingResponse: ServerResponse | undefined;
    const headers: IncomingHttpHeaders[] = [];
    const requestBodies: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        requestBodies.push(body);
      });
      headers.push(request.headers);
      if (fixture.reset) {
        request.socket.destroy();
        return;
      }
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
        })().catch((error: unknown) =>
          response.destroy(error instanceof Error ? error : undefined),
        );
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
      requestBodies.length = 0;
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
          api,
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

    it.each(
      [400, 429].flatMap((status) =>
        operations.flatMap((operation) =>
          [false, true].map((wrapped) => ({ operation, status, wrapped })),
        ),
      ),
    )(
      "keeps structured HTTP $status credentials private during $operation, retry(0)=$wrapped",
      async ({ operation, status, wrapped }) => {
        const secrets = [
          "destination-private-sentinel",
          "authorization-private-sentinel",
          "prompt-private-sentinel",
        ] as const;
        const value = {
          error: {
            code: status,
            location: "fixture.safe.location",
            message: "Safe structured failure",
            request_id: "safe-request-id",
          },
        };
        fixture = { body: JSON.stringify(value), contentType: "application/json", status };
        const model = createSAPAIProvider({
          api,
          deploymentId: "privacy-fixture",
          destination: {
            authentication: "NoAuthentication",
            headers: { "x-private-destination": secrets[0] },
            url: destinationUrl,
          },
          requestConfig: {
            headers: { Authorization: `Bearer ${secrets[1]}` },
            middleware: wrapped
              ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)]
              : [],
            proxy: false,
          },
        })("gpt-6.1-sol");
        const error: unknown = await model[operation]({
          prompt: [{ content: [{ text: secrets[2], type: "text" }], role: "user" }],
        }).catch((error: unknown) => error);
        expect(APICallError.isInstance(error)).toBe(true);
        if (!APICallError.isInstance(error)) throw new Error("Expected structured HTTP failure");
        expect(error).toMatchObject({
          isRetryable: status === 429,
          responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
          statusCode: status,
        });
        expect(JSON.parse(error.responseBody ?? "") as unknown).toEqual(value);
        expect(error.message).toContain("Request ID: safe-request-id");
        if (status === 400)
          expect(error.message).toContain("Error location: fixture.safe.location");
        expect(headers).toHaveLength(1);
        expect(headers[0]?.["x-private-destination"]).toBe(secrets[0]);
        expect(headers[0]?.authorization).toBe(`Bearer ${secrets[1]}`);
        expect(requestBodies).toHaveLength(1);
        expect(requestBodies[0]).toContain(secrets[2]);
        let logged = "";
        const sink = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            logged += chunk.toString("utf8");
            callback();
          },
        });
        new Console({ stderr: sink, stdout: sink }).error(error);
        sink.end();
        await finished(sink);
        for (const representation of [JSON.stringify(error), inspect(error), logged]) {
          for (const secret of secrets) expect(representation).not.toContain(secret);
        }
      },
    );

    it("preserves configured middleware retries before translating the final HTTP failure", async () => {
      fixture = { body: "Gateway temporarily unavailable", contentType: "text/plain", status: 502 };
      const observedFailures: unknown[] = [];
      const model = createSAPAIProvider({
        api,
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

      const error: unknown = await model[api === "responses" ? "doGenerate" : "doStream"]({
        prompt,
      }).catch((error: unknown) => error);

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

    it.each([429, 502].flatMap((status) => operations.map((operation) => ({ operation, status }))))(
      "retains the final retry(0) HTTP $status diagnostics during $operation",
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
          api,
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
        if (status === 429) expect(JSON.parse(error.responseBody ?? "") as unknown).toEqual(value);
        else {
          expect(error.responseBody).toBe(fixture.body);
          expect(error.cause).toBe(wrappers[0]);
        }
        expect(headers).toHaveLength(1);
      },
    );

    if (api === "responses") {
      it("allows a configured retry to recover from HTTP 502 before final-error preservation", async () => {
        fixture = {
          body: "Fixture transient gateway failure",
          contentType: "text/plain",
          status: 502,
        };
        let failedAttempts = 0;
        const model = createSAPAIProvider({
          api,
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
    }

    it.each([401, 403].flatMap((status) => operations.map((operation) => ({ operation, status }))))(
      "preserves retry(0) authentication errors for HTTP $status during $operation",
      async ({ operation, status }) => {
        fixture = {
          body: JSON.stringify({
            error: { code: status, message: "Fixture authentication failed" },
          }),
          contentType: "application/json",
          status,
        };
        const model = createSAPAIProvider({
          api,
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
      operations.flatMap((operation) => [false, true].map((wrapped) => ({ operation, wrapped }))),
    )(
      "bounds an oversized never-ending HTTP error body during $operation, retry(0)=$wrapped",
      async ({ operation, wrapped }) => {
        const body = "<html>fixture gateway unavailable " + "x".repeat(256 * 1024);
        fixture = { body, contentType: "text/html", pending: true, status: 502 };
        const readable = fixtureSignal();
        const controller = new AbortController();
        const model = createSAPAIProvider({
          api,
          deploymentId: "error-fixture",
          destination: { authentication: "NoAuthentication", url: destinationUrl },
          requestConfig: {
            middleware: [
              ...(wrapped
                ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)]
                : []),
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
        api,
        deploymentId: "error-fixture",
        destination: { authentication: "NoAuthentication", url: destinationUrl },
      })("gpt-6.1-sol");

      const error: unknown = await model[api === "responses" ? "doGenerate" : "doStream"]({
        prompt,
      }).catch((error: unknown) => error);

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

    it.each(operations)(
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
          api,
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

    it.each(operations)(
      "preserves HTTP metadata and the received prefix when %s loses the error-body socket",
      async (operation) => {
        const prefix = "<html>Gateway unavailable";
        fixture = { body: prefix, contentType: "text/html", pending: true, status: 502 };
        const readable = fixtureSignal();
        const model = createSAPAIProvider({
          api,
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
      operations.flatMap((operation) => [false, true].map((wrapped) => ({ operation, wrapped }))),
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
        const model = createSAPAIProvider({
          api,
          deploymentId: "reset-error-fixture",
          destination: { authentication: "NoAuthentication", url: destinationUrl },
          requestConfig: {
            middleware: [
              ...(wrapped
                ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)]
                : []),
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
        if (!APICallError.isInstance(error))
          throw new Error("Expected the authoritative HTTP error");
        expect(error).toMatchObject({
          isRetryable: false,
          responseHeaders: { "retry-after": "7", "x-request-id": "fixture-error-request" },
          statusCode: 400,
        });
        expect(JSON.parse(error.responseBody ?? "") as unknown).toEqual(value);
        expect(headers).toHaveLength(1);
      },
    );

    it.each(
      operations.flatMap((operation) => [false, true].map((wrapped) => ({ operation, wrapped }))),
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
          api,
          deploymentId: "error-fixture",
          destination: { authentication: "NoAuthentication", url: destinationUrl },
          requestConfig: {
            middleware: [
              ...(wrapped
                ? [retry<HttpRequestConfig, HttpResponse, HttpMiddlewareContext>(0)]
                : []),
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
    if (api !== "responses") {
      it.each(["success", "success-drained", "network", "400", "opaque"] as const)(
        "classifies only the final middleware outcome after HTTP 503: %s",
        async (outcome) => {
          fixture = {
            body: "<html>abandoned first failure</html>",
            contentType: "text/html",
            status: 503,
          };
          const model = createSAPAIProvider({
            api,
            deploymentId: "transition-fixture",
            destination: { authentication: "NoAuthentication", url: destinationUrl },
            requestConfig: {
              middleware: [
                ({ fn }) =>
                  async (request) => {
                    try {
                      return await fn(request);
                    } catch (error) {
                      if (outcome === "success-drained") {
                        const response =
                          error instanceof Error && "response" in error
                            ? error.response
                            : undefined;
                        if (
                          typeof response !== "object" ||
                          response === null ||
                          !("data" in response) ||
                          !(response.data instanceof Readable)
                        ) {
                          throw new Error("Expected native retry response body", { cause: error });
                        }
                        response.data.resume();
                        await finished(response.data);
                      }
                      if (outcome === "opaque") {
                        // eslint-disable-next-line preserve-caught-error -- This fixture intentionally replaces prior HTTP failure with an unrelated final error.
                        throw new Error("Final opaque fixture failure");
                      }
                      if (outcome === "network") {
                        fixture = { body: "", contentType: "text/plain", reset: true, status: 503 };
                      } else if (outcome === "400") {
                        fixture = {
                          body: "Final invalid request",
                          contentType: "text/plain",
                          status: 400,
                        };
                      } else {
                        const result = {
                          choices: [
                            { delta: { content: "Recovered" }, finish_reason: "stop", index: 0 },
                          ],
                          id: "recovered-stream",
                          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
                        };
                        fixture = {
                          body: `data: ${JSON.stringify(api === "orchestration" ? { final_result: result } : result)}\n\ndata: [DONE]\n\n`,
                          contentType: "text/event-stream",
                          status: 200,
                        };
                      }
                      return fn(request);
                    }
                  },
              ],
            },
          })("gpt-6.1-sol");
          if (outcome === "success" || outcome === "success-drained") {
            const parts = [];
            const result = await model.doStream({ prompt });
            for await (const part of result.stream) parts.push(part);
            expect(parts).toContainEqual(
              expect.objectContaining({ delta: "Recovered", type: "text-delta" }),
            );
            expect(parts.some((part) => part.type === "error")).toBe(false);
            expect(parts.some((part) => part.type === "finish")).toBe(true);
          } else {
            const error: unknown = await model
              .doStream({ prompt })
              .catch((error: unknown) => error);
            expect(APICallError.isInstance(error)).toBe(true);
            if (!APICallError.isInstance(error)) throw new Error("Expected final stream failure");
            if (outcome === "400") {
              expect(error).toMatchObject({
                isRetryable: false,
                responseBody: "Final invalid request",
                statusCode: 400,
              });
            } else {
              expect(error).toMatchObject({
                isRetryable: outcome === "network",
                statusCode: outcome === "network" ? 503 : 500,
              });
              expect(error.responseHeaders).toBeUndefined();
              expect(error.responseBody).toBeUndefined();
            }
            expect(inspect(error)).not.toContain("abandoned first failure");
          }
          expect(headers).toHaveLength(outcome === "opaque" ? 1 : 2);
        },
      );

      it.each(["same-body", "wrapped-body"] as const)(
        "aborts a pending recovered %s SSE read and closes its rejected HTTP request",
        async (recovery) => {
          const chunk = {
            choices: [{ delta: { content: "Before cancellation" }, index: 0 }],
            id: "pending-recovered-stream",
          };
          fixture = {
            body: `data: ${JSON.stringify(api === "orchestration" ? { final_result: chunk } : chunk)}\n\n\n`,
            contentType: "text/event-stream",
            pending: true,
            status: 400,
          };
          const closed = fixtureSignal();
          const caller = new AbortController();
          const model = createSAPAIProvider({
            api,
            deploymentId: "pending-recovered-fixture",
            destination: { authentication: "NoAuthentication", url: destinationUrl },
            requestConfig: {
              middleware: [
                ({ fn }) =>
                  async (request) => {
                    try {
                      return await fn(request);
                    } catch (error) {
                      const native =
                        error instanceof Error && "response" in error ? error.response : undefined;
                      if (
                        typeof native !== "object" ||
                        native === null ||
                        !("data" in native) ||
                        !(native.data instanceof Readable)
                      ) {
                        throw error;
                      }
                      if (!pendingResponse)
                        throw new Error("Expected pending recovered response", { cause: error });
                      pendingResponse.once("close", closed.resolve);
                      const response = native as HttpResponse;
                      if (recovery === "wrapped-body") response.data = Readable.from(native.data);
                      response.status = 200;
                      return response;
                    }
                  },
              ],
            },
          })("gpt-6.1-sol");
          const response = await model.doStream({ abortSignal: caller.signal, prompt });
          const reader = response.stream.getReader();
          let rejectDeadline!: (error: Error) => void;
          const deadline = new Promise<never>((_resolve, reject) => {
            rejectDeadline = reject;
          });
          // Real sockets need a real watchdog; success awaits read/close events, not a timer.
          const watchdog = setTimeout(() => {
            rejectDeadline(new Error("Recovered SSE cancellation did not settle before watchdog"));
          }, 1000);
          try {
            for (;;) {
              const part = await Promise.race([reader.read(), deadline]);
              if (part.done) throw new Error("Recovered SSE ended before first text");
              if (part.value.type === "text-delta") break;
            }
            const failure = (async () => {
              for (;;) {
                const part = await reader.read();
                if (part.done) throw new Error("Cancelled recovered SSE omitted its abort error");
                if (part.value.type === "error") return part.value.error;
              }
            })();
            caller.abort("cancel recovered pending SSE");
            const [error] = await Promise.race([Promise.all([failure, closed.promise]), deadline]);
            expect(error).toMatchObject({ isRetryable: false, statusCode: 499 });
            expect(pendingResponse?.destroyed).toBe(true);
          } finally {
            clearTimeout(watchdog);
            caller.abort();
            await reader.cancel().catch(() => {
              // The cancellation error has already been asserted above.
            });
          }
        },
      );

      it.each(["same-body", "wrapped-body", "replacement", "replacement-drained"] as const)(
        "transfers successful SSE ownership when middleware recovers in place: %s",
        async (recovery) => {
          const result = {
            choices: [
              { delta: { content: "Recovered in place" }, finish_reason: "stop", index: 0 },
            ],
            id: "in-place-recovery",
            usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
          };
          const events = `data: ${JSON.stringify(api === "orchestration" ? { final_result: result } : result)}\n\ndata: [DONE]\n\n`;
          fixture = {
            body:
              recovery === "same-body" || recovery === "wrapped-body"
                ? events
                : "Original failed body",
            contentType:
              recovery === "same-body" || recovery === "wrapped-body"
                ? "text/event-stream"
                : "text/plain",
            pending: recovery === "replacement",
            status: 400,
          };
          const closed = fixtureSignal();
          let originalBody: Readable | undefined;
          let serverResponse: ServerResponse | undefined;
          const model = createSAPAIProvider({
            api,
            deploymentId: "in-place-recovery-fixture",
            destination: { authentication: "NoAuthentication", url: destinationUrl },
            requestConfig: {
              middleware: [
                ({ fn }) =>
                  async (request) => {
                    try {
                      return await fn(request);
                    } catch (error) {
                      const native =
                        error instanceof Error && "response" in error ? error.response : undefined;
                      if (
                        typeof native !== "object" ||
                        native === null ||
                        !("data" in native) ||
                        !(native.data instanceof Readable)
                      ) {
                        throw error;
                      }
                      const response = native as HttpResponse;
                      originalBody = native.data;
                      if (recovery === "replacement") {
                        serverResponse = pendingResponse;
                        if (!serverResponse)
                          throw new Error("Expected pending original failure", { cause: error });
                        serverResponse.once("close", closed.resolve);
                      }
                      if (recovery === "replacement-drained") {
                        originalBody.resume();
                        await finished(originalBody);
                      }
                      if (recovery === "wrapped-body") response.data = Readable.from(originalBody);
                      else if (recovery !== "same-body")
                        response.data = Readable.from([Buffer.from(events)]);
                      response.status = 200;
                      // Return the same mutable response object that Axios rejected.
                      return response;
                    }
                  },
              ],
            },
          })("gpt-6.1-sol");
          const parts = [];
          const response = await model.doStream({ prompt });
          for await (const part of response.stream) parts.push(part);
          expect(parts).toContainEqual(
            expect.objectContaining({ delta: "Recovered in place", type: "text-delta" }),
          );
          expect(parts.some((part) => part.type === "error")).toBe(false);
          expect(parts.some((part) => part.type === "finish")).toBe(true);
          if (recovery === "replacement") {
            await closed.promise;
            expect(originalBody?.destroyed).toBe(true);
            expect(serverResponse?.destroyed).toBe(true);
          } else {
            expect(originalBody?.readableEnded).toBe(true);
          }
          expect(headers).toHaveLength(1);
        },
      );

      it.each(
        ([200, 400] as const).flatMap((status) =>
          (["throw", "non-byte", "finite", "parsed"] as const).map((failure) => ({
            failure,
            status,
          })),
        ),
      )(
        "closes HTTP $status transport after middleware substitutes a $failure error body",
        async ({ failure, status }) => {
          fixture = {
            body: "Pending wire response",
            contentType: "text/plain",
            pending: true,
            status,
          };
          const closed = fixtureSignal();
          let serverResponse: ServerResponse | undefined;
          const model = createSAPAIProvider({
            api,
            deploymentId: "replaced-error-body-fixture",
            destination: { authentication: "NoAuthentication", url: destinationUrl },
            requestConfig: {
              middleware: [
                ({ fn }) =>
                  async (request) => {
                    let response: HttpResponse;
                    let originalError: unknown;
                    try {
                      response = await fn(request);
                    } catch (error) {
                      const native =
                        error instanceof Error && "response" in error ? error.response : undefined;
                      if (
                        typeof native !== "object" ||
                        native === null ||
                        !("data" in native) ||
                        !("request" in native)
                      ) {
                        throw error;
                      }
                      response = native as HttpResponse;
                      originalError = error;
                    }
                    serverResponse = pendingResponse;
                    if (!serverResponse) throw new Error("Expected pending replaced-body response");
                    serverResponse.once("close", closed.resolve);
                    response.status = 400;
                    response.data =
                      failure === "parsed"
                        ? { error: { code: 400, message: "Middleware structured failure" } }
                        : {
                            // eslint-disable-next-line @typescript-eslint/require-await -- Exercise synchronous values from a real async-iterator body.
                            async *[Symbol.asyncIterator]() {
                              yield "Replacement diagnostic prefix";
                              if (failure === "finite") return;
                              if (failure === "throw") {
                                throw Object.assign(new Error("Secondary iterator failure"), {
                                  code: "ECONNRESET",
                                });
                              }
                              yield 17;
                            },
                          };
                    // A middleware may reject a successful native response itself.
                    // This also covers failures without an inner failed-body observer.
                    throw (
                      (originalError instanceof Error ? originalError : undefined) ??
                      Object.assign(new Error("Middleware rejected HTTP response"), {
                        isAxiosError: true,
                        response,
                      })
                    );
                  },
              ],
            },
          })("gpt-6.1-sol");
          const error: unknown = await model.doStream({ prompt }).catch((error: unknown) => error);
          expect(error).toMatchObject({
            isRetryable: false,
            responseHeaders: { "x-request-id": "fixture-error-request" },
            statusCode: 400,
          });
          if (failure === "parsed") {
            if (!APICallError.isInstance(error))
              throw new Error("Expected structured HTTP failure");
            expect(JSON.parse(error.responseBody ?? "") as unknown).toEqual({
              error: { code: 400, message: "Middleware structured failure" },
            });
          } else {
            expect(error).toMatchObject({ responseBody: "Replacement diagnostic prefix" });
          }
          expect(inspect(error)).not.toContain("Secondary iterator failure");
          await closed.promise;
          expect(serverResponse?.destroyed).toBe(true);
          expect(headers).toHaveLength(1);
        },
      );

      it("retains configured inactivity timeout while middleware delays a failed response", async () => {
        fixture = {
          body: "Pending invalid request",
          contentType: "text/plain",
          pending: true,
          status: 400,
        };
        const timedOut = fixtureSignal();
        const closed = fixtureSignal();
        const failures: unknown[] = [];
        const caller = new AbortController();
        const model = createSAPAIProvider({
          api,
          deploymentId: "timeout-fixture",
          destination: { authentication: "NoAuthentication", url: destinationUrl },
          requestConfig: {
            middleware: [
              ({ fn }) =>
                async (request) => {
                  try {
                    return await fn(request);
                  } catch (error) {
                    if (!pendingResponse)
                      throw new Error("Expected pending timeout response", { cause: error });
                    pendingResponse.once("close", closed.resolve);
                    await timedOut.promise;
                    throw error;
                  }
                },
              observeErrorBody(
                () => {
                  // Only the subsequent body failure releases this timeout fixture.
                },
                (error) => {
                  failures.push(error);
                  timedOut.resolve();
                },
              ),
            ],
            timeout: 50,
            timeoutErrorMessage: "fixture inactivity timeout",
          },
        })("gpt-6.1-sol");
        const error: unknown = await model
          .doStream({ abortSignal: caller.signal, prompt })
          .catch((error: unknown) => error);
        expect(failures).toContainEqual(
          expect.objectContaining({ code: "ECONNABORTED", message: "fixture inactivity timeout" }),
        );
        expect(error).toMatchObject({ isRetryable: false, statusCode: 400 });
        expect(caller.signal.aborted).toBe(false);
        await closed.promise;
        expect(pendingResponse?.destroyed).toBe(true);
      });
    }
  },
);
