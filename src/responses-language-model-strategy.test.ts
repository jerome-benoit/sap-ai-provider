/** Responses request mapping with the real OpenAI serializer in Node and Edge. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
} from "@ai-sdk/provider";

import { APICallError } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SAPAISettings } from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { ResponsesLanguageModelStrategy } from "./responses-language-model-strategy.js";

const transport = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  resolve: vi.fn(),
}));
vi.mock("./responses-http-transport.js", () => ({
  createResponsesTransport: transport.resolve,
}));

const config: LanguageModelStrategyConfig = {
  deploymentConfig: { deploymentId: "fixture" },
  modelId: "gpt-6.1-sol",
  provider: "sap-custom.chat",
};
const options: LanguageModelV3CallOptions = {
  prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
};

describe("Responses request mapping", () => {
  const strategy = new ResponsesLanguageModelStrategy();
  let body: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    transport.resolve.mockResolvedValue({
      baseURL: "https://fixture.example/responses-deployment",
      fetch: transport.fetch,
    });
    transport.fetch.mockImplementation((_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      body = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(
        Response.json({
          created_at: 1_798_000_000,
          id: "response-fixture",
          model: config.modelId,
          output: [],
          status: "completed",
          usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
        }),
      );
    });
  });

  it("uses stateless history without imposing a reasoning effort", async () => {
    await strategy.doGenerate(config, { api: "responses" }, options);

    expect(body).toMatchObject({ model: config.modelId, store: false });
    expect(body).not.toHaveProperty("reasoning");
    expect(body.include).toContain("reasoning.encrypted_content");
  });

  it("merges defaults and per-call Responses options without losing explicit false values", async () => {
    await strategy.doGenerate(
      {
        ...config,
        parsedProviderOptions: {
          responses: { parallelToolCalls: false, reasoningEffort: "high", store: true },
        },
      },
      {
        api: "responses",
        modelParams: { parallel_tool_calls: true },
        responses: { reasoningEffort: "low", store: false, textVerbosity: "low" },
      },
      options,
    );

    expect(body).toMatchObject({
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      store: true,
      text: { verbosity: "low" },
    });
  });

  it("gives common AI SDK call parameters precedence over model defaults", async () => {
    await strategy.doGenerate(
      { ...config, modelId: "gpt-4.1" },
      {
        api: "responses",
        modelParams: { maxTokens: 100, temperature: 1, topP: 0.8 },
      },
      { ...options, maxOutputTokens: 200, temperature: 0.2, topP: 0.5 },
    );

    expect(body).toMatchObject({ max_output_tokens: 200, temperature: 0.2, top_p: 0.5 });
  });

  it("honors AI SDK 7 reasoning while preserving provider defaults when unspecified", async () => {
    const withReasoning: LanguageModelV3CallOptions & { reasoning: string } = {
      ...options,
      reasoning: "high",
    };
    const providerDefault = { ...withReasoning, reasoning: "provider-default" };
    await strategy.doGenerate(
      config,
      {
        api: "responses",
        responses: { reasoningEffort: "low" },
      },
      withReasoning,
    );
    expect(body.reasoning).toEqual({ effort: "high" });

    await strategy.doGenerate(
      config,
      {
        api: "responses",
        responses: { reasoningEffort: "low" },
      },
      providerDefault,
    );
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("reports unsupported legacy parameters instead of silently discarding them", async () => {
    const result = await strategy.doGenerate(
      { ...config, parsedProviderOptions: { includeReasoning: true } },
      {
        api: "responses",
        modelParams: { n: 2, seed: 7 },
      },
      options,
    );

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feature: "modelParams.n", type: "unsupported" }),
        expect.objectContaining({ feature: "modelParams.seed", type: "unsupported" }),
        expect.objectContaining({ feature: "includeReasoning", type: "unsupported" }),
      ]),
    );
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("seed");
  });

  it("maps configured JSON output and allows a call to override it", async () => {
    const settings: SAPAISettings = {
      api: "responses",
      responseFormat: { type: "json_object" },
    };
    await strategy.doGenerate(config, settings, options);
    expect(body.text).toMatchObject({ format: { type: "json_object" } });

    await strategy.doGenerate(config, settings, { ...options, responseFormat: { type: "text" } });
    expect(body.text).toBeUndefined();

    await strategy.doGenerate(
      config,
      {
        api: "responses",
        responseFormat: {
          json_schema: {
            description: "An answer",
            name: "answer",
            schema: { properties: { answer: { type: "string" } }, type: "object" },
            strict: false,
          },
          type: "json_schema",
        },
      },
      options,
    );
    expect(body.text).toMatchObject({
      format: { description: "An answer", name: "answer", strict: false, type: "json_schema" },
    });
  });

  it("preserves explicit strict tools and custom file IDs in tool results", async () => {
    await strategy.doGenerate(
      config,
      { api: "responses" },
      {
        prompt: [
          { content: "Be helpful", role: "system" },
          ...options.prompt,
          {
            content: [{ input: {}, toolCallId: "call-1", toolName: "inspect", type: "tool-call" }],
            role: "assistant",
          },
          {
            content: [
              {
                output: {
                  type: "content",
                  value: [
                    { fileId: { "sap-custom": "file-1" }, type: "file-id" },
                    {
                      fileId: { "sap-custom": "image-1" },
                      providerOptions: { "sap-custom": { imageDetail: "low" } },
                      type: "image-file-id",
                    },
                  ],
                },
                toolCallId: "call-1",
                toolName: "inspect",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
        ],
        tools: [
          {
            inputSchema: { properties: {}, type: "object" },
            name: "inspect",
            strict: true,
            type: "function",
          },
        ],
      },
    );

    expect(body.tools).toContainEqual(expect.objectContaining({ name: "inspect", strict: true }));
    expect(body.input).toContainEqual({
      call_id: "call-1",
      output: [
        { file_id: "file-1", type: "input_file" },
        { detail: "low", file_id: "image-1", type: "input_image" },
      ],
      type: "function_call_output",
    });
  });

  it("validates native Responses options before sending the request", async () => {
    await expect(
      strategy.doGenerate(
        {
          ...config,
          parsedProviderOptions: { responses: { store: "not-a-boolean" } },
        },
        { api: "responses" },
        options,
      ),
    ).rejects.toThrow();
    expect(transport.fetch).not.toHaveBeenCalled();
  });

  it("preserves the delegate's existing API errors and HTTP diagnostics before output", async () => {
    const frame = {
      code: "rate_limit_exceeded",
      message: "Fixture early quota",
      sequence_number: 0,
      type: "error",
    };
    const responseBody = JSON.stringify(frame);
    transport.fetch.mockResolvedValue(
      new Response(`data: ${responseBody}\n\n`, {
        headers: { "content-type": "text/event-stream", "x-request-id": "fixture-request" },
      }),
    );

    const error: unknown = await strategy
      .doStream(config, { api: "responses" }, options)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      data: frame,
      isRetryable: true,
      message: frame.message,
      responseHeaders: { "x-request-id": "fixture-request" },
      statusCode: 429,
      url: "https://fixture.example/responses-deployment/responses",
    });
    if (!APICallError.isInstance(error) || error.responseBody === undefined) {
      throw new Error("Expected the delegate's API error and diagnostic body");
    }
    expect(JSON.parse(error.responseBody) as unknown).toEqual(frame);
  });

  it.each([
    { code: "rate_limit_exceeded", isRetryable: true, statusCode: 429 },
    { code: "insufficient_quota", isRetryable: false, statusCode: 429 },
    { code: "invalid_request_error", isRetryable: false, statusCode: 400 },
  ])(
    "preserves late $code errors for both Responses event forms",
    async ({ code, isRetryable, statusCode }) => {
      for (const type of ["error", "response.failed"] as const) {
        const message = `Fixture late ${code}`;
        const frame =
          type === "error"
            ? { code, message, sequence_number: 3, type }
            : { response: { error: { code, message } }, sequence_number: 3, type };
        const frames = [
          {
            response: { created_at: 1_798_000_000, id: "response-fixture", model: config.modelId },
            type: "response.created",
          },
          {
            item: { id: "message-fixture", type: "message" },
            output_index: 0,
            type: "response.output_item.added",
          },
          {
            delta: "Partial answer",
            item_id: "message-fixture",
            type: "response.output_text.delta",
          },
          frame,
        ];
        transport.fetch.mockResolvedValue(
          new Response(frames.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(""), {
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const { stream } = await strategy.doStream(config, { api: "responses" }, options);
        const parts: LanguageModelV3StreamPart[] = [];
        for await (const part of stream) parts.push(part);
        const textIndex = parts.findIndex((part) => part.type === "text-delta");
        const errorIndex = parts.findIndex((part) => part.type === "error");
        const error = parts.find((part) => part.type === "error")?.error;

        expect(textIndex).toBeGreaterThan(-1);
        expect(errorIndex).toBeGreaterThan(textIndex);
        expect(APICallError.isInstance(error)).toBe(true);
        expect(error).toMatchObject({ data: frame, isRetryable, message, statusCode });
        expect(parts.at(-1)).toMatchObject({ finishReason: { unified: "error" }, type: "finish" });
      }
    },
  );

  it.each([
    { output: { type: "text", value: "result" }, text: "result" },
    { output: { type: "json", value: { answer: 42 } }, text: '{"answer":42}' },
    { output: { type: "error-text", value: "tool failed" }, text: "tool failed" },
    {
      output: { type: "error-json", value: { reason: "tool failed" } },
      text: '{"reason":"tool failed"}',
    },
    { output: { reason: "denied", type: "execution-denied" }, text: "denied" },
  ] satisfies { output: LanguageModelV3ToolResultOutput; text: string }[])(
    "maps output-level cache options for $output.type tool results",
    async ({ output, text }) => {
      await strategy.doGenerate(
        config,
        {
          api: "responses",
          responses: { promptCacheOptions: { mode: "explicit" } },
        },
        {
          prompt: [
            ...options.prompt,
            {
              content: [
                { input: {}, toolCallId: "call-1", toolName: "inspect", type: "tool-call" },
              ],
              role: "assistant",
            },
            {
              content: [
                {
                  output: {
                    ...output,
                    providerOptions: {
                      "sap-custom": { promptCacheBreakpoint: { mode: "explicit" } },
                    },
                  },
                  toolCallId: "call-1",
                  toolName: "inspect",
                  type: "tool-result",
                },
              ],
              role: "tool",
            },
          ],
        },
      );

      expect(body.input).toContainEqual({
        call_id: "call-1",
        output: [{ prompt_cache_breakpoint: { mode: "explicit" }, text, type: "input_text" }],
        type: "function_call_output",
      });
    },
  );

  it("classifies a pre-aborted call even when the caller uses a string reason", async () => {
    await expect(
      strategy.doGenerate(
        config,
        { api: "responses" },
        {
          ...options,
          abortSignal: AbortSignal.abort("fixture-cancel"),
        },
      ),
    ).rejects.toMatchObject({ isRetryable: false, statusCode: 499 });
    expect(transport.resolve).not.toHaveBeenCalled();
  });
});
