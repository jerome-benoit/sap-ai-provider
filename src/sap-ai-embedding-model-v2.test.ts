/** V2 embeddings report warnings through the console rather than the result. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { SAPAIEmbeddingModelV2 } from "./sap-ai-embedding-model-v2.js";
import { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAPAIEmbeddingModelV2 warnings", () => {
  const config = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai",
  };

  it("reports an unsupported feature without adding V3 warnings to the V2 result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(SAPAIEmbeddingModel.prototype, "doEmbed").mockResolvedValue({
      embeddings: [[1]],
      warnings: [{ feature: "dimensions", type: "unsupported" }],
    });
    const model = new SAPAIEmbeddingModelV2("text-embedding-3-small", {}, config);

    const result = await model.doEmbed({ values: ["Test"] });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("dimensions");
    expect(result).not.toHaveProperty("warnings");
  });

  it("does not log when there are no warnings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(SAPAIEmbeddingModel.prototype, "doEmbed").mockResolvedValue({
      embeddings: [[1]],
      warnings: [],
    });
    const model = new SAPAIEmbeddingModelV2("text-embedding-3-small", {}, config);

    await model.doEmbed({ values: ["Test"] });

    expect(warn).not.toHaveBeenCalled();
  });
});
