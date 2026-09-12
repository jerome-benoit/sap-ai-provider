/** V2 facade result conversion and error propagation. */

import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from "@ai-sdk/provider";

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
