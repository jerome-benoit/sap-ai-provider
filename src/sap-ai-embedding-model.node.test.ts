/** Embedding contract regressions through the real SAP SDK and a local HTTP endpoint. */
import type { AddressInfo } from "node:net";

import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createSAPAIProvider } from "./sap-ai-provider.js";

const inputSchema = z.object({
  input: z.union([z.array(z.string()), z.object({ text: z.array(z.string()) })]),
});

let abortRequest: (() => void) | undefined;
let requestClosed: (() => void) | undefined;

const server = createServer((request, response) => {
  void (async () => {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const { input } = inputSchema.parse(JSON.parse(raw));
    const values = Array.isArray(input) ? input : input.text;
    if (request.headers["x-abort"] === "true") {
      response.on("close", () => requestClosed?.());
      abortRequest?.();
      return;
    }
    if (
      request.headers["x-check-headers"] === "true" &&
      (request.headers["x-provider"] !== "retained" ||
        request.headers["x-overridden"] !== "call" ||
        request.headers["x-optional"] !== "default" ||
        request.headers["ai-resource-group"] !== "default")
    ) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Required request headers missing" } }));
      return;
    }
    const result = {
      data: values
        .map((value, index) => ({ embedding: [value.length], index, object: "embedding" }))
        .reverse(),
      usage: { prompt_tokens: values.length, total_tokens: values.length },
    };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url?.includes("/v2/embeddings")
          ? { final_result: result, request_id: "embedding-http" }
          : result,
      ),
    );
  })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
});

let url: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
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

describe("Embedding HTTP contracts", () => {
  it("embeds the requested values even when model parameters contain a reserved input", async () => {
    const provider = createSAPAIProvider({
      api: "foundation-models",
      deploymentId: "embedding-http",
      destination: { authentication: "NoAuthentication", url },
    });
    const model = provider.embedding("text-embedding-3-small", {
      maxEmbeddingsPerCall: 1,
      modelParams: { input: ["settings replacement", "extra input"] },
    });
    const settingsResult = await model.doEmbed({ values: ["ok"] });
    expect(settingsResult.embeddings).toEqual([[2]]);
    const callResult = await model.doEmbed({
      providerOptions: { "sap-ai": { modelParams: { input: ["call replacement", "extra"] } } },
      values: ["hello"],
    });
    expect(callResult.embeddings).toEqual([[5]]);
  });

  it.each(["orchestration", "foundation-models"] as const)(
    "sends call headers with provider defaults and SAP routing intact (%s)",
    async (api) => {
      const provider = createSAPAIProvider({
        api,
        deploymentId: "embedding-http",
        destination: { authentication: "NoAuthentication", url },
        requestConfig: {
          headers: {
            "X-Check-Headers": "true",
            "X-Optional": "default",
            "X-Overridden": "provider",
            "X-Provider": "retained",
          },
        },
      });
      const model = provider.embedding("text-embedding-3-small");
      const result = await model.doEmbed({
        headers: { "x-overridden": "call" },
        values: ["hello", "ok"],
      });
      expect(result.embeddings).toEqual([[5], [2]]);
    },
  );

  it.each(["orchestration", "foundation-models"] as const)(
    "cancels an in-flight embedding request (%s)",
    async (api) => {
      const controller = new AbortController();
      const closed = new Promise<void>((resolve) => {
        requestClosed = resolve;
      });
      abortRequest = () => {
        controller.abort();
      };
      const provider = createSAPAIProvider({
        api,
        deploymentId: "embedding-http",
        destination: { authentication: "NoAuthentication", url },
        requestConfig: { headers: { "x-abort": "true" } },
      });
      try {
        await expect(
          provider.embedding("text-embedding-3-small").doEmbed({
            abortSignal: controller.signal,
            values: ["cancel me"],
          }),
        ).rejects.toMatchObject({ isRetryable: false, statusCode: 499 });
        await closed;
      } finally {
        abortRequest = undefined;
        requestClosed = undefined;
      }
    },
  );
});
