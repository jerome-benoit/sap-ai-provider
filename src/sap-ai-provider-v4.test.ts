/** V4 public entrypoint integration with AI SDK 7 and unsupported-image behavior. */

import type { EmbeddingModelV3CallOptions, EmbeddingModelV3Result } from "@ai-sdk/provider";

import { NoSuchModelError } from "@ai-sdk/provider";
import { embed } from "ai";
import { describe, expect, it, vi } from "vitest";

import * as v4Exports from "./index-v4.js";
import { createSAPAIProvider as createSAPAIProviderV4 } from "./index-v4.js";
import * as rootExports from "./index.js";
import { SAPAIEmbeddingModelV4 } from "./sap-ai-embedding-model-v4.js";

interface InternalEmbeddingModel {
  doEmbed: (options: EmbeddingModelV3CallOptions) => Promise<EmbeddingModelV3Result>;
}

/**
 * Returns the internal V3 embedding model for facade contract tests.
 * @param model - The V4 embedding facade.
 * @returns The wrapped V3 embedding model.
 */
function internalEmbeddingOf(model: SAPAIEmbeddingModelV4): {
  internalModel: InternalEmbeddingModel;
} {
  return model as unknown as { internalModel: InternalEmbeddingModel };
}

describe("createSAPAIProviderV4", () => {
  it("should throw for image models", () => {
    const provider = createSAPAIProviderV4();

    expect(() => provider.imageModel("dall-e-3")).toThrow(NoSuchModelError);
  });

  it("should create a provider when the Node process global is unavailable", () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
    Reflect.deleteProperty(globalThis, "process");
    try {
      expect(() => createSAPAIProviderV4()).not.toThrow();
    } finally {
      if (processDescriptor !== undefined) {
        Object.defineProperty(globalThis, "process", processDescriptor);
      }
    }
  });
});

describe("AI SDK 7 public integration", () => {
  it("should expose the same public names as the root entrypoint", () => {
    expect(Object.keys(v4Exports).sort()).toEqual(Object.keys(rootExports).sort());
  });

  it("should embed through the provider.embedding alias and AI SDK 7", async () => {
    const provider = createSAPAIProviderV4();
    const model = provider.embedding("text-embedding-3-small");
    internalEmbeddingOf(model).internalModel.doEmbed = vi.fn((): Promise<EmbeddingModelV3Result> =>
      Promise.resolve({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 4 },
        warnings: [],
      }),
    );

    const result = await embed({ model, value: "hello" });
    expect(result.embedding).toEqual([0.1, 0.2]);
    expect(result.usage).toEqual({ tokens: 4 });
  });
});
