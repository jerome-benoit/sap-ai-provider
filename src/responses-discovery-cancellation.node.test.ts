/** Caller cancellation during real SAP deployment discovery. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider.js";

const options: LanguageModelV3CallOptions = {
  prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
};

describe("Responses deployment discovery cancellation", () => {
  it.each(["doGenerate", "doStream"] as const)(
    "%s rejects cancellation while the SAP discovery response is still pending",
    async (operation) => {
      let response: ServerResponse | undefined;
      const requests: string[] = [];
      const server = createServer((request, incomingResponse) => {
        requests.push(request.url ?? "");
        response = incomingResponse;
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
        await vi.waitFor(() => {
          expect(requests).toHaveLength(1);
        });
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
