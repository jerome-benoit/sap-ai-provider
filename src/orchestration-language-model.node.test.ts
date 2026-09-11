/** Orchestration contract regressions using the real SAP SDK and a local HTTP endpoint. */
import type { LanguageModelV4CallOptions, SharedV4Warning } from "@ai-sdk/provider";
import type { AddressInfo } from "node:net";

import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import type { OrchestrationModelSettings } from "./sap-ai-settings.js";

import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";

interface WireBody {
  config: { modules?: WireModule | WireModule[]; stream?: { enabled?: boolean } };
  config_ref?: unknown;
  messages_history?: unknown[];
  placeholder_values?: Record<string, string>;
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
  const server = createServer((request, response) => {
    void (async () => {
      let data = "";
      for await (const chunk of request) data += String(chunk);
      const body = JSON.parse(data) as WireBody;
      bodies.push(body);
      if (body.config.stream?.enabled) {
        response.setHeader("content-type", "text/event-stream");
        response.end(
          `data: ${JSON.stringify({
            final_result: {
              choices: [{ delta: { content: "ok" }, finish_reason: "stop", index: 0 }],
              id: reply.id,
              usage: reply.usage,
            },
            request_id: "http-request",
          })}\n\ndata: [DONE]\n\n`,
        );
      } else {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ final_result: reply, request_id: "http-request" }));
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
    });
  });
  beforeEach(() => {
    bodies.length = 0;
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
    const modules = body.config.modules;
    const module = Array.isArray(modules) ? modules[0] : modules;
    if (!module) throw new Error("Expected local orchestration modules");
    return module;
  }

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
      expect(body.config.modules).toMatchObject([
        {
          prompt_templating: {
            model: { name: "gpt-4.1", params: { reasoning_effort: "high", temperature: 0.9 } },
          },
        },
        { prompt_templating: { model: { name: "gpt-4o", params: { temperature: 0.1 } } } },
      ]);
      if (!Array.isArray(body.config.modules)) throw new Error("Expected fallback modules");
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
      expect(body.config.modules).toEqual({
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
