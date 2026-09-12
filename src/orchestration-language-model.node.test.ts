/** Orchestration contract regressions using the real SAP SDK and a local HTTP endpoint. */
import type { LanguageModelV4CallOptions, SharedV4Warning } from "@ai-sdk/provider";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import type { OrchestrationModelSettings } from "./sap-ai-settings.js";

import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";

interface WireBody {
  config?: { modules?: WireModule | WireModule[]; stream?: { enabled?: boolean } };
  config_ref?: unknown;
  messages_history?: unknown[];
  placeholder_values?: Record<string, string>;
  stream?: boolean;
  tools?: { function: { name: string; strict?: boolean } }[];
}

interface WireModule {
  filtering?: unknown;
  grounding?: unknown;
  masking?: unknown;
  prompt_templating: {
    model: { name: string; params?: Record<string, unknown>; version?: string };
    prompt: {
      response_format?: unknown;
      template?: unknown[];
      template_ref?: unknown;
      tools?: unknown[];
    };
  };
  translation?: unknown;
}

const prompt: LanguageModelV4CallOptions["prompt"] = [
  { content: [{ text: "Hello", type: "text" }], role: "user" },
];
const tools: LanguageModelV4CallOptions["tools"] = [
  {
    inputSchema: { properties: { answer: { type: "string" } }, type: "object" },
    name: "answer",
    type: "function",
  },
];
const reply = {
  choices: [{ finish_reason: "stop", index: 0, message: { content: "ok", role: "assistant" } }],
  id: "http-response",
  usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
};

describe("Orchestration serialized HTTP configuration", () => {
  const bodies: WireBody[] = [];
  const headers: IncomingHttpHeaders[] = [];
  let reportUsage = true;
  let streamScenario: "default" | "idle" | "mixed" | "queued" = "default";
  let onStreamClosed: (() => void) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      let data = "";
      for await (const chunk of request) data += String(chunk);
      const body = JSON.parse(data) as WireBody;
      bodies.push(body);
      headers.push(request.headers);
      const foundationModels = request.url?.includes("/chat/completions") ?? false;
      if (body.config?.stream?.enabled || body.stream) {
        response.setHeader("content-type", "text/event-stream");
        if (streamScenario !== "default") {
          const first = {
            choices: [
              {
                delta: {
                  content: "I will look that up.",
                  tool_calls: [
                    {
                      function: { arguments: "{}", name: "lookup" },
                      id: "lookup-1",
                      index: 0,
                      type: "function",
                    },
                  ],
                },
                finish_reason: streamScenario === "queued" ? "tool_calls" : undefined,
                index: 0,
              },
            ],
            citations: [{ ref_id: 1, title: "Source", url: "https://example.com/source" }],
            id: "stream-completion",
            usage: {
              completion_tokens: 20,
              completion_tokens_details: { reasoning_tokens: 5 },
              prompt_tokens: 100,
              prompt_tokens_details: {
                cache_creation_token_details: { ephemeral_5m_input_tokens: 10 },
                cache_creation_tokens: 10,
                cached_tokens: 30,
              },
              total_tokens: 120,
            },
          };
          const event = (
            value: unknown,
          ) => `data: ${JSON.stringify(foundationModels ? value : { final_result: value, request_id: "stream-request" })}

`;
          response.write(event(first));
          if (streamScenario === "idle" || streamScenario === "queued") {
            // Complete the SSE delimiter even with SDK versions that buffer its final byte.
            response.write("\n");
            response.on("close", () => onStreamClosed?.());
            return;
          }
          response.end(
            event({
              choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
              usage: { completion_tokens: 20, prompt_tokens: 100, total_tokens: 120 },
            }) + "data: [DONE]\n\n",
          );
          return;
        }
        const final = {
          choices: [{ delta: { content: "ok" }, finish_reason: "stop", index: 0 }],
          id: reply.id,
          ...(reportUsage ? { usage: reply.usage } : {}),
        };
        response.end(
          `data: ${JSON.stringify(foundationModels ? final : { final_result: final, request_id: "http-request" })}\n\ndata: [DONE]\n\n`,
        );
      } else {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify(
            foundationModels ? reply : { final_result: reply, request_id: "http-request" },
          ),
        );
      }
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
  });
  let provider: SAPAIProviderV4;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    provider = createSAPAIProviderV4({
      deploymentId: "http-deployment",
      destination: {
        authentication: "NoAuthentication",
        url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
      },
      requestConfig: { headers: { "X-Keep": "default", "X-Replace": "default" } },
    });
  });
  beforeEach(() => {
    bodies.length = 0;
    headers.length = 0;
    reportUsage = true;
    streamScenario = "default";
    onStreamClosed = undefined;
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
   * Exercises the provider through the real SDK and consumes its response.
   * @param streaming - Whether to consume the streaming endpoint.
   * @param settings - Model-level configuration.
   * @param options - Per-call generation options.
   * @returns Captured HTTP payload and consumer-visible warnings.
   */
  async function call(
    streaming: boolean,
    settings: OrchestrationModelSettings = {},
    options: Partial<LanguageModelV4CallOptions> = {},
  ): Promise<{ body: WireBody; warnings: SharedV4Warning[] }> {
    const model = provider("gpt-4.1", settings);
    let warnings: SharedV4Warning[] = [];
    if (streaming) {
      const result = await model.doStream({ prompt, ...options });
      const reader = result.stream.getReader();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "error") throw value.error;
        if (value.type === "stream-start") warnings = value.warnings;
        if (value.type === "text-delta") text += value.delta;
      }
      expect(text).toBe("ok");
    } else {
      const result = await model.doGenerate({ prompt, ...options });
      expect(result.content).toContainEqual({ text: "ok", type: "text" });
      warnings = result.warnings;
    }
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    if (!body) throw new Error("Expected a serialized HTTP request");
    return { body, warnings };
  }

  /**
   * Selects the primary local configuration in either SDK payload shape.
   * @param body - Serialized HTTP request.
   * @returns Primary orchestration module configuration.
   */
  function primary(body: WireBody): WireModule {
    const modules = body.config?.modules;
    const module = Array.isArray(modules) ? modules[0] : modules;
    if (!module) throw new Error("Expected local orchestration modules");
    return module;
  }

  describe.each(["orchestration", "foundation-models"] as const)("%s stream contract", (api) => {
    it.each([false, true])("merges per-call HTTP headers (streaming=%s)", async (streaming) => {
      const model = provider("gpt-4.1", { api });
      const options = {
        headers: { "x-call": "call", "x-keep": undefined, "x-replace": "call" },
        prompt,
      };
      if (streaming) {
        const { stream } = await model.doStream(options);
        for await (const part of stream) {
          if (part.type === "error") throw part.error;
        }
      } else {
        await model.doGenerate(options);
      }
      expect(headers).toHaveLength(1);
      expect(headers[0]).toMatchObject({
        "x-call": "call",
        "x-keep": "default",
        "x-replace": "call",
      });
    });

    it("keeps usage unknown when no stream chunk reports it", async () => {
      reportUsage = false;
      const { stream } = await provider("gpt-4.1", { api }).doStream({ prompt });
      const parts = [];
      for await (const part of stream) parts.push(part);
      const finish = parts.find((part) => part.type === "finish");
      expect(finish).toBeDefined();
      expect(finish?.usage.inputTokens.total).toBeUndefined();
      expect(finish?.usage.outputTokens.total).toBeUndefined();
    });

    it("preserves explicit strict tool settings without enabling an omitted setting", async () => {
      await provider("gpt-4.1", { api }).doGenerate({
        prompt,
        tools: [true, false, undefined].map((strict, index) => ({
          inputSchema: { additionalProperties: false, properties: {}, type: "object" },
          name: `tool${String(index)}`,
          strict,
          type: "function",
        })),
      });
      const body = bodies[0];
      if (!body) throw new Error("Expected request");
      const sentTools =
        api === "orchestration" ? primary(body).prompt_templating.prompt.tools : body.tools;
      expect(sentTools).toMatchObject([
        { function: { name: "tool0", strict: true } },
        { function: { name: "tool1", strict: false } },
        { function: { name: "tool2" } },
      ]);
      expect((sentTools?.[2] as { function: unknown }).function).not.toHaveProperty("strict");
    });

    it("preserves mixed text, tool input, server IDs and detailed usage across chunks", async () => {
      streamScenario = "mixed";
      const { stream } = await provider("gpt-4.1", { api }).doStream({ prompt });
      const parts = [];
      for await (const part of stream) parts.push(part);
      expect(
        parts
          .filter((part) => part.type === "text-delta")
          .map((part) => part.delta)
          .join(""),
      ).toBe("I will look that up.");
      expect(parts).toContainEqual({
        input: "{}",
        toolCallId: "lookup-1",
        toolName: "lookup",
        type: "tool-call",
      });
      expect(parts.filter((part) => part.type === "tool-input-start")).toHaveLength(1);
      expect(parts.filter((part) => part.type === "tool-input-end")).toHaveLength(1);
      expect(parts).toContainEqual(
        expect.objectContaining({ id: "stream-completion", type: "response-metadata" }),
      );
      const finish = parts.find((part) => part.type === "finish");
      expect(finish).toMatchObject({
        finishReason: { unified: "tool-calls" },
        providerMetadata: {
          "sap-ai": {
            cacheUsage: { ephemeral_5m_input_tokens: 10 },
            responseId: "stream-completion",
          },
        },
        usage: {
          inputTokens: { cacheRead: 30, cacheWrite: 10, noCache: 60, total: 100 },
          outputTokens: { reasoning: 5, text: 15, total: 20 },
        },
      });
      if (api === "orchestration") {
        expect(finish?.providerMetadata).toMatchObject({
          "sap-ai": { requestId: "stream-request" },
        });
        expect(parts).toContainEqual({
          id: "1",
          sourceType: "url",
          title: "Source",
          type: "source",
          url: "https://example.com/source",
        });
      }
    });

    it("does not dispatch an already-aborted request", async () => {
      await expect(
        provider("gpt-4.1", { api }).doStream({ abortSignal: AbortSignal.abort(), prompt }),
      ).rejects.toMatchObject({ isRetryable: false, statusCode: 499 });
      expect(bodies).toEqual([]);
    });

    it("does not finalize tool calls or report success after an in-flight abort", async () => {
      streamScenario = "idle";
      const controller = new AbortController();
      const reason = new Error("Caller canceled generation");
      const { stream } = await provider("gpt-4.1", { api }).doStream({
        abortSignal: controller.signal,
        prompt,
      });
      const parts = [];
      for await (const part of stream) {
        parts.push(part);
        if (part.type === "text-delta") controller.abort(reason);
      }
      expect(parts.find((part) => part.type === "error")?.error).toMatchObject({
        cause: { cause: reason },
        isRetryable: false,
        statusCode: 499,
      });
      expect(parts.some((part) => part.type === "finish" || part.type === "tool-call")).toBe(false);
    }, 2000);
    it("does not convert a prefetched tool-call chunk after cancellation", async () => {
      streamScenario = "queued";
      const controller = new AbortController();
      const { stream } = await provider("gpt-4.1", { api }).doStream({
        abortSignal: controller.signal,
        prompt,
      });
      await setImmediate();
      controller.abort();
      const parts = [];
      for await (const part of stream) parts.push(part);
      expect(parts.find((part) => part.type === "error")?.error).toMatchObject({
        isRetryable: false,
        statusCode: 499,
      });
      expect(parts.some((part) => part.type === "finish" || part.type === "tool-call")).toBe(false);
    }, 2000);

    it("closes idle HTTP transport when its reader is canceled", async () => {
      streamScenario = "idle";
      const closed = new Promise<void>((resolve) => {
        onStreamClosed = resolve;
      });
      const { stream } = await provider("gpt-4.1", { api }).doStream({ prompt });
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Stream ended before cancellation");
        if (value.type === "text-delta") break;
      }
      await reader.cancel();
      await closed;
    }, 2000);
  });

  describe.each([false, true])("streaming=%s", (streaming) => {
    it("sends resolved parameters, tools, format and all local modules", async () => {
      const settings: OrchestrationModelSettings = {
        filtering: { input: { filters: [] } },
        grounding: {
          config: { placeholders: { input: ["question"], output: "context" } },
          type: "document_grounding_service",
        },
        masking: { masking_providers: [] },
        modelParams: {
          custom: { replaced: "settings", retained: true },
          maxTokens: 10,
          reasoning_effort: "low",
          temperature: 0.8,
          tool_choice: "none",
          topK: 20,
        },
        modelVersion: "latest",
        responseFormat: { type: "json_object" },
        tools: [{ function: { name: "settings_tool" }, type: "function" }],
        translation: {
          input: {
            config: { source_language: "en", target_language: "de" },
            type: "sap_document_translation",
          },
        },
      };
      const { body } = await call(streaming, settings, {
        frequencyPenalty: 0,
        maxOutputTokens: 27,
        presencePenalty: 1,
        providerOptions: {
          "sap-ai": {
            modelParams: {
              custom: { replaced: "provider" },
              parallel_tool_calls: false,
              reasoning_effort: "medium",
              temperature: 0.4,
              topK: 40,
              topP: 0.7,
            },
          },
        },
        reasoning: "high",
        responseFormat: {
          name: "answer",
          schema: { properties: { answer: { type: "string" } }, type: "object" },
          type: "json",
        },
        seed: 3,
        stopSequences: ["END"],
        temperature: 0,
        toolChoice: { type: "required" },
        tools,
      });
      const module = primary(body);
      expect(module.prompt_templating.model).toMatchObject({
        name: "gpt-4.1",
        params: {
          custom: { replaced: "provider", retained: true },
          frequency_penalty: 0,
          max_completion_tokens: 27,
          parallel_tool_calls: false,
          presence_penalty: 1,
          reasoning_effort: "high",
          seed: 3,
          stop: ["END"],
          temperature: 0,
          tool_choice: "required",
          top_k: 40,
          top_p: 0.7,
        },
        version: "latest",
      });
      expect(module.prompt_templating.model.params).not.toHaveProperty("maxTokens");
      expect(module.prompt_templating.model.params).not.toHaveProperty("topP");
      expect(module.prompt_templating.prompt).toMatchObject({
        response_format: {
          json_schema: {
            name: "answer",
            schema: { properties: { answer: { type: "string" } }, type: "object" },
          },
          type: "json_schema",
        },
        template: [{ content: "Hello", role: "user" }],
        tools: [{ function: { name: "answer" }, type: "function" }],
      });
      expect(module.prompt_templating.prompt.tools).toHaveLength(1);
      for (const key of ["filtering", "grounding", "masking", "translation"] as const) {
        expect(module[key]).toEqual(settings[key]);
      }
    });

    it("keeps provider-default from erasing explicit model parameters", async () => {
      const { body } = await call(
        streaming,
        {
          modelParams: { reasoning_effort: "low", topP: 0.8 },
        },
        {
          providerOptions: {
            "sap-ai": { modelParams: { reasoning_effort: "medium", top_p: 0.4 } },
          },
          reasoning: "provider-default",
        },
      );
      expect(primary(body).prompt_templating.model.params).toMatchObject({
        reasoning_effort: "medium",
        top_p: 0.8,
      });
    });

    it("keeps template references and placeholder precedence with local configuration", async () => {
      const { body } = await call(
        streaming,
        {
          modelParams: { reasoning_effort: "low" },
          placeholderValues: { kept: "settings", replaced: "settings" },
          promptTemplateRef: { id: "settings-template" },
          responseFormat: { type: "json_object" },
          tools: [{ function: { name: "settings_tool" }, type: "function" }],
        },
        {
          providerOptions: {
            "sap-ai": {
              placeholderValues: { replaced: "provider" },
              promptTemplateRef: { name: "prompt", scenario: "scenario", version: "1" },
            },
          },
          responseFormat: { type: "text" },
          tools: [],
        },
      );
      expect(primary(body).prompt_templating).toMatchObject({
        model: { params: { reasoning_effort: "low" } },
        prompt: {
          response_format: { type: "json_object" },
          template_ref: { name: "prompt", scenario: "scenario", version: "1" },
          tools: [{ function: { name: "settings_tool" }, type: "function" }],
        },
      });
      expect(body.messages_history).toEqual([{ content: "Hello", role: "user" }]);
      expect(body.placeholder_values).toEqual({ kept: "settings", replaced: "provider" });
    });

    it("preserves independent fallback model configuration", async () => {
      const { body } = await call(
        streaming,
        {
          fallbackModuleConfigs: [
            {
              promptTemplating: {
                model: { name: "gpt-4o", params: { temperature: 0.1 } },
                prompt: { template: [] },
              },
            },
          ],
        },
        { reasoning: "high", temperature: 0.9 },
      );
      expect(body.config?.modules).toMatchObject([
        {
          prompt_templating: {
            model: { name: "gpt-4.1", params: { reasoning_effort: "high", temperature: 0.9 } },
          },
        },
        { prompt_templating: { model: { name: "gpt-4o", params: { temperature: 0.1 } } } },
      ]);
      if (!Array.isArray(body.config?.modules)) throw new Error("Expected fallback modules");
      expect(body.config.modules[1]?.prompt_templating.model.params).not.toHaveProperty(
        "reasoning_effort",
      );
    });

    it("lets a referenced config own model parameters and warns about ignored local options", async () => {
      const { body, warnings } = await call(
        streaming,
        {
          fallbackModuleConfigs: [{ promptTemplating: { model: { name: "ignored" } } }],
          modelParams: { reasoning_effort: "low" },
          orchestrationConfigRef: { id: "settings-config" },
        },
        {
          providerOptions: {
            "sap-ai": {
              orchestrationConfigRef: {
                id: "provider-config",
                overrideConfig: {
                  modules: { prompt_templating: { model: { name: "server-model" } } },
                },
              },
            },
          },
          reasoning: "high",
          temperature: 0,
        },
      );
      expect(body.config_ref).toEqual({ id: "provider-config" });
      expect(body.config?.modules).toEqual({
        prompt_templating: { model: { name: "server-model" } },
      });
      expect(body.messages_history).toEqual([{ content: "Hello", role: "user" }]);
      const ignored = warnings
        .filter((warning) => warning.type === "other")
        .map((warning) => warning.message)
        .join(" ");
      expect(ignored).toContain("options.reasoning");
      expect(ignored).toContain("options.temperature");
    });

    it("does not warn about provider-default under a referenced config", async () => {
      const { body, warnings } = await call(
        streaming,
        {
          orchestrationConfigRef: { id: "server-config" },
        },
        { reasoning: "provider-default" },
      );
      expect(body.config_ref).toEqual({ id: "server-config" });
      expect(warnings).toEqual([]);
    });
  });
  it("preserves only valid per-tool cache directives in the serialized prompt", async () => {
    const directives = [
      { ttl: "5m", type: "ephemeral" },
      { ttl: "1h", type: "ephemeral" },
      { type: "invalid" },
      undefined,
    ];
    const { body, warnings } = await call(
      false,
      {},
      {
        toolChoice: { toolName: "tool0", type: "tool" },
        tools: directives.map((cacheControl, index) => ({
          inputSchema: { properties: {}, type: "object" },
          name: `tool${String(index)}`,
          ...(cacheControl ? { providerOptions: { "sap-ai": { cacheControl } } } : {}),
          type: "function",
        })),
      },
    );
    const module = primary(body);
    expect(module.prompt_templating.model.params?.tool_choice).toEqual({
      function: { name: "tool0" },
      type: "function",
    });
    const sentTools = module.prompt_templating.prompt.tools;
    expect(sentTools).toMatchObject([
      { cache_control: { ttl: "5m", type: "ephemeral" }, function: { name: "tool0" } },
      { cache_control: { ttl: "1h", type: "ephemeral" }, function: { name: "tool1" } },
      { function: { name: "tool2" } },
      { function: { name: "tool3" } },
    ]);
    expect(sentTools?.[2]).not.toHaveProperty("cache_control");
    expect(sentTools?.[3]).not.toHaveProperty("cache_control");
    expect(warnings).toContainEqual(expect.objectContaining({ type: "other" }));
  });
});
