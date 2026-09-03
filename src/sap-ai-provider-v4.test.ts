/**
 * Unit tests for SAP AI Embedding Model V4 and Provider V4 (Facades).
 *
 * Spec versions, delegation, and factory wiring. Core logic is covered by
 * the V3 core tests and the adapters tests.
 */

import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

import { embed, generateText, streamText } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { DeploymentConfig } from "./index-v4.js";

import * as v4Exports from "./index-v4.js";
import { createSAPAIProvider as createSAPAIProviderV4 } from "./index-v4.js";
import * as rootExports from "./index.js";
import { SAPAIEmbeddingModelV4 } from "./sap-ai-embedding-model-v4.js";
import { SAPAILanguageModelV4 } from "./sap-ai-language-model-v4.js";

interface InternalEmbeddingModel {
  doEmbed: (options: EmbeddingModelV3CallOptions) => Promise<EmbeddingModelV3Result>;
}

interface InternalLanguageModel {
  doGenerate: (options: LanguageModelV3CallOptions) => Promise<LanguageModelV3GenerateResult>;
  doStream: (options: LanguageModelV3CallOptions) => Promise<LanguageModelV3StreamResult>;
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

/**
 * Returns the internal V3 language model for facade contract tests.
 * @param model - The V4 language facade.
 * @returns The wrapped V3 language model.
 */
function internalLanguageOf(model: SAPAILanguageModelV4): { internalModel: InternalLanguageModel } {
  return model as unknown as { internalModel: InternalLanguageModel };
}

const languageUsage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
};

describe("SAPAIEmbeddingModelV4", () => {
  const defaultConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai" as const,
  };

  it("should have V4 specification version", () => {
    const model = new SAPAIEmbeddingModelV4("text-embedding-3-small", {}, defaultConfig);

    expect(model.specificationVersion).toBe("v4");
  });

  it("should delegate doEmbed and convert metadata", async () => {
    const model = new SAPAIEmbeddingModelV4("text-embedding-3-small", {}, defaultConfig);

    const mockDoEmbed = vi.fn((): Promise<EmbeddingModelV3Result> =>
      Promise.resolve({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 4 },
        warnings: [],
      }),
    );
    internalEmbeddingOf(model).internalModel.doEmbed = mockDoEmbed;

    const result = await model.doEmbed({ values: ["hello"] });

    expect(mockDoEmbed).toHaveBeenCalledTimes(1);
    expect(result.embeddings).toEqual([[0.1, 0.2]]);
    expect(result.usage).toEqual({ tokens: 4 });
    expect(result.warnings).toEqual([]);
  });
});

describe("createSAPAIProviderV4", () => {
  it("should create language models with specificationVersion v4", () => {
    const provider = createSAPAIProviderV4();

    expect(provider.specificationVersion).toBe("v4");
    const model = provider.languageModel("gpt-4o");
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("gpt-4o");
  });

  it("should create embedding models with specificationVersion v4", () => {
    const provider = createSAPAIProviderV4();
    const model = provider.embeddingModel("text-embedding-3-small");

    expect(model.specificationVersion).toBe("v4");
  });

  it("should throw for image models", () => {
    const provider = createSAPAIProviderV4();

    expect(() => provider.imageModel("dall-e-3")).toThrow("does not support image generation");
  });
});

describe("AI SDK 7 public integration", () => {
  it("should expose the same public names as the root entrypoint", () => {
    expect(Object.keys(v4Exports).sort()).toEqual(Object.keys(rootExports).sort());

    const deployment: DeploymentConfig = { resourceGroup: "default" };
    expect(deployment.resourceGroup).toBe("default");
  });

  it("should generate text through AI SDK 7", async () => {
    const provider = createSAPAIProviderV4();
    const model = provider("gpt-4o");
    internalLanguageOf(model).internalModel.doGenerate = vi.fn(
      (): Promise<LanguageModelV3GenerateResult> =>
        Promise.resolve({
          content: [{ text: "generated", type: "text" }],
          finishReason: { raw: "stop", unified: "stop" },
          usage: languageUsage,
          warnings: [],
        }),
    );

    const result = await generateText({ model, prompt: "hello" });
    expect(result.text).toBe("generated");
  });

  it.each([
    { expectedMediaType: "image/*", mediaType: "image" },
    { expectedMediaType: "image/*", mediaType: "IMAGE" },
    { expectedMediaType: "image/png", mediaType: "IMAGE/PNG" },
  ])(
    "should preserve remote $mediaType URLs through AI SDK 7 without fetching bytes",
    async ({ expectedMediaType, mediaType }) => {
      const provider = createSAPAIProviderV4();
      const model = provider("gpt-4o");
      const image = new URL("https://example.com/image.png");
      const download = vi.fn(
        (requests: { isUrlSupportedByModel: boolean; url: URL }[]): Promise<null[]> =>
          Promise.resolve(requests.map(() => null)),
      );
      const mockDoGenerate = vi.fn((): Promise<LanguageModelV3GenerateResult> =>
        Promise.resolve({
          content: [{ text: "analyzed", type: "text" }],
          finishReason: { raw: "stop", unified: "stop" },
          usage: languageUsage,
          warnings: [],
        }),
      );
      internalLanguageOf(model).internalModel.doGenerate = mockDoGenerate;

      const result = await generateText({
        experimental_download: download,
        messages: [{ content: [{ data: image, mediaType, type: "file" }], role: "user" }],
        model,
      });

      expect(result.text).toBe("analyzed");
      expect(download).toHaveBeenCalledWith([{ isUrlSupportedByModel: true, url: image }]);
      expect(mockDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: [
            expect.objectContaining({
              content: [
                expect.objectContaining({
                  data: image,
                  mediaType: expectedMediaType,
                  type: "file",
                }),
              ],
              role: "user",
            }),
          ],
        }),
      );
    },
  );

  it("should normalize inline MIME casing through AI SDK 7", async () => {
    const provider = createSAPAIProviderV4();
    const model = provider("gpt-4o");
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockDoGenerate = vi.fn((): Promise<LanguageModelV3GenerateResult> =>
      Promise.resolve({
        content: [{ text: "analyzed", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: languageUsage,
        warnings: [],
      }),
    );
    internalLanguageOf(model).internalModel.doGenerate = mockDoGenerate;

    await generateText({
      messages: [{ content: [{ data, mediaType: "IMAGE/PNG", type: "file" }], role: "user" }],
      model,
    });

    expect(mockDoGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          expect.objectContaining({
            content: [expect.objectContaining({ data, mediaType: "image/png", type: "file" })],
            role: "user",
          }),
        ],
      }),
    );
  });

  it("should stream text through AI SDK 7", async () => {
    const provider = createSAPAIProviderV4();
    const model = provider("gpt-4o");
    internalLanguageOf(model).internalModel.doStream = vi.fn(
      (): Promise<LanguageModelV3StreamResult> =>
        Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ id: "text-1", type: "text-start" });
              controller.enqueue({ delta: "streamed", id: "text-1", type: "text-delta" });
              controller.enqueue({ id: "text-1", type: "text-end" });
              controller.enqueue({
                finishReason: { raw: "stop", unified: "stop" },
                type: "finish",
                usage: languageUsage,
              });
              controller.close();
            },
          }),
        }),
    );

    const result = streamText({ model, prompt: "hello" });
    expect(await result.text).toBe("streamed");
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
