/** V2 facade result conversion and error propagation. */

import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider-v2";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SAPAILanguageModelV2 } from "./sap-ai-language-model-v2.js";
import { SAPAILanguageModel } from "./sap-ai-language-model.js";

const config = {
  deploymentConfig: { resourceGroup: "default" },
  provider: "sap-ai",
};
const prompt = [{ content: [{ text: "Test", type: "text" as const }], role: "user" as const }];
const result: LanguageModelV3GenerateResult = {
  content: [{ text: "Test", type: "text" }],
  finishReason: { raw: "stop", unified: "stop" },
  usage: {
    inputTokens: { cacheRead: 2, cacheWrite: 3, noCache: 5, total: 10 },
    outputTokens: { reasoning: 4, text: 16, total: 20 },
  },
  warnings: [],
};
const usage = {
  cachedInputTokens: 2,
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 4,
  totalTokens: 30,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAPAILanguageModelV2", () => {
  it("returns a string finish reason and flat usage from doGenerate", async () => {
    vi.spyOn(SAPAILanguageModel.prototype, "doGenerate").mockResolvedValue(result);
    const model = new SAPAILanguageModelV2("gpt-4o", {}, config);

    const generated = await model.doGenerate({ prompt });

    expect(generated.finishReason).toBe("stop");
    expect(generated.usage).toEqual(usage);
  });

  it("returns a string finish reason and flat usage on stream finish", async () => {
    vi.spyOn(SAPAILanguageModel.prototype, "doStream").mockResolvedValue({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({
            finishReason: result.finishReason,
            type: "finish",
            usage: result.usage,
          });
          controller.close();
        },
      }),
    });
    const model = new SAPAILanguageModelV2("gpt-4o", {}, config);

    const streamed = await model.doStream({ prompt });
    const reader = streamed.stream.getReader();

    expect((await reader.read()).value).toEqual({ finishReason: "stop", type: "finish", usage });
    expect((await reader.read()).done).toBe(true);
  });

  it.each(["doGenerate", "doStream"] as const)("propagates %s errors unchanged", async (method) => {
    const error = new Error("generation failed");
    vi.spyOn(SAPAILanguageModel.prototype, method).mockRejectedValue(error);
    const model = new SAPAILanguageModelV2("gpt-4o", {}, config);

    await expect(model[method]({ prompt })).rejects.toBe(error);
  });
});

describe("official AI SDK 5 tool-media input", () => {
  it.each(["doGenerate", "doStream"] as const)(
    "normalizes media before %s delegation",
    async (method) => {
      const generate = vi
        .spyOn(SAPAILanguageModel.prototype, "doGenerate")
        .mockResolvedValue(result);
      const stream = vi.spyOn(SAPAILanguageModel.prototype, "doStream").mockResolvedValue({
        stream: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      });
      const options: LanguageModelV2CallOptions = {
        prompt: [
          {
            content: [
              {
                output: {
                  type: "content",
                  value: [
                    { text: "Screenshot", type: "text" },
                    {
                      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
                      mediaType: "image/png",
                      type: "media",
                    },
                  ],
                },
                providerOptions: { "sap-ai": { itemId: "tool-result-metadata" } },
                toolCallId: "image-call",
                toolName: "capture",
                type: "tool-result",
              },
            ],
            providerOptions: { "sap-ai": { itemId: "message-metadata" } },
            role: "tool",
          },
        ],
      };
      const model = new SAPAILanguageModelV2("gpt-6.1-sol", { api: "responses" }, config);
      await model[method](options);
      const forwarded =
        method === "doGenerate" ? generate.mock.calls[0]?.[0] : stream.mock.calls[0]?.[0];
      expect(forwarded?.prompt).toEqual([
        {
          content: [
            {
              output: {
                type: "content",
                value: [
                  { text: "Screenshot", type: "text" },
                  {
                    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
                    mediaType: "image/png",
                    type: "image-data",
                  },
                ],
              },
              providerOptions: { "sap-ai": { itemId: "tool-result-metadata" } },
              toolCallId: "image-call",
              toolName: "capture",
              type: "tool-result",
            },
          ],
          providerOptions: { "sap-ai": { itemId: "message-metadata" } },
          role: "tool",
        },
      ]);
    },
  );
});

describe("legacy V2 tool compatibility", () => {
  it("preserves the unsupported provider-defined tool discriminator", async () => {
    const generate = vi.spyOn(SAPAILanguageModel.prototype, "doGenerate").mockResolvedValue(result);
    const tools: LanguageModelV2CallOptions["tools"] = [
      { args: {}, id: "openai.web_search", name: "search", type: "provider-defined" },
    ];
    await new SAPAILanguageModelV2("gpt-6.1-sol", { api: "responses" }, config).doGenerate({
      prompt,
      tools,
    });
    expect(generate.mock.calls[0]?.[0].tools).toEqual(tools);
  });
});

describe("V2 native tool approval boundary", () => {
  it("rejects approvals before returning an invalid V2 generation result", async () => {
    vi.spyOn(SAPAILanguageModel.prototype, "doGenerate").mockResolvedValue({
      ...result,
      content: [{ approvalId: "approval-1", toolCallId: "call-1", type: "tool-approval-request" }],
    });
    const model = new SAPAILanguageModelV2("gpt-6.1-sol", { api: "responses" }, config);
    await expect(model.doGenerate({ prompt })).rejects.toThrow(/Tool approvals.*\/v3.*\/v4/);
  });

  it("rejects streamed approvals and cancels the delegated stream", async () => {
    const cancel = vi.fn();
    vi.spyOn(SAPAILanguageModel.prototype, "doStream").mockResolvedValue({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        cancel,
        start(controller) {
          controller.enqueue({
            approvalId: "approval-1",
            toolCallId: "call-1",
            type: "tool-approval-request",
          });
        },
      }),
    });
    const model = new SAPAILanguageModelV2("gpt-6.1-sol", { api: "responses" }, config);
    const reader = (await model.doStream({ prompt })).stream.getReader();
    await expect(reader.read()).rejects.toThrow(/Tool approvals.*\/v3.*\/v4/);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(expect.any(UnsupportedFunctionalityError));
  });
});
