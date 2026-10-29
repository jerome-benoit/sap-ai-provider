/** SAP response-body timeouts preserve inactivity semantics with the native HTTP adapter. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SAPAILanguageModel } from "./sap-ai-language-model.js";

import { createSAPAIProvider } from "./sap-ai-provider.js";

type Operation = "doGenerate" | "doStream";

interface RequestRecord {
  closed: Promise<void>;
  response: ServerResponse;
  socket: Socket;
}
const TIMEOUT = 200;
const WATCHDOG = 2_000;
const prompt: LanguageModelV3CallOptions["prompt"] = [
  { content: [{ text: "Read fixture", type: "text" }], role: "user" },
];
const message = {
  content: [{ annotations: [], text: "Fixture complete", type: "output_text" }],
  id: "message-fixture",
  role: "assistant",
  type: "message",
};
const reply = {
  created_at: 1_798_000_000,
  id: "response-fixture",
  model: "gpt-6.1-sol",
  output: [message],
  status: "completed",
  usage: { input_tokens: 3, output_tokens: 1 },
};
const startFrames = [
  { response: reply, type: "response.created" },
  {
    item: { id: message.id, type: "message" },
    output_index: 0,
    type: "response.output_item.added",
  },
  { delta: "Fixture complete", item_id: message.id, type: "response.output_text.delta" },
];

/**
 * Encodes native Responses SSE events.
 * @param frames - Events returned by the local server.
 * @returns Complete SSE records.
 */
function events(frames: Record<string, unknown>[]): string {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/**
 * Consumes either public operation, surfacing stream error events.
 * @param model - Public SAP model.
 * @param operation - Requested generation operation.
 * @param signal - Caller cancellation.
 * @returns Received output or the operation's failure.
 */
async function invoke(
  model: SAPAILanguageModel,
  operation: Operation,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    if (operation === "doGenerate") return await model.doGenerate({ abortSignal: signal, prompt });
    let text = "";
    for await (const part of (await model.doStream({ abortSignal: signal, prompt })).stream) {
      if (part.type === "error") throw part.error;
      if (part.type === "text-delta") text += part.delta;
    }
    return text;
  } catch (error) {
    return error;
  }
}

describe("Responses native-adapter response-body timeout", () => {
  let destinationUrl: string;
  let mode: "active" | "complete" | "idle" | "output-then-idle";
  let status = 200;
  let bodyReadable!: () => void;
  let ready: Promise<void>;
  const requests: RequestRecord[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const body = JSON.parse(raw) as { stream?: boolean };
      const socket = request.socket;
      requests.push({
        closed: new Promise<void>((resolve) => socket.once("close", resolve)),
        response,
        socket,
      });
      response.statusCode = status;
      response.setHeader("retry-after", "7");
      response.setHeader("x-request-id", "fixture-timeout");
      response.setHeader("content-type", body.stream ? "text/event-stream" : "application/json");
      if (mode === "idle" || mode === "output-then-idle") {
        response.write(
          body.stream
            ? mode === "output-then-idle"
              ? events(startFrames)
              : "data: "
            : status >= 400
              ? "<html>Fixture unavailable"
              : '{"id":"partial"',
        );
        response.flushHeaders();
        return;
      }
      if (body.stream) {
        response.write(events(startFrames));
        if (mode === "active") {
          for (let index = 0; index < 12; index++) {
            await delay(40);
            if (response.destroyed) return;
            response.write(": fixture keepalive\n\n");
          }
        }
        response.end(
          events([
            { item: message, output_index: 0, type: "response.output_item.done" },
            { response: reply, type: "response.completed" },
          ]) + "data: [DONE]\n\n",
        );
      } else response.end(JSON.stringify(reply));
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    destinationUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  beforeEach(() => {
    mode = "idle";
    status = 200;
    requests.length = 0;
    ready = new Promise<void>((resolve) => {
      bodyReadable = resolve;
    });
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
   * Uses middleware only to observe actual response bytes without changing the SAP client.
   * @param native - Whether to select Axios's native adapter path through maxRedirects.
   * @param postHeaderDelay - User middleware delay after the underlying client receives headers.
   * @param clarifyTimeoutError - Axios timeout classification to preserve with the custom message.
   * @returns Public model with a response inactivity timeout.
   */
  function model(
    native = true,
    postHeaderDelay = 0,
    clarifyTimeoutError?: boolean,
  ): SAPAILanguageModel {
    const middleware: NonNullable<CustomRequestConfig["middleware"]>[number] =
      ({ fn }) =>
      async (request) => {
        const response = await fn(request);
        const body: unknown = response.data;
        if (!(body instanceof Readable)) throw new Error("Expected a real SAP HTTP response body");
        if (body.readableLength > 0) bodyReadable();
        else body.once("readable", bodyReadable);
        return response;
      };
    const waitAfterHeaders: NonNullable<CustomRequestConfig["middleware"]>[number] =
      ({ fn }) =>
      async (request) => {
        const response = await fn(request);
        await delay(postHeaderDelay);
        return response;
      };
    return createSAPAIProvider({
      api: "responses",
      deploymentId: "timeout-fixture",
      destination: { authentication: "NoAuthentication", url: destinationUrl },
      requestConfig: {
        ...(native ? { maxRedirects: 0 } : {}),
        ...(clarifyTimeoutError === undefined
          ? {}
          : {
              timeoutErrorMessage: "Fixture custom timeout",
              transitional: { clarifyTimeoutError },
            }),
        middleware: [middleware, ...(postHeaderDelay > 0 ? [waitAfterHeaders] : [])],
        timeout: TIMEOUT,
      },
    })("gpt-6.1-sol");
  }

  /**
   * Prevents a missing provider timeout from hanging the regression test.
   * @param value - Model under test.
   * @param operation - Generation operation.
   * @returns Failure plus whether only the rescue watchdog settled the operation.
   */
  async function timedFailure(
    value: SAPAILanguageModel,
    operation: Operation,
  ): Promise<{ error: unknown; watchdogFired: boolean }> {
    const controller = new AbortController();
    const result = invoke(value, operation, controller.signal);
    const timeout = setTimeout(() => {
      controller.abort("fixture watchdog: provider timeout did not settle");
    }, WATCHDOG);
    try {
      const error = await result;
      const first = requests[0];
      if (!first) throw new Error("Expected a real HTTP request");
      await first.closed;
      return { error, watchdogFired: controller.signal.aborted };
    } finally {
      clearTimeout(timeout);
    }
  }

  it("retains response-body timeout behavior with the default redirect adapter", async () => {
    const result = await timedFailure(model(false), "doGenerate");
    expect(result.watchdogFired).toBe(false);
    expect(result.error).toMatchObject({ isRetryable: true, statusCode: 503 });
    expect(requests[0]?.socket.destroyed).toBe(true);
  });

  it.each([
    { clarifyTimeoutError: false, operation: "doGenerate" },
    { clarifyTimeoutError: true, operation: "doStream" },
  ] as const)(
    "$operation enforces its timeout after native-adapter HTTP 200 headers",
    async ({ clarifyTimeoutError, operation }) => {
      const value = model(true, 0, clarifyTimeoutError);
      const result = await timedFailure(value, operation);
      expect(result.watchdogFired).toBe(false);
      expect(result.error).toMatchObject({
        cause: {
          code: clarifyTimeoutError ? "ETIMEDOUT" : "ECONNABORTED",
          message: "Fixture custom timeout",
        },
        isRetryable: true,
        statusCode: 503,
      });
      expect(requests[0]?.socket.destroyed).toBe(true);
      if (operation === "doGenerate") {
        mode = "complete";
        expect(await invoke(value, "doGenerate")).toMatchObject({
          content: [{ text: "Fixture complete", type: "text" }],
        });
        const recovered = requests[1];
        if (!recovered) throw new Error("Expected a recovered HTTP connection");
        await delay(TIMEOUT * 2);
        expect(recovered.socket.destroyed).toBe(false);
        expect(await invoke(value, "doGenerate")).toMatchObject({
          content: [{ text: "Fixture complete", type: "text" }],
        });
        expect(requests[2]?.socket).toBe(recovered.socket);
      }
    },
  );

  it("preserves timeout defaults merged by the SAP client's CommonJS Axios instance", async () => {
    const require = createRequire(import.meta.url);
    const cloudRequire = createRequire(require.resolve("@sap-cloud-sdk/http-client"));
    const axios: unknown = cloudRequire("axios");
    if (
      (typeof axios !== "object" && typeof axios !== "function") ||
      axios === null ||
      !("defaults" in axios) ||
      typeof axios.defaults !== "object" ||
      axios.defaults === null
    ) {
      throw new Error("Expected the SAP client's Axios defaults");
    }
    const defaults = axios.defaults as Record<string, unknown>;
    const transitional = defaults.transitional;
    if (typeof transitional !== "object" || transitional === null || Array.isArray(transitional)) {
      throw new Error("Expected Axios transitional defaults");
    }
    const originalMessage = Object.getOwnPropertyDescriptor(defaults, "timeoutErrorMessage");
    const originalTransitional = Object.getOwnPropertyDescriptor(defaults, "transitional");
    try {
      defaults.timeoutErrorMessage = "Fixture global deadline";
      defaults.transitional = { ...transitional, clarifyTimeoutError: true };
      const result = await timedFailure(model(), "doGenerate");
      expect(result.watchdogFired).toBe(false);
      expect(result.error).toMatchObject({
        cause: { code: "ETIMEDOUT", message: "Fixture global deadline" },
        isRetryable: true,
        statusCode: 503,
      });
      expect(requests[0]?.socket.destroyed).toBe(true);
    } finally {
      if (originalMessage) Object.defineProperty(defaults, "timeoutErrorMessage", originalMessage);
      else delete defaults.timeoutErrorMessage;
      if (originalTransitional)
        Object.defineProperty(defaults, "transitional", originalTransitional);
      else delete defaults.transitional;
    }
  });

  it("enforces inactivity timeout while consuming a native-adapter stream", async () => {
    mode = "output-then-idle";
    const result = await timedFailure(model(), "doStream");
    expect(result.watchdogFired).toBe(false);
    expect(result.error).toMatchObject({ isRetryable: true, statusCode: 503 });
    expect(requests[0]?.socket.destroyed).toBe(true);
  });

  it("keeps active SSE open beyond several timeout intervals", async () => {
    mode = "active";
    const controller = new AbortController();
    const watchdog = setTimeout(() => {
      controller.abort("fixture active-stream watchdog");
    }, WATCHDOG);
    try {
      const started = performance.now();
      expect(await invoke(model(), "doStream", controller.signal)).toBe("Fixture complete");
      expect(performance.now() - started).toBeGreaterThanOrEqual(TIMEOUT * 2);
      expect(controller.signal.aborted).toBe(false);
    } finally {
      clearTimeout(watchdog);
    }
  });

  it("keeps caller cancellation distinct from the body timeout", async () => {
    const controller = new AbortController();
    const result = invoke(model(), "doGenerate", controller.signal);
    await ready;
    const first = requests[0];
    if (!first) throw new Error("Expected an idle HTTP response");

    controller.abort("fixture caller stopped");

    expect(await result).toMatchObject({ isRetryable: false, statusCode: 499 });
    await first.closed;
    expect(first.socket.destroyed).toBe(true);
  });

  it("distinguishes stalled and complete bodies while configured middleware waits", async () => {
    const value = model(true, TIMEOUT * 2);
    const result = await timedFailure(value, "doGenerate");
    expect(result.watchdogFired).toBe(false);
    expect(result.error).toMatchObject({ isRetryable: true, statusCode: 503 });
    expect(requests[0]?.socket.destroyed).toBe(true);

    mode = "complete";
    expect(await invoke(value, "doGenerate")).toMatchObject({
      content: [{ text: "Fixture complete", type: "text" }],
    });
  });

  it("preserves a timed-out HTTP failure's status, headers, and received prefix", async () => {
    status = 503;
    const result = await timedFailure(model(), "doGenerate");
    expect(result.watchdogFired).toBe(false);
    expect(result.error).toMatchObject({
      isRetryable: true,
      responseBody: "<html>Fixture unavailable",
      responseHeaders: { "retry-after": "7", "x-request-id": "fixture-timeout" },
      statusCode: 503,
    });
    expect(requests[0]?.socket.destroyed).toBe(true);
  });
});
