/** Responses contracts exercised through the public providers and the real SAP HTTP client. */
import type {
  JSONSchema7,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Text,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2ToolResultOutput,
} from "@ai-sdk/provider-v2";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
} from "@ai-sdk/provider-v3";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { APICallError, LoadAPIKeyError, UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { generateText, streamText, tool } from "ai";
import { execFile } from "node:child_process";
import { getEventListeners } from "node:events";
import { Agent, createServer } from "node:http";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { SAPAIProviderSettings } from "./sap-ai-provider.js";

import { createSAPAIProvider as createSAPAIProviderV2 } from "./sap-ai-provider-v2.js";
import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

type Reply = (response: ServerResponse, request: WireRequest) => Promise<void> | void;

interface WireRequest {
  body: Record<string, unknown>;
  headers: IncomingHttpHeaders;
  rawBody: string;
  url: URL;
}

const prompt = [
  { content: [{ text: "Inspect the fixture", type: "text" }], role: "user" },
] satisfies LanguageModelV3CallOptions["prompt"] & LanguageModelV4Prompt;
const tools = [
  {
    inputSchema: {
      properties: { path: { type: "string" }, recursive: { type: "boolean" } },
      required: ["path"],
      type: "object",
    },
    name: "read_file",
    type: "function",
  },
] satisfies NonNullable<LanguageModelV3CallOptions["tools"]>;
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
async function collect<T extends LanguageModelV3StreamPart | LanguageModelV4StreamPart>(
  stream: ReadableStream<T>,
): Promise<T[]> {
  const parts: T[] = [];
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
 * Ends a native Responses stream after partial output, without a completion event.
 * @param response - Local HTTP response.
 */
function interruptedEvents(response: ServerResponse): void {
  const partialMessage = {
    ...message,
    content: [{ annotations: [], text: "partial", type: "output_text" }],
  };
  const frames = [
    ...streamEvents().slice(0, 2),
    { delta: "partial", item_id: message.id, type: "response.output_text.delta" },
    { item: partialMessage, output_index: 0, type: "response.output_item.done" },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""));
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
      request.setEncoding("utf8");
      for await (const chunk of request) body += String(chunk);
      const capture: WireRequest = {
        body: JSON.parse(body || "{}") as Record<string, unknown>,
        headers: request.headers,
        rawBody: body,
        url: new URL(`${destinationUrl}${request.url ?? "/"}`),
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

  it.each(["doGenerate", "doStream"] as const)(
    "%s preserves large serialized bodies through caller middleware and transforms",
    async (operation) => {
      const middlewareBodies: unknown[] = [];
      const transformedBodies: unknown[] = [];
      const agent = new Agent({ keepAlive: true, maxSockets: 1 });
      const requestConfig: CustomRequestConfig = {
        headers: { "X-Fixture-Keep": "provider", "X-Fixture-Override": "provider" },
        httpAgent: agent,
        middleware: [
          ({ fn }) =>
            async (request) => {
              middlewareBodies.push(request.data);
              return fn(request);
            },
        ],
        params: { fixture: "string-body" },
        proxy: false,
        timeout: 5_000,
        transformRequest: [
          (data: unknown) => {
            transformedBodies.push(data);
            return data;
          },
        ],
      };
      if (operation === "doStream") replies.push((response) => events(response, streamEvents()));
      const model = createSAPAIProvider(settings({ requestConfig }))("gpt-6.1-sol");
      const text = "Large Grüße 🌍 fixture ".repeat(16_384);
      try {
        const options = {
          headers: { "x-fixture-keep": undefined, "x-fixture-override": "caller" },
          prompt: [{ content: [{ text, type: "text" as const }], role: "user" as const }],
        };
        if (operation === "doGenerate") await model.doGenerate(options);
        else await collect((await model.doStream(options)).stream);

        expect(requests).toHaveLength(1);
        const captured = requests[0];
        if (!captured) throw new Error("Expected the serialized HTTP request");
        expect(Buffer.byteLength(captured.rawBody)).toBeGreaterThan(256 * 1024);
        expect(middlewareBodies).toEqual([captured.rawBody]);
        expect(transformedBodies).toEqual([captured.rawBody]);
        expect(captured.rawBody).toContain(text);
        expect(captured.headers).toMatchObject({
          "x-fixture-keep": "provider",
          "x-fixture-override": "caller",
        });
        expect(captured.headers.authorization).toBeUndefined();
        expect(captured.url.searchParams.get("fixture")).toBe("string-body");
      } finally {
        agent.destroy();
      }
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s retains caller body mutation across middleware retry attempts",
    async (operation) => {
      const transformedBodies: unknown[] = [];
      const retryBodies: unknown[] = [];
      const retryOnce: NonNullable<CustomRequestConfig["middleware"]>[number] =
        ({ fn }) =>
        async (request) => {
          retryBodies.push(request.data);
          const first = await fn(request);
          if (first.status !== 503) return first;
          const data: unknown = first.data;
          if (!(data instanceof Readable)) throw new Error("Expected the real SAP HTTP body");
          data.destroy();
          if (typeof request.data !== "string") throw new Error("Expected serialized retry body");
          request.data = request.data.replace('"store":false', '"store":true');
          retryBodies.push(request.data);
          return fn(request);
        };
      replies.push((response) => {
        json(response, { error: { message: "Retry this fixture" } }, 503);
      });
      if (operation === "doStream") replies.push((response) => events(response, streamEvents()));
      const model = createSAPAIProvider(
        settings({
          requestConfig: {
            middleware: [retryOnce],
            transformRequest: [
              (data: unknown) => {
                transformedBodies.push(data);
                return data;
              },
            ],
            validateStatus: (status: number) => status < 600,
          },
        }),
      )("gpt-6.1-sol");

      if (operation === "doGenerate") await model.doGenerate({ prompt });
      else await collect((await model.doStream({ prompt })).stream);

      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.body.store)).toEqual([false, true]);
      expect(retryBodies).toEqual(requests.map((request) => request.rawBody));
      expect(transformedBodies).toEqual(retryBodies);
    },
  );

  it.each([
    ["", "/v2"],
    ["/", "/v2"],
    ["//", "//v2"],
    ["/v2/", "/v2"],
    ["/v2///", "/v2//"],
    ["/custom/base///", "/custom/base//"],
  ])(
    "keeps destination %s request and parser diagnostic URLs aligned without ID discovery",
    async (path, prefix) => {
      replies.push((response) => {
        json(response, { ...reply, output: "invalid-fixture-output" });
      });
      const model = createSAPAIProvider(
        settings({
          destination: { authentication: "NoAuthentication", url: `${destinationUrl}${path}` },
        }),
      )("gpt-6.1-sol");

      const error: unknown = await model.doGenerate({ prompt }).catch((error: unknown) => error);

      expect(requests).toHaveLength(1);
      const expectedPath = `${prefix}/inference/deployments/responses-test/responses`;
      expect(requests[0]?.url.pathname).toBe(expectedPath);
      expect(requests[0]?.headers["ai-resource-group"]).toBe("default");
      expect(APICallError.isInstance(error)).toBe(true);
      if (!APICallError.isInstance(error)) throw new Error("Expected the fixture parser error");
      expect(error.statusCode).toBe(200);
      expect(error.isRetryable).toBe(false);
      expect(new URL(error.url).pathname).toBe(expectedPath);
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s exposes native compaction and replays its encrypted history under a custom namespace",
    async (operation) => {
      const compaction = { encrypted_content: "cipher-cmp", id: "cmp-1", type: "compaction" };
      const compacted = { ...reply, output: [compaction] };
      replies.push((response) => {
        if (operation === "doGenerate") json(response, compacted);
        else
          return events(response, [
            { response: compacted, type: "response.created" },
            { item: compaction, output_index: 0, type: "response.output_item.done" },
            { response: compacted, type: "response.completed" },
          ]);
      });
      const model = createSAPAIProviderV4(settings({ name: "sap-custom" }))("gpt-6.1-sol");
      const content =
        operation === "doGenerate"
          ? (await model.doGenerate({ prompt })).content
          : await collect((await model.doStream({ prompt })).stream);
      const custom = content.find((part) => part.type === "custom");
      expect(custom).toMatchObject({
        kind: "openai.compaction",
        providerMetadata: { "sap-custom": { encryptedContent: "cipher-cmp", itemId: "cmp-1" } },
        type: "custom",
      });
      if (!custom) throw new Error("Expected native compaction output");
      await model.doGenerate({
        prompt: [
          ...prompt,
          {
            content: [
              { kind: custom.kind, providerOptions: custom.providerMetadata, type: "custom" },
            ],
            role: "assistant",
          },
        ],
      });
      expect(requests).toHaveLength(2);
      expect(requests[1]?.body.input).toContainEqual(compaction);
    },
  );

  it("lets AI SDK 7 replay compaction response messages without a V3 boundary", async () => {
    const compaction = { encrypted_content: "sdk-cipher", id: "sdk-cmp", type: "compaction" };
    replies.push((response) => {
      json(response, { ...reply, output: [compaction, message] });
    });
    const model = createSAPAIProviderV4(settings({ name: "sap-custom" }))("gpt-6.1-sol");
    const first = await generateText({ maxRetries: 0, model, prompt: "Compact the fixture" });
    await generateText({
      maxRetries: 0,
      messages: [...first.finalStep.response.messages, { content: "Continue", role: "user" }],
      model,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body.input).toContainEqual(compaction);
  });

  it.each(["doGenerate", "doStream"] as const)(
    "%s accepts native references and tagged text after invocation-level API selection",
    async (operation) => {
      const namespace = "sap-custom";
      const file = {
        data: {
          reference: { [namespace]: "file-right", openai: "wrong-file" },
          type: "reference" as const,
        },
        mediaType: "IMAGE/PNG",
        providerOptions: { [namespace]: { imageDetail: "high" }, openai: { imageDetail: "low" } },
        type: "file" as const,
      };
      const textFile = {
        data: { text: "Tagged document", type: "text" as const },
        mediaType: "TEXT/PLAIN",
        type: "file" as const,
      };
      const model = createSAPAIProviderV4(settings({ api: "orchestration", name: namespace }))(
        "gpt-6.1-sol",
      );
      const history: LanguageModelV4Prompt = [
        { content: [file, textFile], role: "user" },
        {
          content: [
            {
              input: {},
              toolCallId: "tool-file",
              toolName: "capture",
              type: "tool-call",
            },
            {
              output: { type: "content", value: [file] },
              toolCallId: "assistant-file",
              toolName: "capture",
              type: "tool-result",
            },
            {
              providerOptions: { [namespace]: { reasoningEncryptedContent: "cipher-without-id" } },
              text: "",
              type: "reasoning",
            },
          ],
          role: "assistant",
        },
        {
          content: [
            {
              output: { type: "content", value: [file, textFile] },
              toolCallId: "tool-file",
              toolName: "capture",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const invocation = {
        prompt: history,
        providerOptions: { [namespace]: { api: "responses" } },
      };
      if (operation === "doStream") {
        replies.push((response) => events(response, streamEvents()));
        await collect((await model.doStream(invocation)).stream);
      } else await model.doGenerate(invocation);
      expect(requests).toHaveLength(1);
      const input = requests[0]?.body.input;
      expect(input).toContainEqual({
        content: [
          { detail: "high", file_id: "file-right", type: "input_image" },
          { text: "Tagged document", type: "input_text" },
        ],
        role: "user",
      });
      expect(input).toContainEqual({
        call_id: "tool-file",
        output: [
          { detail: "high", file_id: "file-right", type: "input_image" },
          { text: "Tagged document", type: "input_text" },
        ],
        type: "function_call_output",
      });
      expect(input).toContainEqual({
        encrypted_content: "cipher-without-id",
        summary: [],
        type: "reasoning",
      });
    },
  );

  it.each<Extract<LanguageModelV4Prompt[number], { role: "assistant" }>["content"][number]>([
    { data: { data: new Uint8Array([1]), type: "data" }, mediaType: "image/png", type: "file" },
    {
      data: { type: "url", url: new URL("https://example.com/file.png") },
      mediaType: "image/png",
      type: "file",
    },
    { data: { text: "Assistant text file", type: "text" }, mediaType: "text/plain", type: "file" },
    {
      data: { reference: { "sap-custom": "file-id" }, type: "reference" },
      mediaType: "image/png",
      type: "file",
    },
    { data: { data: "aGk=", type: "data" }, mediaType: "image/png", type: "reasoning-file" },
    {
      data: { type: "url", url: new URL("https://example.com/reasoning.png") },
      mediaType: "image/png",
      type: "reasoning-file",
    },
    { kind: "other.unsupported", type: "custom" },
    {
      kind: "openai.compaction",
      providerOptions: { "sap-custom": { encryptedContent: "cipher" } },
      type: "custom",
    },
    {
      kind: "openai.compaction",
      providerOptions: { "sap-custom": { itemId: null } },
      type: "custom",
    },
    {
      kind: "openai.compaction",
      providerOptions: { openai: { itemId: "old-id" }, "sap-custom": { itemId: null } },
      type: "custom",
    },
  ])(
    "rejects unsupported native assistant $type history before discovery and HTTP",
    async (part) => {
      const model = createSAPAIProviderV4(
        settings({ deploymentId: undefined, name: "sap-custom" }),
      )("gpt-6.1-sol");
      for (const operation of ["doGenerate", "doStream"] as const) {
        await expect(
          model[operation]({
            prompt: [...prompt, { content: [part], role: "assistant" }],
          }),
        ).rejects.toSatisfy((error: unknown) => UnsupportedFunctionalityError.isInstance(error));
      }
      expect(requests).toHaveLength(0);
    },
  );

  it.each(["{}", ""])(
    "preserves native structuredOutputText %j and all response messages",
    async (text) => {
      replies.push((response) => {
        json(response, {
          ...reply,
          output: [
            {
              ...message,
              content: [{ annotations: [], text: "draft", type: "output_text" }],
              id: "draft",
              phase: "commentary",
            },
            {
              ...message,
              content: [{ annotations: [], text, type: "output_text" }],
              id: "final",
              phase: "final_answer",
            },
          ],
        });
      });
      const result = await createSAPAIProviderV4(settings())("gpt-6.1-sol").doGenerate({
        prompt,
        responseFormat: { type: "json" },
      });
      expect(result.structuredOutputText).toBe(text);
      expect(
        result.content.filter((part) => part.type === "text").map((part) => part.text),
      ).toEqual(["draft", text]);
    },
  );

  it("preserves native MCP approvals and namespaced execution-denied output options", async () => {
    const approval = {
      arguments: "{}",
      id: "approval-1",
      name: "read",
      server_label: "fixture",
      type: "mcp_approval_request",
    };
    replies.push((response) => {
      json(response, { ...reply, output: [approval] });
    });
    const model = createSAPAIProviderV4(settings({ name: "sap-custom" }))("gpt-6.1-sol");
    const result = await model.doGenerate({ prompt });
    const request = result.content.find((part) => part.type === "tool-approval-request");
    const call = result.content.find((part) => part.type === "tool-call");
    expect(request).toMatchObject({ approvalId: "approval-1", toolCallId: call?.toolCallId });
    expect(call).toMatchObject({ dynamic: true, providerExecuted: true, toolName: "mcp.read" });
    await model.doGenerate({
      prompt: [
        ...prompt,
        {
          content: [
            { approvalId: "approval-1", approved: false, type: "tool-approval-response" },
            {
              output: {
                providerOptions: {
                  openai: { approvalId: "wrong" },
                  "sap-custom": { approvalId: "approval-1" },
                },
                type: "execution-denied",
              },
              toolCallId: "call-denied",
              toolName: "mcp.read",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ],
    });
    expect(requests[1]?.body.input).toContainEqual({
      approval_request_id: "approval-1",
      approve: false,
      type: "mcp_approval_response",
    });
    expect(requests[1]?.body.input).not.toContainEqual(
      expect.objectContaining({ call_id: "call-denied" }),
    );
  });

  it("preserves native text tool input encoding through real SSE", async () => {
    const item = {
      call_id: "custom-call",
      id: "custom-item",
      input: "",
      name: "editor",
      type: "custom_tool_call",
    };
    replies.push((response) =>
      events(response, [
        { response: reply, type: "response.created" },
        { item, output_index: 0, type: "response.output_item.added" },
        {
          item: { ...item, input: "hello", status: "completed" },
          output_index: 0,
          type: "response.output_item.done",
        },
        { response: { ...reply, output: [] }, type: "response.completed" },
      ]),
    );
    const result = await createSAPAIProviderV4(settings())("gpt-6.1-sol").doStream({ prompt });
    expect(await collect(result.stream)).toContainEqual(
      expect.objectContaining({
        id: "custom-call",
        inputEncoding: "text",
        toolName: "editor",
        type: "tool-input-start",
      }),
    );
  });

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      (["provider", "model"] as const).map((level) => ({ level, operation })),
    ),
  )(
    "$operation switches native Responses, legacy, and back with $level defaults",
    async ({ level, operation }) => {
      const model = createSAPAIProviderV4(
        settings({
          api: level === "provider" ? "responses" : "orchestration",
          name: "sap-custom",
        }),
      )("gpt-6.1-sol", level === "model" ? { api: "responses" } : {});
      const chatReply = {
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: { content: "Legacy fixture", role: "assistant" },
          },
        ],
        id: "chat-switch",
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
      };
      const nativePrompt: LanguageModelV4Prompt = [
        {
          content: [
            {
              data: { reference: { "sap-custom": "native-file" }, type: "reference" },
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ];
      for (const api of ["responses", "foundation-models", "responses"] as const) {
        replies.push((response) => {
          if (api === "responses") {
            if (operation === "doStream") return events(response, streamEvents());
            json(response, reply);
          } else if (operation === "doGenerate") {
            json(response, chatReply);
          } else {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end(
              `data: ${JSON.stringify({
                choices: [
                  { delta: { content: "Legacy fixture" }, finish_reason: "stop", index: 0 },
                ],
                id: "chat-switch",
                usage: chatReply.usage,
              })}\n\ndata: [DONE]\n\n`,
            );
          }
        });
        const invocation = {
          prompt: api === "responses" ? nativePrompt : prompt,
          ...(api === "foundation-models" ? { providerOptions: { "sap-custom": { api } } } : {}),
        };
        if (operation === "doStream") await collect((await model.doStream(invocation)).stream);
        else await model.doGenerate(invocation);
      }
      expect(requests.map((request) => request.url.pathname)).toEqual([
        "/v2/inference/deployments/responses-test/responses",
        "/v2/inference/deployments/responses-test/chat/completions",
        "/v2/inference/deployments/responses-test/responses",
      ]);
      expect(requests[0]?.body.input).toContainEqual({
        content: [{ file_id: "native-file", type: "input_image" }],
        role: "user",
      });
      expect(requests[2]?.body.input).toEqual(requests[0]?.body.input);
      expect(requests[1]?.body).toHaveProperty("messages");
      expect(requests[1]?.body).not.toHaveProperty("input");
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s validates incompatible API settings before native or legacy prompt conversion",
    async (operation) => {
      const model = createSAPAIProviderV4(settings({ deploymentId: undefined }))("gpt-6.1-sol", {
        responses: { reasoningEffort: "low" },
      });
      await expect(
        model[operation]({
          prompt: [
            {
              content: [
                {
                  data: { reference: { "sap-ai": "native-file" }, type: "reference" },
                  mediaType: "image/png",
                  type: "file",
                },
              ],
              role: "user",
            },
          ],
          providerOptions: { "sap-ai": { api: "foundation-models" } },
        }),
      ).rejects.toMatchObject({ name: "ApiSwitchError" });
      expect(requests).toHaveLength(0);
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      (["high", "provider-default"] as const).map((reasoning) => ({ operation, reasoning })),
    ),
  )(
    "$operation preserves native parameter precedence with reasoning=$reasoning",
    async ({ operation, reasoning }) => {
      const model = createSAPAIProviderV4(settings())("gpt-6.1-sol", {
        modelParams: { maxTokens: 80, parallel_tool_calls: true },
        responses: { reasoningEffort: "low", store: false },
      });
      const invocation = {
        maxOutputTokens: 23,
        prompt,
        providerOptions: {
          "sap-ai": {
            responses: { parallelToolCalls: false, reasoningEffort: "medium", store: true },
          },
        },
        reasoning,
        tools,
      };
      if (operation === "doStream") {
        replies.push((response) => events(response, streamEvents()));
        await collect((await model.doStream(invocation)).stream);
      } else await model.doGenerate(invocation);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body).toMatchObject({
        max_output_tokens: 23,
        parallel_tool_calls: false,
        reasoning: { effort: reasoning === "high" ? "high" : "medium" },
        store: true,
        tools: [expect.objectContaining({ strict: false, type: "function" })],
      });
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      (["v3", "v4"] as const).map((version) => ({ operation, version })),
    ),
  )(
    "$version $operation retains model defaults for undefined invocation parameters",
    async ({ operation, version }) => {
      const provider = version === "v4" ? createSAPAIProviderV4 : createSAPAIProvider;
      const model = provider(settings())("gpt-4.1", {
        modelParams: {
          maxTokens: 41,
          parallel_tool_calls: false,
          temperature: 0.65,
          topP: 0.75,
        },
      });
      const invocation = {
        prompt,
        providerOptions: {
          "sap-ai": {
            modelParams: {
              maxTokens: undefined,
              parallel_tool_calls: undefined,
              temperature: undefined,
              topP: undefined,
            },
          },
        },
        topP: 0,
      };
      if (operation === "doStream") {
        replies.push((response) => events(response, streamEvents()));
        await collect<LanguageModelV3StreamPart | LanguageModelV4StreamPart>(
          (await model.doStream(invocation)).stream,
        );
      } else await model.doGenerate(invocation);
      expect(requests[0]?.body).toMatchObject({
        max_output_tokens: 41,
        parallel_tool_calls: false,
        temperature: 0.65,
        top_p: 0,
      });
    },
  );

  it.each(["image", "IMAGE", "IMAGE/PNG"])(
    "advertises remote %s images conservatively to the AI SDK download hook",
    async (mediaType) => {
      const image = new URL("https://example.com/image.png");
      const downloads: { isUrlSupportedByModel: boolean; url: URL }[][] = [];
      const model = createSAPAIProviderV4(settings())("gpt-6.1-sol");
      const result = await generateText({
        experimental_download: (requests: { isUrlSupportedByModel: boolean; url: URL }[]) => {
          downloads.push(requests);
          return Promise.resolve(requests.map(() => null));
        },
        maxRetries: 0,
        messages: [{ content: [{ data: image, mediaType, type: "file" }], role: "user" }],
        model,
      });
      expect(result.text).toBe("Grüße from SAP");
      expect(downloads).toEqual([[{ isUrlSupportedByModel: true, url: image }]]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body.input).toContainEqual({
        content: [{ image_url: image.href, type: "input_image" }],
        role: "user",
      });
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      (["v2", "v3", "v4"] as const).flatMap((version) =>
        ["image/png", "IMAGE/PNG"].map((mediaType) => ({ mediaType, operation, version })),
      ),
    ),
  )(
    "$version $operation treats $mediaType user URLs and tool data as images",
    async ({ mediaType, operation, version }) => {
      const data = "iVBORw0KGgo=";
      const url = new URL("https://example.com/image.png");
      const call = {
        input: {},
        toolCallId: "image-call",
        toolName: "capture",
        type: "tool-call" as const,
      };
      const result = {
        toolCallId: "image-call",
        toolName: "capture",
        type: "tool-result" as const,
      };
      if (operation === "doStream") replies.push((response) => events(response, streamEvents()));
      if (version === "v4") {
        const model = createSAPAIProviderV4(settings())("gpt-6.1-sol");
        const prompt: LanguageModelV4Prompt = [
          { content: [{ data: { type: "url", url }, mediaType, type: "file" }], role: "user" },
          { content: [call], role: "assistant" },
          {
            content: [
              {
                ...result,
                output: {
                  type: "content",
                  value: [
                    {
                      data: { data, type: "data" },
                      mediaType,
                      type: "file",
                    },
                  ],
                },
              },
            ],
            role: "tool",
          },
        ];
        if (operation === "doGenerate") await model.doGenerate({ prompt });
        else await collect((await model.doStream({ prompt })).stream);
      } else if (version === "v2") {
        const model = createSAPAIProviderV2(settings())("gpt-6.1-sol");
        const prompt: LanguageModelV2CallOptions["prompt"] = [
          { content: [{ data: url, mediaType, type: "file" }], role: "user" },
          { content: [call], role: "assistant" },
          {
            content: [
              {
                ...result,
                output: {
                  type: "content",
                  value: [
                    {
                      data,
                      mediaType,
                      type: "media",
                    },
                  ],
                },
              },
            ],
            role: "tool",
          },
        ];
        if (operation === "doGenerate") await model.doGenerate({ prompt });
        else {
          for await (const part of (await model.doStream({ prompt })).stream) {
            if (part.type === "error") throw part.error;
          }
        }
      } else {
        const model = createSAPAIProvider(settings())("gpt-6.1-sol");
        const prompt: LanguageModelV3CallOptions["prompt"] = [
          { content: [{ data: url, mediaType, type: "file" }], role: "user" },
          { content: [call], role: "assistant" },
          {
            content: [
              {
                ...result,
                output: {
                  type: "content",
                  value: [
                    {
                      data,
                      mediaType,
                      type: "image-data",
                    },
                  ],
                },
              },
            ],
            role: "tool",
          },
        ];
        if (operation === "doGenerate") await model.doGenerate({ prompt });
        else await collect((await model.doStream({ prompt })).stream);
      }
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body.input).toContainEqual({
        content: [{ image_url: url.href, type: "input_image" }],
        role: "user",
      });
      expect(requests[0]?.body.input).toContainEqual({
        call_id: "image-call",
        output: [{ image_url: `data:image/png;base64,${data}`, type: "input_image" }],
        type: "function_call_output",
      });
    },
  );

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

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      (["assistant", "tool"] as const).flatMap((role) =>
        [
          { mediaType: "image/png", type: "file-data" as const },
          { mediaType: "application/pdf", type: "image-data" as const },
          { mediaType: "IMAGE/PNG", type: "file-data" as const },
          { mediaType: "APPLICATION/PDF", type: "image-data" as const },
        ].map((item) => ({ item, operation, role })),
      ),
    ),
  )(
    "rejects contradictory $item.type $item.mediaType before HTTP during $operation in $role history",
    async ({ item, operation, role }) => {
      const model = createSAPAIProvider(settings({ deploymentId: undefined }))("gpt-6.1-sol");
      const resultPart = {
        output: { type: "content" as const, value: [{ ...item, data: "private-media-bytes" }] },
        toolCallId: "image-call",
        toolName: "capture",
        type: "tool-result" as const,
      };
      const history: LanguageModelV3CallOptions["prompt"] = [
        ...imageToolHistory,
        { content: [resultPart], role },
      ];
      const error: unknown = await model[operation]({ prompt: history }).catch(
        (error: unknown) => error,
      );
      expect(UnsupportedFunctionalityError.isInstance(error)).toBe(true);
      expect(String(error)).not.toContain("private-media-bytes");
      expect(requests).toHaveLength(0);
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      [
        { data: "JVBERi0xLjQ=", filename: "report.pdf", mediaType: "application/pdf" },
        { data: "UklGRg==", filename: "recording.wav", mediaType: "audio/wav" },
      ].map((item) => ({ item, operation })),
    ),
  )(
    "preserves inline $item.mediaType file bytes and filename during $operation",
    async ({ item, operation }) => {
      const part = {
        toolCallId: "image-call",
        toolName: "capture",
        type: "tool-result" as const,
      };
      const model = createSAPAIProvider(settings())("gpt-6.1-sol");
      const v3Prompt: LanguageModelV3CallOptions["prompt"] = [
        ...imageToolHistory,
        {
          content: [
            { ...part, output: { type: "content", value: [{ ...item, type: "file-data" }] } },
          ],
          role: "tool",
        },
      ];
      if (operation === "doStream") {
        replies.push((response) => events(response, streamEvents()));
        await collect((await model.doStream({ prompt: v3Prompt })).stream);
      } else {
        await model.doGenerate({ prompt: v3Prompt });
      }
      const v4Model = createSAPAIProviderV4(settings())("gpt-6.1-sol");
      const v4Prompt: LanguageModelV4Prompt = [
        ...imageToolHistory,
        {
          content: [
            {
              ...part,
              output: {
                type: "content",
                value: [
                  {
                    data: { data: item.data, type: "data" },
                    filename: item.filename,
                    mediaType: item.mediaType,
                    type: "file",
                  },
                ],
              },
            },
          ],
          role: "tool",
        },
      ];
      if (operation === "doStream") {
        replies.push((response) => events(response, streamEvents()));
        for await (const part of (await v4Model.doStream({ prompt: v4Prompt })).stream) {
          if (part.type === "error") throw part.error;
        }
      } else {
        await v4Model.doGenerate({ prompt: v4Prompt });
      }
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.body.input).toContainEqual({
          call_id: "image-call",
          output: [
            {
              file_data: `data:${item.mediaType};base64,${item.data}`,
              filename: item.filename,
              type: "input_file",
            },
          ],
          type: "function_call_output",
        });
      }
    },
  );

  it.each(
    (["doGenerate", "doStream"] as const).flatMap((operation) =>
      [
        {
          bytes: [137, 80, 78, 71, 13, 10, 26, 10],
          filename: "image.png",
          mediaType: "image/png",
          wire: { image_url: "data:image/png;base64,iVBORw0KGgo=", type: "input_image" },
        },
        {
          bytes: [37, 80, 68, 70, 45, 49, 46, 52],
          filename: "report.pdf",
          mediaType: "application/pdf",
          wire: {
            file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
            filename: "report.pdf",
            type: "input_file",
          },
        },
      ].flatMap((item) =>
        (["foreign-realm", "local-own", "local-inherited"] as const).map((view) => ({
          item,
          operation,
          view,
        })),
      ),
    ),
  )(
    "preserves $view sliced $item.mediaType tool-result bytes during $operation",
    async ({ item, operation, view }) => {
      const padded = [170, 187, ...item.bytes, 204, 221];
      const data =
        view === "foreign-realm"
          ? (runInNewContext(
              `new Uint8Array(${JSON.stringify(padded)}).subarray(2, 10)`,
            ) as Uint8Array)
          : new Uint8Array(padded).subarray(2, 10);
      if (view === "foreign-realm") {
        expect(data).not.toBeInstanceOf(Uint8Array);
      } else if (view === "local-own") {
        Object.defineProperties(data, {
          buffer: { value: new ArrayBuffer(32) },
          byteLength: { value: 0 },
          byteOffset: { value: 0 },
          length: { value: 0 },
        });
      } else {
        const prototype = Object.create(Uint8Array.prototype) as object;
        const get = () => {
          throw new Error("Range accessor must not run");
        };
        Object.defineProperties(prototype, {
          buffer: { get },
          byteLength: { get },
          byteOffset: { get },
          length: { get },
        });
        Object.setPrototypeOf(data, prototype);
      }
      const model = createSAPAIProviderV4(settings())("gpt-6.1-sol");
      const history: LanguageModelV4Prompt = [
        ...imageToolHistory,
        {
          content: [
            {
              output: {
                type: "content",
                value: [
                  {
                    data: { data, type: "data" },
                    filename: item.filename,
                    mediaType: item.mediaType,
                    type: "file",
                  },
                ],
              },
              toolCallId: "image-call",
              toolName: "capture",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      if (operation === "doStream") {
        replies.push((response) => events(response, streamEvents()));
        await collect((await model.doStream({ prompt: history })).stream);
      } else {
        await model.doGenerate({ prompt: history });
      }
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body.input).toContainEqual({
        call_id: "image-call",
        output: [item.wire],
        type: "function_call_output",
      });
    },
  );

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
  it.each(["v2", "v3", "v4"] as const)(
    "keeps interrupted EOF compatible with the public %s finish contract",
    async (version) => {
      replies.push(interruptedEvents);
      const invocation = { prompt, toolChoice: { type: "required" as const }, tools };
      const result =
        version === "v2"
          ? await createSAPAIProviderV2(settings())("gpt-6.1-sol").doStream(invocation)
          : version === "v4"
            ? await createSAPAIProviderV4(settings())("gpt-6.1-sol").doStream(invocation)
            : await createSAPAIProvider(settings())("gpt-6.1-sol").doStream(invocation);
      let finishReason: unknown;
      let text = "";
      for await (const part of result.stream) {
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") text += part.delta;
        if (part.type === "finish") finishReason = part.finishReason;
      }

      expect(text).toBe("partial");
      expect(finishReason).toEqual(
        version === "v2"
          ? "other"
          : { raw: undefined, unified: version === "v4" ? "interrupted" : "other" },
      );
      expect(requests).toHaveLength(1);
    },
  );

  it("lets AI SDK 7 consume interrupted required-tool output without a tool-choice violation", async () => {
    replies.push(interruptedEvents);
    const errors: unknown[] = [];
    const result = streamText({
      maxRetries: 0,
      model: createSAPAIProviderV4(settings())("gpt-6.1-sol"),
      onError: ({ error }) => {
        errors.push(error);
      },
      prompt: "Read the fixture",
      toolChoice: "required",
      tools: { read_file: tool({ inputSchema: z.object({ path: z.string() }) }) },
    });

    expect(await result.text).toBe("partial");
    expect(await result.finishReason).toBe("interrupted");
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("preserves interrupted required-tool output across CommonJS and lazy ESM loaders", async () => {
    replies.push(interruptedEvents);
    // tsx --eval loads the facade as CommonJS and its lazy strategy as ESM.
    const script = `
      import { streamText, tool } from "ai";
      import { z } from "zod";
      import { createSAPAIProviderV4 } from "./src/sap-ai-provider-v4.ts";
      (async () => {
        const errors = [];
        const result = streamText({
          maxRetries: 0,
          model: createSAPAIProviderV4({
            api: "responses",
            deploymentId: "mixed-loader-fixture",
            destination: { authentication: "NoAuthentication", url: ${JSON.stringify(destinationUrl)} },
            logLevel: "error",
            requestConfig: { proxy: false },
          })("gpt-6.1-sol"),
          onError: ({ error }) => errors.push(error instanceof Error ? error.name : String(error)),
          prompt: "Read the fixture",
          toolChoice: "required",
          tools: { read_file: tool({ inputSchema: z.object({ path: z.string() }) }) },
        });
        const text = await result.text;
        console.log(JSON.stringify({ errors, finishReason: await result.finishReason, text }));
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(import.meta.resolve("tsx/cli")), "--eval", script],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 4_000 },
    );

    expect(JSON.parse(stdout) as unknown).toEqual({
      errors: [],
      finishReason: "interrupted",
      text: "partial",
    });
    expect(requests).toHaveLength(1);
  });

  it.each(
    (["v2", "v3", "v4"] as const).flatMap((version) =>
      (["doGenerate", "doStream"] as const).flatMap((operation) =>
        (["manual", "cross-provider"] as const).map((origin) => ({ operation, origin, version })),
      ),
    ),
  )(
    "rejects $origin assistant files through $version $operation before discovery or HTTP",
    async ({ operation, origin, version }) => {
      const file = {
        data: new Uint8Array([1, 2, 3]),
        mediaType: "application/pdf",
        providerOptions:
          origin === "cross-provider"
            ? { "other-provider": { itemId: "foreign-file" } }
            : undefined,
        type: "file" as const,
      };
      const history = [...prompt, { content: [file], role: "assistant" as const }];
      const config = settings({ deploymentId: undefined });
      const invocation =
        version === "v4"
          ? createSAPAIProviderV4(config)("gpt-6.1-sol")[operation]({
              prompt: [
                ...prompt,
                {
                  content: [{ ...file, data: { data: file.data, type: "data" } }],
                  role: "assistant",
                },
              ],
            })
          : version === "v2"
            ? createSAPAIProviderV2(config)("gpt-6.1-sol")[operation]({ prompt: history })
            : createSAPAIProvider(config)("gpt-6.1-sol")[operation]({ prompt: history });

      await expect(invocation).rejects.toSatisfy((error: unknown) =>
        UnsupportedFunctionalityError.isInstance(error),
      );
      expect(requests).toHaveLength(0);
    },
  );

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

  it.each(["v3", "v4"] as const)("rejects a pre-aborted %s call before HTTP", async (version) => {
    const model =
      version === "v4"
        ? createSAPAIProviderV4(settings())("gpt-6.1-sol")
        : createSAPAIProvider(settings())("gpt-6.1-sol");
    await expect(
      model.doGenerate({ abortSignal: AbortSignal.abort("fixture cancellation"), prompt }),
    ).rejects.toMatchObject({ isRetryable: false });
    expect(requests).toHaveLength(0);
  });

  it.each([false, true])(
    "closes an initial SSE 429 before returning a reader, caller signal=%s",
    async (withSignal) => {
      const caller = new AbortController();
      const listener = () => undefined;
      caller.signal.addEventListener("abort", listener);
      const baseline = getEventListeners(caller.signal, "abort").length;
      let response: ServerResponse | undefined;
      let keepalive: NodeJS.Timeout | undefined;
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      let guard: NodeJS.Timeout | undefined;
      const guarded = new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => {
          reject(new Error("Initial SSE failure did not close upstream"));
        }, 1_000);
      });
      replies.push((incoming) => {
        response = incoming;
        incoming.once("close", () => {
          clearInterval(keepalive);
          close();
        });
        incoming.writeHead(200, { "content-type": "text/event-stream" });
        incoming.write(
          `data: ${JSON.stringify({
            code: "rate_limit_exceeded",
            message: "Fixture initial SSE failure",
            sequence_number: 0,
            type: "error",
          })}\n\n`,
        );
        // Real keepalives prevent Axios's socket timeout from masking an orphaned response.
        keepalive = setInterval(() => incoming.write(": keepalive\n\n"), 20);
      });
      try {
        const model = createSAPAIProvider(settings({ requestConfig: { timeout: 200 } }))(
          "gpt-6.1-sol",
        );
        const error: unknown = await Promise.race([
          model
            .doStream({ abortSignal: withSignal ? caller.signal : undefined, prompt })
            .catch((error: unknown) => error),
          guarded,
        ]);
        expect(APICallError.isInstance(error)).toBe(true);
        expect(error).toMatchObject({ isRetryable: true, statusCode: 429 });
        await Promise.race([closed, guarded]);
        expect(caller.signal.aborted).toBe(false);
        expect(getEventListeners(caller.signal, "abort")).toHaveLength(baseline);
        expect(requests).toHaveLength(1);
      } finally {
        clearTimeout(guard);
        clearInterval(keepalive);
        caller.signal.removeEventListener("abort", listener);
        response?.destroy();
      }
    },
  );

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
