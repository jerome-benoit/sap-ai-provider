/** Caller cancellation during real SAP deployment discovery. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { NoSuchModelError } from "@ai-sdk/provider";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

const options: LanguageModelV3CallOptions = {
  prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
};

describe("Responses deployment discovery cancellation", () => {
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

  it.each(["doGenerate", "doStream"] as const)(
    "%s rejects cancellation while the SAP discovery response is still pending",
    async (operation) => {
      let response: ServerResponse | undefined;
      const requests: string[] = [];
      let requestReceived!: () => void;
      const received = new Promise<void>((resolve) => {
        requestReceived = resolve;
      });
      const server = createServer((request, incomingResponse) => {
        requests.push(request.url ?? "");
        response = incomingResponse;
        requestReceived();
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      const caller = new AbortController();
      const reason = new Error("cancelled during SAP discovery");
      const model = createSAPAIProvider({
        api: "responses",
        destination: {
          authentication: "NoAuthentication",
          url: `http://127.0.0.1:${String(port)}`,
        },
        logLevel: "error",
      })("gpt-6.1-sol");
      const failures: unknown[] = [];
      const invocation = model[operation]({ ...options, abortSignal: caller.signal }).catch(
        (error: unknown) => failures.push(error),
      );
      try {
        await Promise.race([received, invocation]);
        expect(requests).toHaveLength(1);
        const discoveryUrl = new URL(requests[0] ?? "", "http://fixture.test");
        expect(discoveryUrl.pathname).toBe("/v2/lm/deployments");
        expect(discoveryUrl.searchParams.get("scenarioId")).toBe("foundation-models");
        expect(discoveryUrl.searchParams.get("executableIds")).toBe("azure-openai");
        caller.abort(reason);
        await setImmediate();

        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          cause: { cause: reason, name: "AbortError" },
          isRetryable: false,
          statusCode: 499,
        });
        expect(requests).toHaveLength(1);
      } finally {
        caller.abort(reason);
        // SAP's current discovery helper has no signal option; release its fixture socket.
        response?.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        await invocation;
      }
    },
  );
});
