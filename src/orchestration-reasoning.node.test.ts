/** Native Orchestration reasoning and diagnostics through the real SDK and local HTTP. */
import type { LanguageModelV3StreamPart, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { LanguageModelV2StreamPart, SharedV2ProviderOptions } from "@ai-sdk/provider-v2";
import type { ReasoningBlock } from "@sap-ai-sdk/orchestration";
import type { AddressInfo } from "node:net";

import { APICallError, InvalidPromptError } from "@ai-sdk/provider";
import { generateText, streamText } from "ai";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createSAPAIProvider as createSAPAIProviderV2 } from "./sap-ai-provider-v2.js";
import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

interface NativeMessage {
  content?: unknown;
  reasoning_content?: ReasoningBlock[];
  role: string;
}

interface WireBody {
  config?: {
    modules: {
      prompt_templating: { prompt: { template?: NativeMessage[] } };
    };
    stream?: { enabled?: boolean };
  };
  messages?: NativeMessage[];
}

const prompt = [{ content: [{ text: "Hello", type: "text" as const }], role: "user" as const }];
const originalBlocks: ReasoningBlock[] = [
  { content: "Think {{exact}}", signature: "signed-{{exact}}" },
  { signature: "opaque-only" },
  {},
];
const malformedReasoningChunk = {
  choices: [
    {
      delta: {
        content: "must not reach the consumer",
        reasoning_content: [{ content: "partial", signature: "uncommitted" }, { signature: 42 }],
        tool_calls: [
          {
            function: { arguments: "{}", name: "must_not_run" },
            id: "ignored-call",
            index: 0,
            type: "function",
          },
        ],
      },
      finish_reason: "tool_calls",
      index: 0,
    },
  ],
};
const usage = {
  completion_tokens: 20,
  completion_tokens_details: { reasoning_tokens: 5 },
  prompt_tokens: 100,
  prompt_tokens_details: { cache_creation_tokens: 10, cached_tokens: 30 },
  total_tokens: 120,
};
const providerFields = { finish_reason: "native_end", vendor_detail: { retained: true } };
const facades = [
  { create: createSAPAIProviderV2, version: "V2" },
  { create: createSAPAIProvider, version: "V3" },
  { create: createSAPAIProviderV4, version: "V4" },
];

let blocks = originalBlocks;
let fields: unknown = providerFields;
let chunks: undefined | unknown[];
let idle = false;
let onClosed: (() => void) | undefined;
let url: string;
const bodies: WireBody[] = [];

const server = createServer((request, response) => {
  void (async () => {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as WireBody;
    bodies.push(body);
    response.setHeader("x-orchestration-dropped-model-params", "temperature");
    const choice = {
      finish_reason: "stop",
      index: 0,
      message: { content: "ok", reasoning_content: blocks, role: "assistant" },
      provider_specific_fields: fields,
    };
    if (body.config?.stream?.enabled) {
      response.setHeader("content-type", "text/event-stream");
      const events = chunks ?? [
        {
          choices: [{ delta: { content: "", reasoning_content: blocks }, index: 0 }],
          usage,
        },
        {
          choices: [
            {
              delta: { content: "ok" },
              finish_reason: "stop",
              index: 0,
              provider_specific_fields: fields,
            },
          ],
          usage: { completion_tokens: 20, prompt_tokens: 100, total_tokens: 120 },
        },
      ];
      for (const event of events) {
        response.write(
          `data: ${JSON.stringify({ final_result: event, request_id: "reasoning-http" })}\n\n`,
        );
        if (idle) {
          response.write("\n");
          response.on("close", () => onClosed?.());
          return;
        }
      }
      response.end("data: [DONE]\n\n");
    } else {
      response.setHeader("content-type", "application/json");
      const result = { choices: [choice], id: "reasoning-result", usage };
      response.end(
        JSON.stringify(
          request.url?.includes("/chat/completions")
            ? result
            : { final_result: result, request_id: "reasoning-http" },
        ),
      );
    }
  })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
beforeEach(() => {
  bodies.length = 0;
  blocks = originalBlocks;
  fields = providerFields;
  chunks = undefined;
  idle = false;
  onClosed = undefined;
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
 * Reads the assistant message actually sent over HTTP.
 * @param body - Captured request body.
 * @returns The assistant template message, when present.
 */
function assistant(body: undefined | WireBody): NativeMessage | undefined {
  return (body?.config?.modules.prompt_templating.prompt.template ?? body?.messages)?.find(
    (message) => message.role === "assistant",
  );
}

/**
 * Collects a real provider stream while exposing upstream errors to the test.
 * @param stream - Provider stream under test.
 * @returns Events in arrival order.
 */
async function collect<T extends { type: string }>(stream: ReadableStream<T>): Promise<T[]> {
  const parts: T[] = [];
  for await (const part of stream) {
    if (part.type === "error" && "error" in part) throw part.error;
    parts.push(part);
  }
  return parts;
}

/**
 * Returns isolated routing options without requiring SAP credentials.
 * @param name - Provider namespace used for metadata.
 * @returns Local destination and deployment settings.
 */
function configuration(name = "sap-ai") {
  return {
    deploymentId: "reasoning-fixture",
    destination: { authentication: "NoAuthentication" as const, url },
    logLevel: "error" as const,
    name,
  };
}

/**
 * Reuses the malformed chunk's trailing text and tool call with a different native value.
 * @param reasoningContent - Native collection or malformed value sent over HTTP.
 * @returns A wire chunk that exercises reasoning validation before text and tools.
 */
function withReasoningContent(reasoningContent: unknown) {
  return {
    choices: malformedReasoningChunk.choices.map((choice) => ({
      ...choice,
      delta: { ...choice.delta, reasoning_content: reasoningContent },
    })),
  };
}

describe.each(facades)("native reasoning through $version", ({ create }) => {
  it("preserves visible, signed, opaque and empty blocks when generated history is replayed", async () => {
    const namespace = "custom-provider";
    const model = create(configuration(namespace))("audit-model", { includeReasoning: true });
    const result = await model.doGenerate({ prompt });
    const reasoning = result.content.filter((part) => part.type === "reasoning");
    expect(reasoning.map((part) => part.text)).toEqual(["Think {{exact}}", "", ""]);
    expect(reasoning.map((part) => part.providerMetadata?.[namespace]?.reasoningContent)).toEqual(
      originalBlocks,
    );
    expect(result.providerMetadata?.[namespace]).toMatchObject({
      finishReason: "native_end",
      finishReasonMapped: { raw: "native_end", unified: "stop" },
      providerSpecificFields: providerFields,
    });
    if (typeof result.finishReason === "string") expect(result.finishReason).toBe("stop");
    else expect(result.finishReason).toEqual({ raw: "native_end", unified: "stop" });

    await model.doGenerate({
      prompt: [
        ...prompt,
        {
          content: reasoning.map((part) => ({
            providerOptions: JSON.parse(
              JSON.stringify(part.providerMetadata),
            ) as SharedV2ProviderOptions,
            text: "edited display text must not replace signed content",
            type: "reasoning" as const,
          })),
          role: "assistant",
        },
      ],
    });
    expect(assistant(bodies.at(-1))).toEqual({
      content: "",
      reasoning_content: originalBlocks,
      role: "assistant",
    });
  });

  it("retains empty reasoning lifecycles and original diagnostics without raw chunks", async () => {
    const model = create(configuration())("audit-model");
    const parts = await collect<
      LanguageModelV2StreamPart | LanguageModelV3StreamPart | LanguageModelV4StreamPart
    >((await model.doStream({ prompt })).stream);
    const ends = parts.filter((part) => part.type === "reasoning-end");
    expect(ends.map((part) => part.providerMetadata?.["sap-ai"]?.reasoningContent)).toEqual(
      originalBlocks,
    );
    expect(parts.filter((part) => part.type === "reasoning-delta")).toMatchObject([
      { delta: "Think {{exact}}" },
    ]);
    expect(parts.some((part) => part.type === "raw")).toBe(false);
    const finish = parts.find((part) => part.type === "finish");
    expect(finish?.providerMetadata?.["sap-ai"]).toMatchObject({
      finishReason: "native_end",
      finishReasonMapped: { raw: "native_end", unified: "stop" },
      providerSpecificFields: providerFields,
    });
  });
});

describe("AI SDK consumer history", () => {
  it.each([false, true])(
    "replays native blocks from AI SDK-generated assistant messages (streaming=%s)",
    async (streaming) => {
      const model = createSAPAIProviderV4(configuration("custom-provider"))("audit-model");
      if (streaming) {
        const result = streamText({ maxRetries: 0, model, prompt: "Hello" });
        for await (const part of result.stream) if (part.type === "error") throw part.error;
        expect(await result.rawFinishReason).toBe("native_end");
        await generateText({
          maxRetries: 0,
          messages: await result.responseMessages,
          model,
        });
      } else {
        const result = await generateText({ maxRetries: 0, model, prompt: "Hello" });
        expect(result.rawFinishReason).toBe("native_end");
        await generateText({ maxRetries: 0, messages: result.responseMessages, model });
      }
      expect(assistant(bodies.at(-1))?.reasoning_content).toEqual(originalBlocks);
    },
  );

  it("keeps positional blocks open through interleaving and late signature updates", async () => {
    chunks = [
      {
        choices: [
          {
            delta: {
              content: "",
              reasoning_content: [{ content: "first", signature: "old" }, { signature: "opaque" }],
            },
            index: 0,
          },
        ],
        usage,
      },
      {
        choices: [
          {
            delta: { content: "ok", reasoning_content: [{ content: " second", signature: "new" }] },
            index: 0,
          },
        ],
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: "stop",
            index: 0,
            provider_specific_fields: {
              early: true,
              finish_reason: "native_end",
              nested: { old: true },
            },
          },
        ],
        usage: { completion_tokens: 20, prompt_tokens: 100, total_tokens: 120 },
      },
      {
        choices: [
          {
            delta: {
              reasoning_content: [
                { signature: "" },
                { signature: "opaque-final" },
                { content: "third", signature: "third-signature" },
              ],
            },
            index: 0,
            provider_specific_fields: { later: true, nested: { current: true } },
          },
        ],
      },
    ];
    const model = createSAPAIProviderV4(configuration())("audit-model");
    const result = streamText({ maxRetries: 0, model, prompt: "Hello" });
    const parts = [];
    for await (const part of result.stream) {
      if (part.type === "error") throw part.error;
      parts.push(part);
    }
    const expectedBlocks = [
      { content: "first second", signature: "new" },
      { content: "", signature: "opaque-final" },
      { content: "third", signature: "third-signature" },
    ];
    const lastDelta = parts.reduce(
      (last, part, index) => (part.type === "reasoning-delta" ? index : last),
      -1,
    );
    const firstEnd = parts.findIndex((part) => part.type === "reasoning-end");
    expect(firstEnd).toBeGreaterThan(lastDelta);
    expect(
      parts
        .filter((part) => part.type === "reasoning-end")
        .map((part) => part.providerMetadata?.["sap-ai"]?.reasoningContent),
    ).toEqual(expectedBlocks);
    expect((await result.finalStep).providerMetadata?.["sap-ai"]?.providerSpecificFields).toEqual({
      early: true,
      finish_reason: "native_end",
      later: true,
      nested: { current: true },
    });
    expect(await result.rawFinishReason).toBe("native_end");
    expect(await result.finishReason).toBe("stop");
    expect(await result.usage).toMatchObject({
      inputTokenDetails: { cacheReadTokens: 30, cacheWriteTokens: 10 },
      outputTokenDetails: { reasoningTokens: 5 },
    });
    await generateText({
      maxRetries: 0,
      messages: await result.responseMessages,
      model,
    });
    expect(assistant(bodies.at(-1))?.reasoning_content).toEqual(expectedBlocks);
  });

  it.each([
    { chunk: malformedReasoningChunk, kind: "member", retry: "automatic" },
    { chunk: malformedReasoningChunk, kind: "member", retry: "callback" },
    { chunk: withReasoningContent("oops"), kind: "container", retry: "automatic" },
    { chunk: withReasoningContent("oops"), kind: "container", retry: "callback" },
  ] as const)(
    "recovers an invalid $kind through $retry stream retry without committing failed history",
    async ({ chunk, retry }) => {
      chunks = [chunk];
      idle = true;
      const reportedErrors: unknown[] = [];
      let toolExecutions = 0;
      const model = createSAPAIProviderV4(configuration())("audit-model");
      const result = streamText({
        maxRetries: 0,
        model,
        onError: ({ error }) => {
          reportedErrors.push(error);
          chunks = undefined;
          idle = false;
          if (retry === "callback") return { retry: true };
        },
        prompt: "Hello",
        streamRetries: retry === "automatic" ? 1 : 0,
        tools: {
          must_not_run: {
            execute: () => {
              toolExecutions++;
              return "executed";
            },
            inputSchema: z.object({}),
          },
        },
      });
      for await (const part of result.stream) {
        if (part.type === "error") throw part.error;
        if (part.type === "tool-call") throw new Error("Malformed chunk emitted a tool call");
      }
      expect(reportedErrors).toHaveLength(1);
      expect(APICallError.isInstance(reportedErrors[0])).toBe(true);
      expect(toolExecutions).toBe(0);
      expect(bodies).toHaveLength(2);
      expect(await result.text).toBe("ok");
      const completed = await result.finalStep;
      expect(
        completed.reasoning.map((part) => part.providerOptions?.["sap-ai"]?.reasoningContent),
      ).toEqual(originalBlocks);
      expect(completed.providerMetadata?.["sap-ai"]?.providerSpecificFields).toEqual(
        providerFields,
      );
      await generateText({ maxRetries: 0, messages: await result.responseMessages, model });
      expect(assistant(bodies.at(-1))).toEqual({
        content: "ok",
        reasoning_content: originalBlocks,
        role: "assistant",
      });
    },
  );
});

describe("native metadata boundaries", () => {
  it.each([
    { label: "non-empty string", value: "oops" },
    { label: "object without length", value: { signature: "private-container-value" } },
    { label: "explicit null", value: null },
  ])("rejects $label containers before text, tools or success", async ({ value }) => {
    chunks = [withReasoningContent(value)];
    const result = await createSAPAIProvider(configuration())("audit-model").doStream({ prompt });
    const parts: LanguageModelV3StreamPart[] = [];
    for await (const part of result.stream) parts.push(part);
    const errors = parts.filter((part) => part.type === "error");
    expect(errors).toHaveLength(1);
    const error = errors[0]?.error;
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error instanceof Error ? error.message : String(error)).not.toContain(
      "private-container-value",
    );
    expect(parts.at(-1)?.type).toBe("error");
    expect(
      parts.filter(
        (part) =>
          part.type.startsWith("reasoning-") ||
          part.type.startsWith("text-") ||
          part.type.startsWith("tool-") ||
          part.type === "finish",
      ),
    ).toEqual([]);
  });

  it.each([
    { label: "absent", value: undefined },
    { label: "empty array", value: [] },
  ])("preserves text completion with an $label native collection", async ({ value }) => {
    chunks = [
      {
        choices: [
          {
            delta: { content: "ok", reasoning_content: value },
            finish_reason: "stop",
            index: 0,
          },
        ],
      },
    ];
    const parts = await collect(
      (await createSAPAIProvider(configuration())("audit-model").doStream({ prompt })).stream,
    );
    expect(parts.filter((part) => part.type === "text-delta")).toMatchObject([{ delta: "ok" }]);
    expect(parts.find((part) => part.type === "finish")?.finishReason).toEqual({
      raw: "stop",
      unified: "stop",
    });
    expect(parts.filter((part) => part.type.startsWith("reasoning-"))).toEqual([]);
  });

  it("reports an invalid container without executing its registered tool", async () => {
    chunks = [withReasoningContent({})];
    let toolExecutions = 0;
    const reportedErrors: unknown[] = [];
    const result = streamText({
      maxRetries: 0,
      model: createSAPAIProviderV4(configuration())("audit-model"),
      onError: ({ error }) => {
        reportedErrors.push(error);
      },
      prompt: "Hello",
      streamRetries: 0,
      tools: {
        must_not_run: {
          execute: () => {
            toolExecutions++;
            return "executed";
          },
          inputSchema: z.object({}),
        },
      },
    });
    const parts = [];
    for await (const part of result.stream) parts.push(part);
    expect(reportedErrors).toHaveLength(1);
    expect(APICallError.isInstance(reportedErrors[0])).toBe(true);
    expect(parts.filter((part) => part.type === "error")).toHaveLength(1);
    expect(
      parts.filter(
        (part) =>
          part.type === "text-delta" || part.type === "tool-call" || part.type === "tool-result",
      ),
    ).toEqual([]);
    expect(toolExecutions).toBe(0);
    expect(bodies).toHaveLength(1);
  });

  it.each([
    { chunk: malformedReasoningChunk, deltas: [{ delta: "partial" }], label: "member" },
    { chunk: withReasoningContent("oops"), deltas: [], label: "container" },
  ])(
    "normalizes an invalid $label and cancels upstream before trailing text or tools",
    async ({ chunk, deltas }) => {
      chunks = [chunk];
      idle = true;
      const closed = new Promise<void>((resolve) => {
        onClosed = resolve;
      });
      const result = await createSAPAIProvider(configuration())("audit-model").doStream({ prompt });
      const parts: LanguageModelV3StreamPart[] = [];
      for await (const part of result.stream) parts.push(part);
      expect(parts.filter((part) => part.type === "reasoning-delta")).toMatchObject(deltas);
      const errors = parts.filter((part) => part.type === "error");
      expect(errors).toHaveLength(1);
      expect(APICallError.isInstance(errors[0]?.error)).toBe(true);
      expect(parts.at(-1)?.type).toBe("error");
      expect(
        parts.filter(
          (part) =>
            part.type === "reasoning-end" ||
            part.type === "finish" ||
            part.type.startsWith("text-") ||
            part.type.startsWith("tool-"),
        ),
      ).toEqual([]);
      await closed;
    },
  );

  it.each([null, [], "invalid", 42])(
    "ignores invalid optional provider field containers: %j",
    async (invalid) => {
      fields = invalid;
      const result = await createSAPAIProvider(configuration())("audit-model").doGenerate({
        prompt,
      });
      expect(result.finishReason).toEqual({ raw: "stop", unified: "stop" });
      expect(result.providerMetadata?.["sap-ai"]?.providerSpecificFields).toBeUndefined();
    },
  );

  it.each([
    { invalid: null, label: "null block" },
    { invalid: [], label: "array block" },
    { invalid: { signature: 42 }, label: "non-string signature" },
    { invalid: { signature: "private-signature", unknown: true }, label: "unknown block fields" },
  ])("rejects $label before HTTP without exposing signatures", async ({ invalid }) => {
    const model = createSAPAIProvider(configuration())("audit-model", { includeReasoning: true });
    try {
      await model.doGenerate({
        prompt: [
          {
            content: [
              {
                providerOptions: { "sap-ai": { reasoningContent: invalid } },
                text: "legacy fallback must not hide invalid metadata",
                type: "reasoning",
              },
            ],
            role: "assistant",
          },
        ],
      });
      throw new Error("Expected native metadata validation to reject the prompt");
    } catch (error) {
      expect(InvalidPromptError.isInstance(error)).toBe(true);
      expect(error instanceof Error ? error.message : String(error)).not.toContain(
        "private-signature",
      );
    }
    expect(bodies).toEqual([]);
  });

  it("never forwards Orchestration native fields through Foundation Models", async () => {
    const model = createSAPAIProvider(configuration())("audit-model", {
      api: "foundation-models",
      includeReasoning: true,
    });
    await model.doGenerate({
      prompt: [
        {
          content: [
            {
              providerOptions: {
                "sap-ai": {
                  reasoningContent: { content: "native", signature: "private-signature" },
                },
              },
              text: "visible",
              type: "reasoning",
            },
          ],
          role: "assistant",
        },
      ],
    });
    expect(assistant(bodies.at(-1))).toEqual({
      content: "<think>visible</think>",
      role: "assistant",
    });
    expect(JSON.stringify(bodies.at(-1))).not.toContain("private-signature");
  });

  it("closes upstream on cancellation without completing pending reasoning blocks", async () => {
    idle = true;
    const closed = new Promise<void>((resolve) => {
      onClosed = resolve;
    });
    const result = await createSAPAIProviderV4(configuration())("audit-model").doStream({ prompt });
    const reader = result.stream.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) throw new Error("Reasoning fixture ended before cancellation");
      if (next.value.type === "error") throw next.value.error;
      expect(next.value.type).not.toBe("reasoning-end");
      if (next.value.type === "reasoning-delta") break;
    }
    await reader.cancel("consumer-stop");
    await closed;
  });
});
