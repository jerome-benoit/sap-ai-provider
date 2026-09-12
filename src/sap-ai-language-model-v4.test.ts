/** V4 facade normalizes tagged file prompts before entering the V3 core. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { SAPAILanguageModelV4 } from "./sap-ai-language-model-v4.js";
import { SAPAILanguageModel } from "./sap-ai-language-model.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAPAILanguageModelV4", () => {
  it("normalizes tagged file prompts before generation", async () => {
    const generate = vi.spyOn(SAPAILanguageModel.prototype, "doGenerate").mockResolvedValue({
      content: [],
      finishReason: { raw: "stop", unified: "stop" },
      usage: {
        inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
        outputTokens: { reasoning: 0, text: 1, total: 1 },
      },
      warnings: [],
    });
    const model = new SAPAILanguageModelV4(
      "gpt-4o",
      {},
      {
        deploymentConfig: { resourceGroup: "default" },
        provider: "sap-ai",
      },
    );

    await model.doGenerate({
      prompt: [
        {
          content: [
            {
              data: { data: "aGVsbG8=", type: "data" },
              mediaType: "image/jpeg",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
    });

    expect(generate.mock.calls[0]?.[0].prompt).toEqual([
      {
        content: [{ data: "aGVsbG8=", mediaType: "image/jpeg", type: "file" }],
        role: "user",
      },
    ]);
  });
});
