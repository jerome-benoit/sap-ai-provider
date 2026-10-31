/** Transport failures retain their classification through the real Responses delegate. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider-v3";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { APICallError } from "@ai-sdk/provider";
import { generateText, streamText } from "ai";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SAPAILanguageModel } from "./sap-ai-language-model.js";

import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

const prompt: LanguageModelV3CallOptions["prompt"] = [
  { content: [{ text: "Read the fixture", type: "text" }], role: "user" },
];
const message = {
  content: [{ annotations: [], text: "Fixture recovered", type: "output_text" }],
  id: "message-recovered",
  role: "assistant",
  type: "message",
};
const reply = {
  created_at: 1_798_000_000,
  id: "response-recovered",
  model: "gpt-6.1-sol",
  output: [message],
  status: "completed",
  usage: { input_tokens: 3, output_tokens: 1 },
};
const createdEvent = `data: ${JSON.stringify({ response: reply, type: "response.created" })}\n\n`;

type Middleware = NonNullable<CustomRequestConfig["middleware"]>[number];
type Operation = "doGenerate" | "doStream";

/**
 * Invokes the public model, including stream errors delivered before model output.
 * @param model - Public SAP model.
 * @param operation - Generation operation.
 * @param options - Invocation options.
 * @returns The observed failure.
 */
async function failure(
  model: SAPAILanguageModel,
  operation: Operation,
  options: LanguageModelV3CallOptions = { prompt },
): Promise<unknown> {
  try {
    if (operation === "doGenerate") await model.doGenerate(options);
    else {
      for await (const part of (await model.doStream(options)).stream) {
        if (part.type === "error") throw part.error;
      }
    }
  } catch (error) {
    return error;
  }
  throw new Error("Expected the fixture invocation to fail");
}

describe("Responses transport failure classification", () => {
  let destinationUrl: string;
  let malformed: "idle" | "json-schema" | "json-syntax" | "sse-schema" | "sse-syntax" | undefined;
  let pendingResponse: ServerResponse | undefined;
  let wireResetsRemaining = 0;
  const wireErrors: unknown[] = [];
  const requests: Record<string, unknown>[] = [];
  const interceptedBodies: Readable[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      if (wireResetsRemaining > 0) {
        wireResetsRemaining--;
        pendingResponse = response;
        response.setHeader("content-type", body.stream ? "text/event-stream" : "application/json");
        response.setHeader("x-fixture-wire-reset", "true");
        response.write(body.stream ? "data: " : '{"id":');
        response.flushHeaders();
        return;
      }
      if (malformed === "idle") {
        pendingResponse = response;
        response.setHeader("content-type", body.stream ? "text/event-stream" : "application/json");
        response.write(body.stream ? createdEvent : '{"id":"pending"');
        response.flushHeaders();
        return;
      }
      if (body.stream) {
        response.setHeader("content-type", "text/event-stream");
        if (malformed === "sse-syntax" || malformed === "sse-schema") {
          response.end(
            malformed === "sse-syntax"
              ? "data: {invalid fixture JSON}\n\n"
              : `data: ${JSON.stringify({ response: { id: 7 }, type: "response.created" })}\n\n`,
          );
          return;
        }
        const frames = [
          { response: reply, type: "response.created" },
          {
            item: { id: message.id, type: "message" },
            output_index: 0,
            type: "response.output_item.added",
          },
          { delta: "Fixture recovered", item_id: message.id, type: "response.output_text.delta" },
          { item: message, output_index: 0, type: "response.output_item.done" },
          { response: reply, type: "response.completed" },
        ];
        response.end(
          frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n",
        );
      } else {
        response.setHeader("content-type", "application/json");
        response.end(
          malformed === "json-syntax"
            ? "{invalid fixture JSON}"
            : JSON.stringify(
                malformed === "json-schema"
                  ? { ...reply, output: "invalid fixture output" }
                  : reply,
              ),
        );
      }
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    destinationUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  beforeEach(() => {
    malformed = undefined;
    pendingResponse = undefined;
    wireResetsRemaining = 0;
    wireErrors.length = 0;
    requests.length = 0;
    interceptedBodies.length = 0;
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

  /**
   * Configures a destination that uses the real SAP HTTP client without credentials.
   * @param middleware - Optional documented SAP request middleware.
   * @returns Public provider settings.
   */
  function settings(middleware?: Middleware) {
    return {
      api: "responses" as const,
      deploymentId: "classification-fixture",
      destination: { authentication: "NoAuthentication" as const, url: destinationUrl },
      requestConfig: { middleware: middleware ? [middleware] : [] },
    };
  }

  /**
   * Simulates a body failure after the real HTTP client has accepted successful headers.
   * @param error - Failure reported by the transport stream.
   * @param attempts - How many responses fail before allowing the real body through.
   * @param prefix - Optional bytes delivered before the failure.
   * @returns SAP middleware that leaves HTTP status and SDK execution unchanged.
   */
  function failingBody(error: Error, attempts = Number.POSITIVE_INFINITY, prefix = ""): Middleware {
    let remaining = attempts;
    return ({ fn }) =>
      async (request) => {
        const response = await fn(request);
        if (remaining-- <= 0) return response;
        const original: unknown = response.data;
        if (!(original instanceof Readable))
          throw new Error("Expected the SAP client's real HTTP body");
        original.destroy();
        const body = Readable.from(
          (function* () {
            if (prefix) yield Buffer.from(prefix);
            throw error;
          })(),
        );
        interceptedBodies.push(body);
        return { ...response, data: body };
      };
  }

  /**
   * Closes the real server socket only after the client has received HTTP headers and body bytes.
   * @returns A passive SAP middleware that never changes the response or its body.
   */
  function resetAfterBodyReadable(): Middleware {
    return ({ fn }) =>
      async (request) => {
        const response = await fn(request);
        const headers: unknown = response.headers;
        if (
          typeof headers !== "object" ||
          headers === null ||
          !("x-fixture-wire-reset" in headers) ||
          headers["x-fixture-wire-reset"] !== "true"
        )
          return response;
        const body: unknown = response.data;
        if (!(body instanceof Readable))
          throw new Error("Expected the real SAP HTTP response body");
        const target = pendingResponse;
        if (!target) throw new Error("Expected a pending server response for the wire reset");
        body.once("error", (error: unknown) => {
          wireErrors.push(error);
        });
        const reset = () => {
          void setImmediate().then(() => {
            target.destroy();
          });
        };
        if (body.readableLength > 0) reset();
        else body.once("readable", reset);
        return response;
      };
  }

  it.each(["doGenerate", "doStream"] as const)(
    "%s makes an actual TCP reset before model output retryable",
    async (operation) => {
      wireResetsRemaining = 1;
      const model = createSAPAIProvider(settings(resetAfterBodyReadable()))("gpt-6.1-sol");

      const error = await failure(model, operation);

      expect(wireErrors).toHaveLength(1);
      expect(wireErrors[0]).toMatchObject({ code: "ECONNRESET", message: "aborted" });
      expect(error).toMatchObject({ isRetryable: true, statusCode: 503 });
      expect(requests).toHaveLength(1);
    },
  );

  it.each(["generateText", "streamText"] as const)(
    "lets actual AI SDK %s retry a pre-output TCP reset and recover",
    async (operation) => {
      wireResetsRemaining = 1;
      const model = createSAPAIProviderV4(settings(resetAfterBodyReadable()))("gpt-6.1-sol");
      const options = { maxRetries: 1, model, prompt: "Read the fixture" };
      if (operation === "generateText") {
        expect((await generateText(options)).text).toBe("Fixture recovered");
      } else {
        const finalErrors: unknown[] = [];
        const result = streamText({
          ...options,
          onError: ({ error }) => {
            finalErrors.push(error);
          },
        });
        expect(await result.text).toBe("Fixture recovered");
        expect(finalErrors).toEqual([]);
      }
      expect(wireErrors).toHaveLength(1);
      expect(wireErrors[0]).toMatchObject({ code: "ECONNRESET", message: "aborted" });
      expect(requests).toHaveLength(2);
    },
    10_000,
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s preserves the transport's retryable network classification before any output",
    async (operation) => {
      const source = new Error("network fixture connection failed");
      const prefix = operation === "doGenerate" ? '{"id":"partial"' : createdEvent;
      const model = createSAPAIProvider(settings(failingBody(source, 1, prefix)))("gpt-6.1-sol");

      const error = await failure(model, operation);

      expect(error).toMatchObject({ isRetryable: true, statusCode: 503 });
      expect(APICallError.isInstance(error)).toBe(true);
      expect(requests).toHaveLength(1);
      expect(interceptedBodies[0]?.destroyed).toBe(true);
    },
  );
  it.each(["doGenerate", "doStream"] as const)(
    "%s keeps an opaque body failure non-retryable with its operation and original cause",
    async (operation) => {
      const source = new Error("opaque fixture failure");
      const model = createSAPAIProvider(settings(failingBody(source)))("gpt-6.1-sol");

      const error = await failure(model, operation);

      expect(APICallError.isInstance(error)).toBe(true);
      if (!APICallError.isInstance(error)) throw new Error("Expected the body-read failure");
      expect(error.statusCode).toBe(500);
      expect(error.isRetryable).toBe(false);
      expect(error.message).toContain(operation);
      expect(error.cause).toBe(source);
      expect(interceptedBodies[0]?.destroyed).toBe(true);
      expect(requests).toHaveLength(1);
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s preserves a classified SAP failure and all its diagnostics by identity",
    async (operation) => {
      const source = new APICallError({
        isRetryable: true,
        message: "Fixture SAP service unavailable",
        requestBodyValues: { fixture: true },
        responseBody: "Fixture backend failure",
        responseHeaders: { "retry-after": "0", "x-request-id": "fixture-sap-failure" },
        statusCode: 503,
        url: "sap-ai:responses",
      });
      const model = createSAPAIProvider(settings(failingBody(source)))("gpt-6.1-sol");

      const error = await failure(model, operation);

      expect(error).toBe(source);
      expect(requests).toHaveLength(1);
    },
  );

  it.each(["generateText", "streamText"] as const)(
    "allows the high-level AI SDK %s caller to retry and recover",
    async (operation) => {
      const source = new APICallError({
        isRetryable: true,
        message: "Fixture transient SAP failure",
        requestBodyValues: {},
        responseHeaders: { "retry-after": "0" },
        statusCode: 503,
        url: "sap-ai:responses",
      });
      const model = createSAPAIProviderV4(settings(failingBody(source, 1)))("gpt-6.1-sol");
      const options = { maxRetries: 1, model, prompt: "Read the fixture" };
      if (operation === "generateText") {
        expect((await generateText(options)).text).toBe("Fixture recovered");
      } else {
        const result = streamText(options);
        expect(await result.text).toBe("Fixture recovered");
      }
      expect(requests).toHaveLength(2);
    },
  );

  it.each([
    { malformed: "json-syntax", operation: "doGenerate" },
    { malformed: "json-schema", operation: "doGenerate" },
    { malformed: "sse-syntax", operation: "doStream" },
    { malformed: "sse-schema", operation: "doStream" },
  ] as const)(
    "$operation keeps a genuinely invalid $malformed payload separate from a transport failure",
    async (scenario) => {
      malformed = scenario.malformed;
      const model = createSAPAIProvider(settings())("gpt-6.1-sol");

      const error = await failure(model, scenario.operation);

      expect(APICallError.isInstance(error)).toBe(true);
      expect(error).toMatchObject({ isRetryable: false });
      if (!APICallError.isInstance(error)) throw new Error("Expected a classified parse error");
      expect(error.statusCode).not.toBe(503);
      if (scenario.operation === "doGenerate") expect(error.statusCode).toBe(200);
      expect(requests).toHaveLength(1);
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s keeps caller cancellation at 499 while a successful body is idle",
    async (operation) => {
      malformed = "idle";
      let observed!: () => void;
      const ready = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const middleware: Middleware =
        ({ fn }) =>
        async (request) => {
          const response = await fn(request);
          const body: unknown = response.data;
          if (!(body instanceof Readable)) throw new Error("Expected a real SAP HTTP body");
          if (body.readableLength > 0) observed();
          else body.once("readable", observed);
          return response;
        };
      const model = createSAPAIProvider(settings(middleware))("gpt-6.1-sol");
      const controller = new AbortController();
      const result = failure(model, operation, { abortSignal: controller.signal, prompt });
      await ready;
      const response = pendingResponse;
      if (!response) throw new Error("Expected a pending successful HTTP response");
      const closed = new Promise<void>((resolve) => response.once("close", resolve));

      controller.abort("fixture caller cancelled before output");

      expect(await result).toMatchObject({ isRetryable: false, statusCode: 499 });
      await closed;
      expect(requests).toHaveLength(1);
    },
  );
});
