/** V4 facade rejects provider references before invoking the SAP transport. */

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
});
