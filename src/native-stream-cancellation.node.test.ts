/** Raw SDK stream ownership when cancellation races with startup and handoff. */
import type { HttpResponse } from "@sap-cloud-sdk/http-client";
import type { AddressInfo } from "node:net";

import { AzureOpenAiChatClient } from "@sap-ai-sdk/foundation-models";
import { OrchestrationClient } from "@sap-ai-sdk/orchestration";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

interface RawStream {
  readonly rawResponse: HttpResponse;
  readonly stream: {
    [Symbol.asyncIterator](): AsyncIterator<unknown>;
    readonly controller: AbortController;
  };
}

/**
 * Creates a controlled fixture without requiring ES2024 Promise APIs.
 * @returns Pending promise and its release callback.
 */
function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const prompt = [{ content: [{ text: "Hello", type: "text" as const }], role: "user" as const }];

describe.each(["orchestration", "foundation-models"] as const)(
  "%s raw stream cancellation",
  (api) => {
    it.each(["late", "leased-cancel", 1, 2, 3, 4] as const)(
      "releases native transport during %s cancellation",
      async (handoff) => {
        const ready = gate();
        const release = gate();
        const wireClosed = gate();
        const caller = new AbortController();
        let raw: RawStream | undefined;
        let nativeBody: unknown;
        let iteratorCalls = 0;
        let nativeRequest: undefined | { destroy: () => void };
        const inspectRaw = async (response: RawStream) => {
          raw = response;
          nativeBody = response.rawResponse.data;
          const iterator = response.stream[Symbol.asyncIterator].bind(response.stream);
          vi.spyOn(response.stream, Symbol.asyncIterator).mockImplementation(() => {
            iteratorCalls++;
            return iterator();
          });
          const request: unknown = response.rawResponse.request;
          if (
            typeof request !== "object" ||
            request === null ||
            !("destroy" in request) ||
            typeof request.destroy !== "function"
          ) {
            throw new Error("Expected a destroyable native request");
          }
          nativeRequest = request as { destroy: () => void };
          vi.spyOn(nativeRequest, "destroy");
          ready.resolve();
          if (handoff === "leased-cancel") {
            Object.defineProperty(response, "rawResponse", {
              get() {
                throw new Error("Optional SDK raw response metadata is unavailable");
              },
            });
          } else if (handoff === "late") {
            await release.promise;
          } else {
            const abortAfter = (remaining: number) => {
              if (remaining === 0) caller.abort("handoff cancellation");
              else
                queueMicrotask(() => {
                  abortAfter(remaining - 1);
                });
            };
            abortAfter(handoff);
          }
        };
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The captured implementation is invoked below with the original SDK instance through call().
        const orchestrationStream = OrchestrationClient.prototype.stream;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The captured implementation is invoked below with the original SDK instance through call().
        const foundationStream = AzureOpenAiChatClient.prototype.stream;
        const spy =
          api === "orchestration"
            ? vi.spyOn(OrchestrationClient.prototype, "stream").mockImplementation(async function (
                this: OrchestrationClient,
                request,
                signal,
                options,
                requestConfig,
              ) {
                const response = await orchestrationStream.call(
                  this,
                  request,
                  signal,
                  options,
                  requestConfig,
                );
                await inspectRaw(response);
                return response;
              })
            : vi
                .spyOn(AzureOpenAiChatClient.prototype, "stream")
                .mockImplementation(async function (
                  this: AzureOpenAiChatClient,
                  request,
                  signal,
                  requestConfig,
                ) {
                  const response = await foundationStream.call(
                    this,
                    request,
                    signal,
                    requestConfig,
                  );
                  await inspectRaw(response);
                  return response;
                });
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        const server = createServer((request, response) => {
          request.resume();
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write(": idle fixture\n\n");
          response.once("close", wireClosed.resolve);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        const model = createSAPAIProvider({
          api,
          deploymentId: "late-stream-fixture",
          destination: {
            authentication: "NoAuthentication",
            url: `http://127.0.0.1:${String(port)}`,
          },
        })("gpt-6.1-sol");
        const invocation = model.doStream({ abortSignal: caller.signal, prompt });
        const rejection =
          handoff === "leased-cancel"
            ? undefined
            : expect(invocation).rejects.toMatchObject({
                isRetryable: false,
                statusCode: 499,
              });
        try {
          await ready.promise;
          if (handoff === "leased-cancel") {
            const result = await invocation;
            await result.stream.cancel();
            await wireClosed.promise;
          }
          if (handoff === "late") {
            caller.abort("late startup cancellation");
            // Cancellation must settle before the SDK wrapper releases its raw value.
            await rejection;
            release.resolve();
          }
          await rejection;
          await setImmediate();
          expect(raw?.stream.controller.signal.aborted).toBe(true);
          const body = nativeBody;
          expect(body).toBeInstanceOf(Readable);
          if (!(body instanceof Readable)) throw new Error("Expected native response stream");
          expect(body.destroyed).toBe(true);
          expect(nativeRequest?.destroy).toHaveBeenCalled();
          if (handoff !== "leased-cancel") expect(iteratorCalls).toBe(0);
          expect(unhandled).not.toHaveBeenCalled();
        } finally {
          release.resolve();
          caller.abort();
          await invocation.catch(() => {
            // The expected cancellation was asserted before fixture teardown.
          });
          spy.mockRestore();
          server.closeAllConnections();
          await new Promise<void>((resolve) =>
            server.close(() => {
              resolve();
            }),
          );
          process.removeListener("unhandledRejection", unhandled);
        }
      },
    );
  },
);
