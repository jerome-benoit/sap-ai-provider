/** Caller cancellation during real SAP deployment discovery. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider-v3";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { NoSuchModelError, TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

const options: LanguageModelV3CallOptions = {
  prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
};

describe("SAP deployment discovery cancellation", () => {
  it.each(
    (["responses", "foundation-models"] as const).flatMap((api) =>
      (["doGenerate", "doStream"] as const).map((operation) => ({ api, operation })),
    ),
  )(
    "$api $operation safely reports an empty custom-destination discovery",
    async ({ api, operation }) => {
      const sentinel = "custom-destination-discovery-credential";
      const requests: string[] = [];
      const server = createServer((request, response) => {
        request.resume();
        requests.push(request.headers["x-api-key"] as string);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ count: 0, resources: [] }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const model = createSAPAIProvider({
          api,
          destination: {
            authentication: "NoAuthentication",
            headers: { "x-api-key": sentinel },
            url: `http://127.0.0.1:${String(port)}`,
          },
          logLevel: "error",
        })("absent-discovery-fixture");
        const error: unknown = await model[operation](options).catch((error: unknown) => error);

        expect(requests).toEqual([sentinel]);
        expect(NoSuchModelError.isInstance(error)).toBe(true);
        if (!NoSuchModelError.isInstance(error))
          throw new Error("Expected a safe discovery failure");
        expect(error.modelId).toBe("absent-discovery-fixture");
        expect(error.modelType).toBe("languageModel");
        expect(error.cause).toBeUndefined();
        for (const summary of [error.message, String(error), error.stack, JSON.stringify(error)]) {
          expect(summary).not.toContain(sentinel);
          expect(summary).not.toContain("NoAuthentication");
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    },
  );

  it.each(
    (["responses", "orchestration", "foundation-models"] as const).flatMap((api) =>
      (api === "responses"
        ? (["doGenerate", "doStream"] as const)
        : (["doGenerate", "doStream", "doEmbed"] as const)
      ).flatMap((operation) =>
        (["valid", "failure"] as const).map((settlement) => ({ api, operation, settlement })),
      ),
    ),
  )(
    "$api $operation aborts before discovery release and handles late $settlement",
    async ({ api, operation, settlement }) => {
      let response: ServerResponse | undefined;
      let requestReceived!: () => void;
      let inferenceSettled!: () => void;
      const received = new Promise<void>((resolve) => {
        requestReceived = resolve;
      });
      const settled = new Promise<void>((resolve) => {
        inferenceSettled = resolve;
      });
      const requests: string[] = [];
      const server = createServer((request, incomingResponse) => {
        request.resume();
        requests.push(`${request.method ?? ""} ${request.url ?? ""}`);
        if (request.method === "GET") {
          response = incomingResponse;
          requestReceived();
        } else {
          incomingResponse.end("{}");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const caller = new AbortController();
      const reason = new Error("cancelled during SAP discovery");
      // SAP caches deployments without the destination in its key.
      const resourceGroup = `cancel-${api}-${operation}-${settlement}`;
      const modelId = `cancel-model-${operation}-${settlement}`;
      const provider = createSAPAIProvider({
        api,
        destination: {
          authentication: "NoAuthentication",
          url: `http://127.0.0.1:${String(port)}`,
        },
        logLevel: "error",
        requestConfig: {
          middleware: [
            ({ fn }) =>
              async (request) => {
                try {
                  return await fn(request);
                } finally {
                  inferenceSettled();
                }
              },
          ],
        },
        resourceGroup,
      });
      const failures: unknown[] = [];
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      const invocation = (
        operation === "doEmbed"
          ? provider.embedding(modelId).doEmbed({ abortSignal: caller.signal, values: ["Hello"] })
          : provider(modelId)[operation]({ ...options, abortSignal: caller.signal })
      ).catch((error: unknown) => {
        failures.push(error);
      });
      try {
        await Promise.race([received, invocation]);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toContain("GET /v2/lm/deployments");
        caller.abort(reason);
        await invocation;
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ isRetryable: false, statusCode: 499 });
        if (!response) throw new Error("Expected held deployment discovery");
        response.setHeader("content-type", "application/json");
        if (settlement === "valid") {
          response.end(
            JSON.stringify({
              count: 1,
              resources: [
                {
                  deploymentUrl: `http://127.0.0.1:${String(port)}/inference/deployments/cancel-fixture`,
                  details: { resources: { backendDetails: { model: { name: modelId } } } },
                  id: "cancel-fixture",
                  status: "RUNNING",
                },
              ],
            }),
          );
          // Native clients finish discovery, then reach transport with their signal aborted.
          if (api !== "responses") await settled;
        } else {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: { message: "late discovery failure" } }));
        }
        await setImmediate();
        await setImmediate();
        expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
        expect(failures).toHaveLength(1);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        caller.abort(reason);
        response?.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
        await invocation;
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );

  it.each(["orchestration", "foundation-models"] as const)(
    "%s preserves embedding batch-limit priority before cancellation",
    async (api) => {
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url ?? "");
        response.end("{}");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const model = createSAPAIProvider({
          api,
          destination: {
            authentication: "NoAuthentication",
            url: `http://127.0.0.1:${String(port)}`,
          },
        }).embedding("cancelled-embedding", { maxEmbeddingsPerCall: 1 });
        const abortSignal = AbortSignal.abort("already stopped");
        await expect(model.doEmbed({ abortSignal, values: ["one"] })).rejects.toMatchObject({
          isRetryable: false,
          statusCode: 499,
        });
        await expect(model.doEmbed({ abortSignal, values: ["one", "two"] })).rejects.toBeInstanceOf(
          TooManyEmbeddingValuesForCallError,
        );
        expect(requests).toEqual([]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
      }
    },
  );
});
