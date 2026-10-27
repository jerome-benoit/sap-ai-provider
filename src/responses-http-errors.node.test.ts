/** Error responses must survive the real SAP SDK before its stream-body parser runs. */
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

interface ErrorReply {
  body: string;
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
 * @returns Middleware for synchronizing socket failure and cancellation fixtures.
 */
function observeErrorBody(
  observed: () => void,
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

  it.each([401, 403])("preserves structured authentication errors for HTTP %s", async (status) => {
    fixture = {
      body: JSON.stringify({ error: { code: status, message: "Fixture authentication failed" } }),
      contentType: "application/json",
      status,
    };
    const model = createSAPAIProvider({
      api: "responses",
      deploymentId: "error-fixture",
      destination: { authentication: "NoAuthentication", url: destinationUrl },
    })("gpt-6.1-sol");
    const error: unknown = await model.doGenerate({ prompt }).catch((error: unknown) => error);
    expect(LoadAPIKeyError.isInstance(error)).toBe(true);
  });

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
      expect(error).toHaveProperty("cause.cause");
      expect(headers).toHaveLength(1);
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "keeps caller cancellation distinct while %s waits for an HTTP error body",
    async (operation) => {
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
        requestConfig: { middleware: [observeErrorBody(readable.resolve)] },
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
