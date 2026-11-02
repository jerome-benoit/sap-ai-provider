/** V4 retains legacy restrictions and model-local capability state. */

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { SAPAILanguageModelV4 } from "./sap-ai-language-model-v4.js";

describe("SAPAILanguageModelV4", () => {
  it.each(["doGenerate", "doStream"] as const)(
    "rejects unresolved file references from %s",
    async (method) => {
      const model = new SAPAILanguageModelV4(
        "gpt-4o",
        {},
        { deploymentConfig: { resourceGroup: "default" }, provider: "sap-ai" },
      );

      await expect(
        model[method]({
          prompt: [
            {
              content: [
                {
                  data: { reference: { "sap-ai": "file-123" }, type: "reference" },
                  mediaType: "image/png",
                  type: "file",
                },
              ],
              role: "user",
            },
          ],
        }),
      ).rejects.toBeInstanceOf(UnsupportedFunctionalityError);
    },
  );

  it("keeps URL capabilities conservative and independent across models", () => {
    const config = { deploymentConfig: { resourceGroup: "default" }, provider: "sap-ai" };
    const first = new SAPAILanguageModelV4("gpt-4o", { api: "responses" }, config);
    const second = new SAPAILanguageModelV4("gpt-4o", {}, config);
    const urls = first.supportedUrls;
    expect(urls).not.toHaveProperty("application/pdf");
    urls["application/pdf"] = [/./];
    urls["image/*"]?.push(/mutated/);
    expect(second.supportedUrls).not.toHaveProperty("application/pdf");
    expect(second.supportedUrls["image/*"]).toHaveLength(2);
    expect(first.supportedUrls["image/*"]).toHaveLength(2);
  });

  it("validates model parameters at construction without creating a V3 delegate", () => {
    expect(
      () =>
        new SAPAILanguageModelV4(
          "gpt-4o",
          { modelParams: { temperature: Number.NaN } },
          { deploymentConfig: { resourceGroup: "default" }, provider: "sap-ai" },
        ),
    ).toThrow();
  });
});
