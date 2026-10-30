/** Responses contracts exercised through the public providers and the real SAP HTTP client. */
import type {
  JSONSchema7,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Text,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2ToolResultOutput,
} from "@ai-sdk/provider-v2";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";
import { generateText } from "ai";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SAPAIProviderSettings } from "./sap-ai-provider.js";

import { createSAPAIProvider as createSAPAIProviderV2 } from "./sap-ai-provider-v2.js";
import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

type Reply = (response: ServerResponse, request: WireRequest) => Promise<void> | void;

interface WireRequest {
  body: Record<string, unknown>;
  headers: IncomingHttpHeaders;
  url: URL;
}

const prompt: LanguageModelV3CallOptions["prompt"] = [
  { content: [{ text: "Inspect the fixture", type: "text" }], role: "user" },
];
const tools: LanguageModelV3CallOptions["tools"] = [
  {
    inputSchema: {
      properties: { path: { type: "string" }, recursive: { type: "boolean" } },
      required: ["path"],
      type: "object",
    },
    name: "read_file",
    type: "function",
  },
];
const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 30 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 5 },
  total_tokens: 120,
};
const message = {
  content: [{ annotations: [], text: "Grüße from SAP", type: "output_text" }],
  id: "message-1",
  role: "assistant",
  type: "message",
};
const reasoning = {
  encrypted_content: "fixture-encrypted-history",
  id: "reasoning-1",
  summary: [{ text: "I should inspect the file.", type: "summary_text" }],
  type: "reasoning",
};
const toolCall = {
  arguments: '{"path":"fixture.txt"}',
  call_id: "call-1",
  id: "function-1",
  name: "read_file",
  type: "function_call",
};
const reply = {
  created_at: 1_798_000_000,
  id: "response-1",
  model: "gpt-6.1-sol",
  output: [message],
  status: "completed",
  usage,
};

type V3ToolOutputItem = Extract<
  LanguageModelV3ToolResultOutput,
  { type: "content" }
>["value"][number];

type V4ToolOutputItem = Extract<
  LanguageModelV4ToolResultOutput,
  { type: "content" }
>["value"][number];

/**
 * Consumes the provider stream and surfaces error events as failures.
 * @param stream - AI SDK stream.
 * @returns All consumer-visible parts.
 */
async function collect(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = [];
  for await (const part of stream) {
    if (part.type === "error") throw part.error;
    parts.push(part);
  }
  return parts;
}

/**
 * Models a Responses stream, splitting both SSE records and UTF-8 across HTTP chunks.
 * @param response - Local HTTP response.
 * @param events - Native Responses events.
 */
async function events(response: ServerResponse, events: Record<string, unknown>[]): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const bytes = Buffer.from(
    events
      .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
      .join("") + "data: [DONE]\n\n",
  );
  const split = bytes.indexOf(Buffer.from("ü")) + 1;
  for (const chunk of [bytes.subarray(0, 9), bytes.subarray(9, split), bytes.subarray(split)]) {
    response.write(chunk);
    await setImmediate();
  }
  response.end();
}

/**
 * Sends a native Responses payload from the fixture.
 * @param response - Local HTTP response.
 * @param value - Responses JSON body.
 * @param statusCode - HTTP status.
 */
function json(response: ServerResponse, value: unknown, statusCode = 200): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "x-request-id": "fixture-request",
  });
  response.end(JSON.stringify(value));
}
/**
 * Builds a text stream with optional reasoning and function calls.
 * @param includeTool - Whether the fixture asks the caller to execute a tool.
 * @returns Native Responses events in wire order.
 */
function streamEvents(includeTool = false): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [
    {
      response: { ...reply, output: [], status: "in_progress", usage: null },
      type: "response.created",
    },
    {
      item: { id: message.id, type: "message" },
      output_index: 0,
      type: "response.output_item.added",
    },
    { delta: "Grüße ", item_id: message.id, type: "response.output_text.delta" },
    { delta: "from SAP", item_id: message.id, type: "response.output_text.delta" },
    { item: message, output_index: 0, type: "response.output_item.done" },
  ];
  if (includeTool) {
    values.push(
      {
        item: { id: reasoning.id, type: "reasoning" },
        output_index: 1,
        type: "response.output_item.added",
      },
      {
        delta: reasoning.summary[0]?.text,
        item_id: reasoning.id,
        summary_index: 0,
        type: "response.reasoning_summary_text.delta",
      },
      { item: reasoning, output_index: 1, type: "response.output_item.done" },
      { item: { ...toolCall, arguments: "" }, output_index: 2, type: "response.output_item.added" },
      {
        delta: '{"path":',
        item_id: toolCall.id,
        output_index: 2,
        type: "response.function_call_arguments.delta",
      },
      {
        delta: '"fixture.txt"}',
        item_id: toolCall.id,
        output_index: 2,
        type: "response.function_call_arguments.delta",
      },
      {
        arguments: toolCall.arguments,
        item_id: toolCall.id,
        output_index: 2,
        type: "response.function_call_arguments.done",
      },
      {
        item: { ...toolCall, status: "completed" },
        output_index: 2,
        type: "response.output_item.done",
      },
    );
  }
  values.push({
    response: { ...reply, output: includeTool ? [message, reasoning, toolCall] : [message] },
    type: "response.completed",
  });
  return values;
}

const imageOptions = { "sap-custom": { imageDetail: "high" } };
const toolImageCases = [
  {
    name: "inline image",
    v3: {
      data: "iVBORw0KGgo=",
      mediaType: "image/png",
      providerOptions: imageOptions,
      type: "image-data",
    },
    v4: {
      data: {
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        type: "data",
      },
      mediaType: "IMAGE/PNG",
      providerOptions: imageOptions,
      type: "file",
    },
    wire: { detail: "high", image_url: "data:image/png;base64,iVBORw0KGgo=", type: "input_image" },
  },
  {
    name: "image URL",
    v3: {
      providerOptions: imageOptions,
      type: "image-url",
      url: "https://example.com/screenshot.png",
    },
    v4: {
      data: { type: "url", url: new URL("https://example.com/screenshot.png") },
      mediaType: "image/*",
      providerOptions: imageOptions,
      type: "file",
    },
    wire: { detail: "high", image_url: "https://example.com/screenshot.png", type: "input_image" },
  },
  {
    name: "image reference",
    v3: {
      fileId: { "sap-custom": "image-fixture" },
      providerOptions: imageOptions,
      type: "image-file-id",
    },
    v4: {
      data: { reference: { "sap-custom": "image-fixture" }, type: "reference" },
      mediaType: "image",
      providerOptions: imageOptions,
      type: "file",
    },
    wire: { detail: "high", file_id: "image-fixture", type: "input_image" },
  },
] satisfies {
  name: string;
  v3: V3ToolOutputItem;
  v4: V4ToolOutputItem;
  wire: Record<string, string>;
}[];

const imageToolHistory = [
  { content: [{ text: "Inspect the captured screenshot", type: "text" }], role: "user" },
  {
    content: [{ input: {}, toolCallId: "image-call", toolName: "capture", type: "tool-call" }],
    role: "assistant",
  },
] satisfies LanguageModelV3CallOptions["prompt"] & LanguageModelV4Prompt;

describe("Responses over SAP AI Core HTTP", () => {
  const requests: WireRequest[] = [];
  const replies: Reply[] = [];
  let destinationUrl: string;
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const capture: WireRequest = {
        body: JSON.parse(body || "{}") as Record<string, unknown>,
        headers: request.headers,
        url: new URL(request.url ?? "/", destinationUrl),
      };
      requests.push(capture);
      const next = replies.shift();
      if (next) await next(response, capture);
      else json(response, reply);
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    destinationUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  beforeEach(() => {
    requests.length = 0;
    replies.length = 0;
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
   * Configures a public provider without external authentication or SDK mocks.
   * @param overrides - Settings for the current scenario.
   * @returns Public provider configuration.
   */
  function settings(overrides: SAPAIProviderSettings = {}): SAPAIProviderSettings {
    return {
      api: "responses",
      deploymentId: "responses-test",
      destination: { authentication: "NoAuthentication", url: destinationUrl },
      ...overrides,
    };
  }

  it("generates text at the deployment Responses endpoint with SAP transport settings", async () => {
    const ignoredSignal = AbortSignal.abort("provider signal must be ignored");
    const model = createSAPAIProvider(
      settings({
        name: "sap-custom",
        requestConfig: {
          headers: { "X-Keep": "provider", "X-Replace": "provider" },
          params: { fixture: "transport-param" },
          proxy: false,
          signal: ignoredSignal,
          timeout: 5_000,
        },
      }),
    )("gpt-6.1-sol", { responses: { reasoningEffort: "low" } });

    const result = await model.doGenerate({ headers: { "x-replace": "caller" }, prompt });

    expect(result.content).toContainEqual(
      expect.objectContaining({ text: "Grüße from SAP", type: "text" }),
    );
    expect(result.finishReason.unified).toBe("stop");
    expect(result.response).toMatchObject({ id: reply.id, modelId: reply.model });
    expect(result.usage).toMatchObject({
      inputTokens: { cacheRead: 30, noCache: 70, total: 100 },
      outputTokens: { reasoning: 5, text: 15, total: 20 },
    });
    expect(result.providerMetadata).toMatchObject({
      "sap-custom": { api: "responses", responseId: reply.id },
    });
    expect(result.providerMetadata).not.toHaveProperty("openai");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.pathname).toBe("/v2/inference/deployments/responses-test/responses");
    expect(requests[0]?.url.searchParams.get("api-version")).toBe("2024-10-21");
    expect(requests[0]?.url.searchParams.get("fixture")).toBe("transport-param");
    expect(requests[0]?.headers).toMatchObject({ "x-keep": "provider", "x-replace": "caller" });
    expect(requests[0]?.headers.authorization).toBeUndefined();
    expect(requests[0]?.body).toMatchObject({
      model: "gpt-6.1-sol",
      reasoning: { effort: "low" },
      store: false,
    });
    expect(requests[0]?.body.include).toContain("reasoning.encrypted_content");
  });

  describe.each(toolImageCases)("$name tool output", ({ v3, v4, wire }) => {
    it.each([false, true])(
      "preserves image detail through V4 and V3 for streaming=%s",
      async (streaming) => {
        const v3Model = createSAPAIProvider(settings({ name: "sap-custom" }))("gpt-6.1-sol");
        const v4Model = createSAPAIProviderV4(settings({ name: "sap-custom" }))("gpt-6.1-sol");
        const v3Prompt: LanguageModelV3CallOptions["prompt"] = [
          ...imageToolHistory,
          {
            content: [
              {
                output: { type: "content", value: [v3] },
                toolCallId: "image-call",
                toolName: "capture",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
        ];
        const v4Prompt: LanguageModelV4Prompt = [
          ...imageToolHistory,
          {
            content: [
              {
                output: { type: "content", value: [v4] },
                toolCallId: "image-call",
                toolName: "capture",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
        ];
        if (streaming) {
          replies.push(
            (response) => events(response, streamEvents()),
            (response) => events(response, streamEvents()),
          );
          await collect((await v3Model.doStream({ prompt: v3Prompt })).stream);
          for await (const part of (await v4Model.doStream({ prompt: v4Prompt })).stream) {
            if (part.type === "error") throw part.error;
          }
        } else {
          await v3Model.doGenerate({ prompt: v3Prompt });
          await v4Model.doGenerate({ prompt: v4Prompt });
        }
        expect(requests).toHaveLength(2);
        expect(requests[1]?.body).toEqual(requests[0]?.body);
        expect(requests[1]?.body.input).toEqual(
          expect.arrayContaining([
            { call_id: "image-call", output: [wire], type: "function_call_output" },
          ]),
        );
      },
    );

    it.each(["foundation-models", "orchestration"] as const)(
      "preserves shared tool-output conversion through %s",
      async (api) => {
        const chatReply = {
          choices: [
            { finish_reason: "stop", index: 0, message: { content: "ok", role: "assistant" } },
          ],
          id: "chat-fixture",
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        };
        const send: Reply = (response) => {
          json(
            response,
            api === "orchestration"
              ? { final_result: chatReply, request_id: "chat-request" }
              : chatReply,
          );
        };
        replies.push(send, send);
        const v3Model = createSAPAIProvider(settings({ api, name: "sap-custom" }))("gpt-4.1");
        const v4Model = createSAPAIProviderV4(settings({ api, name: "sap-custom" }))("gpt-4.1");
        await v3Model.doGenerate({
          prompt: [
            ...imageToolHistory,
            {
              content: [
                {
                  output: { type: "content", value: [v3] },
                  toolCallId: "image-call",
                  toolName: "capture",
                  type: "tool-result",
                },
              ],
              role: "tool",
            },
          ],
        });
        await v4Model.doGenerate({
          prompt: [
            ...imageToolHistory,
            {
              content: [
                {
                  output: { type: "content", value: [v4] },
                  toolCallId: "image-call",
                  toolName: "capture",
                  type: "tool-result",
                },
              ],
              role: "tool",
            },
          ],
        });
        expect(requests).toHaveLength(2);
        expect(requests[1]?.body).toEqual(requests[0]?.body);
        const output = JSON.stringify({ type: "content", value: [v3] });
        expect(JSON.stringify(requests[1]?.body)).toContain(JSON.stringify(output));
      },
    );
  });

  describe("official AI SDK 5 media tool results", () => {
    it.each([false, true])(
      "sends PNG tool media through the V2 provider for streaming=%s",
      async (streaming) => {
        const data =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
        const options: LanguageModelV2CallOptions = {
          prompt: [
            ...imageToolHistory,
            {
              content: [
                {
                  output: {
                    type: "content",
                    value: [
                      { text: "Screenshot", type: "text" },
                      { data, mediaType: "image/png", type: "media" },
                    ],
                  },
                  toolCallId: "image-call",
                  toolName: "capture",
                  type: "tool-result",
                },
              ],
              role: "tool",
            },
          ],
        };
        const model = createSAPAIProviderV2(settings())("gpt-6.1-sol");
        if (streaming) {
          replies.push((response) => events(response, streamEvents()));
          for await (const part of (await model.doStream(options)).stream) {
            if (part.type === "error") throw part.error;
            if (part.type === "stream-start") expect(part.warnings).toEqual([]);
          }
        } else {
          expect((await model.doGenerate(options)).warnings).toEqual([]);
        }
        expect(requests[0]?.body.input).toEqual(
          expect.arrayContaining([
            {
              call_id: "image-call",
              output: [
                { text: "Screenshot", type: "input_text" },
                { image_url: `data:image/png;base64,${data}`, type: "input_image" },
              ],
              type: "function_call_output",
            },
          ]),
        );
      },
    );
  });

  describe("other V2 media and legacy API compatibility", () => {
    it.each([false, true])(
      "sends non-image tool media as input_file for streaming=%s",
      async (streaming) => {
        const options: LanguageModelV2CallOptions = {
          prompt: [
            ...imageToolHistory,
            {
              content: [
                {
                  output: {
                    type: "content",
                    value: [{ data: "JVBERi0xLjQ=", mediaType: "application/pdf", type: "media" }],
                  },
                  toolCallId: "image-call",
                  toolName: "capture",
                  type: "tool-result",
                },
              ],
              role: "tool",
            },
          ],
        };
        const model = createSAPAIProviderV2(settings())("gpt-6.1-sol");
        if (streaming) {
          replies.push((response) => events(response, streamEvents()));
          for await (const part of (await model.doStream(options)).stream) {
            if (part.type === "error") throw part.error;
            if (part.type === "stream-start") expect(part.warnings).toEqual([]);
          }
        } else {
          expect((await model.doGenerate(options)).warnings).toEqual([]);
        }
        expect(requests[0]?.body.input).toEqual(
          expect.arrayContaining([
            {
              call_id: "image-call",
              output: [
                {
                  file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
                  filename: "data",
                  type: "input_file",
                },
              ],
              type: "function_call_output",
            },
          ]),
        );
      },
    );

    it.each(["foundation-models", "orchestration"] as const)(
      "keeps media and custom output through %s",
      async (api) => {
        const chatReply = {
          choices: [
            { finish_reason: "stop", index: 0, message: { content: "ok", role: "assistant" } },
          ],
          id: "chat-fixture",
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        };
        replies.push((response) => {
          json(
            response,
            api === "orchestration"
              ? { final_result: chatReply, request_id: "chat-request" }
              : chatReply,
          );
        });
        const custom = {
          providerOptions: { "sap-custom": { payload: "preserved" } },
          type: "custom",
        };
        const output = {
          type: "content",
          value: [
            { text: "file and custom result", type: "text" },
            { data: "JVBERi0xLjQ=", mediaType: "application/pdf", type: "media" },
            custom,
          ],
        } as unknown as LanguageModelV2ToolResultOutput;
        const model = createSAPAIProviderV2(settings({ api }))("gpt-4.1");
        await model.doGenerate({
          prompt: [
            ...imageToolHistory,
            {
              content: [
                { output, toolCallId: "image-call", toolName: "capture", type: "tool-result" },
              ],
              role: "tool",
            },
          ],
        });
        const normalized = JSON.stringify({
          type: "content",
          value: [
            { text: "file and custom result", type: "text" },
            { data: "JVBERi0xLjQ=", mediaType: "application/pdf", type: "file-data" },
            custom,
          ],
        });
        expect(JSON.stringify(requests[0]?.body)).toContain(JSON.stringify(normalized));
      },
    );
  });

  it.each([false, true])(
    "retains the unsupported AI SDK 5 provider-defined tool boundary for streaming=%s",
    async (streaming) => {
      const options: LanguageModelV2CallOptions = {
        prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
        tools: [{ args: {}, id: "openai.web_search", name: "search", type: "provider-defined" }],
      };
      const model = createSAPAIProviderV2(settings())("gpt-6.1-sol");

      if (streaming) {
        replies.push((response) => events(response, streamEvents()));
        for await (const part of (await model.doStream(options)).stream) {
          if (part.type === "error") throw part.error;
          if (part.type === "stream-start") {
            expect(part.warnings).toHaveLength(1);
            expect(part.warnings[0]?.message).toContain("function tool");
            expect(part.warnings[0]?.type).toBe("other");
          }
        }
      } else {
        const generated = await model.doGenerate(options);
        expect(generated.warnings).toHaveLength(1);
        expect(generated.warnings[0]?.message).toContain("function tool");
        expect(generated.warnings[0]?.type).toBe("other");
      }
      expect(requests[0]?.body.tools).toEqual([]);
    },
  );

  it("discovers a running model deployment by name and version in its resource group", async () => {
    replies.push((response, request) => {
      expect(request.url.pathname).toBe("/v2/lm/deployments");
      expect(request.url.searchParams.get("scenarioId")).toBe("foundation-models");
      expect(request.url.searchParams.get("executableIds")).toBe("azure-openai");
      expect(request.url.searchParams.get("status")).toBe("RUNNING");
      json(response, {
        count: 1,
        resources: [
          {
            details: {
              resources: {
                backendDetails: { model: { name: "gpt-6.1-sol", version: "fixture-v1" } },
              },
            },
            id: "discovered-responses-test",
            status: "RUNNING",
          },
        ],
      });
    });
    const model = createSAPAIProvider(
      settings({ deploymentId: undefined, resourceGroup: "responses-fixture" }),
    )("gpt-6.1-sol", { modelVersion: "fixture-v1" });

    const result = await model.doGenerate({ prompt });

    expect(result.finishReason.unified).toBe("stop");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url.pathname).toBe(
      "/v2/inference/deployments/discovered-responses-test/responses",
    );
    expect(
      requests.every((request) => request.headers["ai-resource-group"] === "responses-fixture"),
    ).toBe(true);
  });

  it("keeps optional function arguments optional and serializes structured output", async () => {
    const schema: JSONSchema7 = {
      additionalProperties: false,
      properties: { answer: { type: "string" } },
      required: ["answer"],
      type: "object",
    };
    const model = createSAPAIProvider(settings())("gpt-6.1-sol", {
      modelParams: { maxTokens: 80, parallel_tool_calls: false },
      responses: { reasoningEffort: "low" },
    });

    await model.doGenerate({
      prompt,
      responseFormat: { name: "answer", schema, type: "json" },
      tools,
    });

    expect(requests[0]?.body).toMatchObject({
      max_output_tokens: 80,
      parallel_tool_calls: false,
      text: { format: { name: "answer", schema, type: "json_schema" } },
      tools: [
        {
          name: "read_file",
          parameters: {
            properties: { path: { type: "string" }, recursive: { type: "boolean" } },
            required: ["path"],
            type: "object",
          },
          strict: false,
          type: "function",
        },
      ],
    });
  });

  it("round-trips encrypted reasoning and tool results under a custom provider name", async () => {
    replies.push((response) => {
      json(response, { ...reply, output: [reasoning, toolCall] });
    });
    const model = createSAPAIProvider(settings({ name: "sap-custom" }))("gpt-6.1-sol", {
      responses: { reasoningEffort: "low" },
    });
    const first = await model.doGenerate({ prompt, tools });
    expect(first.finishReason.unified).toBe("tool-calls");
    const reasoningPart = first.content.find((part) => part.type === "reasoning");
    const toolPart = first.content.find((part) => part.type === "tool-call");
    if (!reasoningPart || !toolPart) throw new Error("Expected reasoning and a function call");
    expect(reasoningPart.providerMetadata).toEqual({
      "sap-custom": {
        itemId: reasoning.id,
        reasoningEncryptedContent: reasoning.encrypted_content,
      },
    });
    expect(toolPart.providerMetadata).toEqual({ "sap-custom": { itemId: toolCall.id } });

    const result = await model.doGenerate({
      prompt: [
        ...prompt,
        {
          content: [
            {
              providerOptions: reasoningPart.providerMetadata,
              text: reasoningPart.text,
              type: "reasoning",
            },
            {
              input: JSON.parse(toolPart.input) as { path: string },
              providerOptions: toolPart.providerMetadata,
              toolCallId: toolPart.toolCallId,
              toolName: toolPart.toolName,
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              output: { type: "text", value: "The fixture contains 42." },
              toolCallId: toolPart.toolCallId,
              toolName: toolPart.toolName,
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ],
      tools,
    });

    expect(result.finishReason.unified).toBe("stop");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body.input).toEqual(
      expect.arrayContaining([
        reasoning,
        expect.objectContaining({
          arguments: toolCall.arguments,
          call_id: toolCall.call_id,
          name: toolCall.name,
          type: toolCall.type,
        }),
        {
          call_id: toolCall.call_id,
          output: "The fixture contains 42.",
          type: "function_call_output",
        },
      ]),
    );
    expect(requests[1]?.body).toMatchObject({ store: false });
    expect(requests[1]?.body).not.toHaveProperty("previous_response_id");
  });

  it.each([
    { name: undefined, namespace: "sap-ai", streaming: false },
    { name: undefined, namespace: "sap-ai", streaming: true },
    { name: "sap-custom", namespace: "sap-custom", streaming: false },
    { name: "sap-custom", namespace: "sap-custom", streaming: true },
  ])(
    "namespaces citation sources for $namespace with streaming=$streaming",
    async ({ name, namespace, streaming }) => {
      const annotations = [
        { file_id: "file-cited", filename: "source.txt", index: 0, type: "file_citation" },
        {
          container_id: "container-1",
          end_index: 5,
          file_id: "file-generated",
          filename: "artifact.txt",
          start_index: 0,
          type: "container_file_citation",
        },
        {
          end_index: 14,
          start_index: 6,
          title: "Web source",
          type: "url_citation",
          url: "https://example.com/source",
        },
      ];
      const annotatedMessage = {
        ...message,
        content: [{ ...message.content[0], annotations }],
      };
      const annotatedReply = { ...reply, output: [annotatedMessage] };
      replies.push((response) => {
        if (!streaming) {
          json(response, annotatedReply);
          return;
        }
        return events(response, [
          { response: annotatedReply, type: "response.created" },
          {
            item: { id: message.id, type: "message" },
            output_index: 0,
            type: "response.output_item.added",
          },
          { delta: "Grüße from SAP", item_id: message.id, type: "response.output_text.delta" },
          ...annotations.map((annotation) => ({
            annotation,
            item_id: message.id,
            type: "response.output_text.annotation.added",
          })),
          { item: annotatedMessage, output_index: 0, type: "response.output_item.done" },
          { response: annotatedReply, type: "response.completed" },
        ]);
      });
      const model = createSAPAIProviderV4(settings({ name }))("gpt-6.1-sol");
      const invocation = {
        prompt: [
          { content: [{ text: "Inspect the citations", type: "text" }], role: "user" },
        ] satisfies LanguageModelV4Prompt,
      };
      let text:
        Extract<LanguageModelV4StreamPart, { type: "text-end" }> | LanguageModelV4Text | undefined;
      if (streaming) {
        for await (const part of (await model.doStream(invocation)).stream) {
          if (part.type === "error") throw part.error;
          if (part.type === "text-end") text = part;
        }
      } else {
        text = (await model.doGenerate(invocation)).content.find((part) => part.type === "text");
      }

      expect(text?.providerMetadata).toMatchObject({ [namespace]: { itemId: message.id } });
      expect(text?.providerMetadata).not.toHaveProperty("openai");
      expect(text?.citations).toEqual([
        {
          source: {
            filename: "source.txt",
            id: "file-cited",
            mediaType: "text/plain",
            providerMetadata: {
              [namespace]: { fileId: "file-cited", index: 0, type: "file_citation" },
            },
            sourceType: "document",
            title: "source.txt",
            type: "source",
          },
        },
        {
          endIndex: 5,
          source: {
            filename: "artifact.txt",
            id: "file-generated",
            mediaType: "text/plain",
            providerMetadata: {
              [namespace]: {
                containerId: "container-1",
                fileId: "file-generated",
                type: "container_file_citation",
              },
            },
            sourceType: "document",
            title: "artifact.txt",
            type: "source",
          },
          startIndex: 0,
        },
        {
          endIndex: 14,
          source: {
            id: "https://example.com/source",
            sourceType: "url",
            title: "Web source",
            type: "source",
            url: "https://example.com/source",
          },
          startIndex: 6,
        },
      ]);
    },
  );

  it("streams text, split function arguments, reasoning history, and cached usage", async () => {
    replies.push((response) => events(response, streamEvents(true)));
    const model = createSAPAIProvider(settings({ name: "sap-custom" }))("gpt-6.1-sol", {
      responses: { reasoningEffort: "low" },
    });
    const result = await model.doStream({ prompt, tools });
    const parts = await collect(result.stream);

    expect(
      parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join(""),
    ).toBe("Grüße from SAP");
    expect(
      parts
        .filter((part) => part.type === "tool-input-delta")
        .map((part) => part.delta)
        .join(""),
    ).toBe(toolCall.arguments);
    expect(parts).toContainEqual(
      expect.objectContaining({
        input: toolCall.arguments,
        toolCallId: toolCall.call_id,
        toolName: "read_file",
        type: "tool-call",
      }),
    );
    expect(parts).toContainEqual(
      expect.objectContaining({
        providerMetadata: {
          "sap-custom": {
            itemId: reasoning.id,
            reasoningEncryptedContent: reasoning.encrypted_content,
          },
        },
        type: "reasoning-end",
      }),
    );
    const finish = parts.find((part) => part.type === "finish");
    expect(finish?.finishReason.unified).toBe("tool-calls");
    expect(finish?.providerMetadata).toMatchObject({
      "sap-custom": { api: "responses", responseId: reply.id },
    });
    expect(finish?.usage).toMatchObject({
      inputTokens: { cacheRead: 30 },
      outputTokens: { reasoning: 5 },
    });
    expect(
      parts
        .filter((part) => "providerMetadata" in part)
        .every(
          (part) =>
            !("providerMetadata" in part) ||
            !part.providerMetadata ||
            !("openai" in part.providerMetadata),
        ),
    ).toBe(true);
    expect(requests[0]?.body.stream).toBe(true);
  });

  it.each([false, true])("reports an output-token limit for streaming=%s", async (streaming) => {
    replies.push((response) => {
      if (streaming)
        return events(response, [
          ...streamEvents().slice(0, -1),
          {
            response: { ...reply, incomplete_details: { reason: "max_output_tokens" } },
            type: "response.incomplete",
          },
        ]);
      json(response, {
        ...reply,
        incomplete_details: { reason: "max_output_tokens" },
        status: "incomplete",
      });
    });
    const model = createSAPAIProvider(settings())("gpt-6.1-sol");
    const result = streaming
      ? await collect((await model.doStream({ prompt })).stream)
      : await model.doGenerate({ prompt });
    const finish = Array.isArray(result) ? result.find((part) => part.type === "finish") : result;
    expect(finish).toMatchObject({ finishReason: { raw: "max_output_tokens", unified: "length" } });
  });

  it("works through the V4 facade and AI SDK generateText", async () => {
    const result = await generateText({
      maxRetries: 0,
      model: createSAPAIProviderV4(settings())("gpt-6.1-sol"),
      prompt: "Hello",
    });
    expect(result.text).toBe("Grüße from SAP");
    expect(result.finishReason).toBe("stop");
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(30);
    expect(requests).toHaveLength(1);
  });

  it("adapts Responses usage and finish reasons through the V2 facade", async () => {
    const model = createSAPAIProviderV2(settings())("gpt-6.1-sol");
    const result = await model.doGenerate({
      prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
    });
    expect(model.specificationVersion).toBe("v2");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
    expect(result.providerMetadata).toMatchObject({ "sap-ai": { api: "responses" } });
  });

  it.each([400, 401, 403, 429, 503])(
    "classifies HTTP %s failures for callers' retry policy",
    async (statusCode) => {
      replies.push((response) => {
        json(
          response,
          { error: { code: statusCode, message: "Fixture request failed" } },
          statusCode,
        );
      });
      const model = createSAPAIProvider(settings())("gpt-6.1-sol");
      const error: unknown = await model.doGenerate({ prompt }).catch((error: unknown) => error);
      if (statusCode === 401 || statusCode === 403) {
        expect(LoadAPIKeyError.isInstance(error)).toBe(true);
      } else {
        expect(APICallError.isInstance(error)).toBe(true);
        expect(error).toMatchObject({
          isRetryable: statusCode === 429 || statusCode >= 500,
          statusCode,
        });
      }
      expect(requests).toHaveLength(1);
    },
  );

  it("rejects a pre-aborted call before opening an HTTP request", async () => {
    const model = createSAPAIProvider(settings())("gpt-6.1-sol");
    await expect(
      model.doGenerate({ abortSignal: AbortSignal.abort("fixture cancellation"), prompt }),
    ).rejects.toMatchObject({ isRetryable: false });
    expect(requests).toHaveLength(0);
  });

  it("aborts an HTTP stream while waiting for the model's first output", async () => {
    const controller = new AbortController();
    let onClosed: () => void;
    const closed = new Promise<void>((resolve) => {
      onClosed = resolve;
    });
    const connected = new Promise<void>((resolve) => {
      replies.push((response) => {
        response.on("close", () => {
          onClosed();
        });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          `data: ${JSON.stringify({ response: reply, type: "response.created" })}\n\n`,
        );
        resolve();
      });
    });
    const model = createSAPAIProvider(settings())("gpt-6.1-sol");
    const result = expect(
      model.doStream({ abortSignal: controller.signal, prompt }),
    ).rejects.toMatchObject({ isRetryable: false });

    await connected;
    controller.abort("fixture cancellation before first token");

    await result;
    await closed;
    expect(requests).toHaveLength(1);
  });

  it.each(["v2", "v3", "v4"] as const)(
    "discards buffered tool calls after abort through the %s facade",
    async (version) => {
      let onClosed: () => void;
      const closed = new Promise<void>((resolve) => {
        onClosed = resolve;
      });
      replies.push((response) => {
        response.on("close", () => {
          onClosed();
        });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          streamEvents(true)
            .slice(0, -1)
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
        );
      });
      const controller = new AbortController();
      const options = {
        abortSignal: controller.signal,
        prompt: [
          {
            content: [{ text: "Inspect the fixture", type: "text" as const }],
            role: "user" as const,
          },
        ],
        tools: [
          {
            inputSchema: {
              properties: { path: { type: "string" as const } },
              required: ["path"],
              type: "object" as const,
            },
            name: "read_file",
            type: "function" as const,
          },
        ],
      };
      const result =
        version === "v2"
          ? await createSAPAIProviderV2(settings())("gpt-6.1-sol").doStream(options)
          : version === "v4"
            ? await createSAPAIProviderV4(settings())("gpt-6.1-sol").doStream(options)
            : await createSAPAIProvider(settings())("gpt-6.1-sol").doStream(options);
      const reader = result.stream.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) throw new Error("Fixture stream ended before emitting text");
        if (next.value.type === "text-delta") break;
      }

      await setImmediate();
      controller.abort("fixture cancellation before buffered tools");

      const remaining: unknown[] = [];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        remaining.push(next.value);
      }
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({
        error: { isRetryable: false, statusCode: 499 },
        type: "error",
      });
      await closed;
    },
  );

  it.each(["abort", "cancel"] as const)(
    "closes an idle upstream HTTP stream on %s",
    async (action) => {
      let onClosed: () => void;
      const closed = new Promise<void>((resolve) => {
        onClosed = resolve;
      });
      replies.push((response) => {
        response.on("close", () => {
          onClosed();
        });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          streamEvents()
            .slice(0, 3)
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
        );
        response.flushHeaders();
      });
      const controller = new AbortController();
      const model = createSAPAIProvider(settings())("gpt-6.1-sol");
      const reader = (
        await model.doStream({ abortSignal: controller.signal, prompt })
      ).stream.getReader();
      expect((await reader.read()).value?.type).toBe("stream-start");
      expect((await reader.read()).value?.type).toBe("response-metadata");
      expect((await reader.read()).value?.type).toBe("text-start");
      expect((await reader.read()).value?.type).toBe("text-delta");
      if (action === "cancel") {
        await reader.cancel("fixture cancellation");
      } else {
        const pending = reader.read();
        controller.abort("fixture cancellation");
        const result = await pending;
        expect(result.value).toMatchObject({ error: { isRetryable: false }, type: "error" });
      }
      await closed;
      expect(requests).toHaveLength(1);
    },
  );
});
