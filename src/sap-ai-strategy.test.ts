import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ResponsesStrategyModule from "./responses-language-model-strategy.js";

import {
  clearStrategyCaches,
  getOrCreateEmbeddingModelStrategy,
  getOrCreateLanguageModelStrategy,
} from "./sap-ai-strategy.js";

afterEach(clearStrategyCaches);

describe.each([
  { create: getOrCreateLanguageModelStrategy, kind: "language model" },
  { create: getOrCreateEmbeddingModelStrategy, kind: "embedding model" },
])("$kind strategy caching", ({ create }) => {
  it("shares a pending strategy only within the same API", async () => {
    const orchestration = create("orchestration");
    const foundationModels = create("foundation-models");
    expect(create("orchestration")).toBe(orchestration);
    expect(create("foundation-models")).toBe(foundationModels);
    const [first, second] = await Promise.all([orchestration, foundationModels]);
    expect(first).not.toBe(second);
    expect(await create("orchestration")).toBe(first);
  });

  it("recreates strategies after clearing the cache", async () => {
    const previous = await create("orchestration");
    clearStrategyCaches();
    expect(await create("orchestration")).not.toBe(previous);
  });
});

describe("Responses strategy selection", () => {
  it("caches the Responses language strategy independently from Chat Completions", async () => {
    const responses = getOrCreateLanguageModelStrategy("responses");
    expect(getOrCreateLanguageModelStrategy("responses")).toBe(responses);
    const [responsesStrategy, foundationStrategy] = await Promise.all([
      responses,
      getOrCreateLanguageModelStrategy("foundation-models"),
    ]);
    expect(responsesStrategy).not.toBe(foundationStrategy);
    expect(responsesStrategy.api).toBe("responses");
    expect(foundationStrategy.api).toBe("foundation-models");
    expect(responsesStrategy.strategy).not.toBe(foundationStrategy.strategy);
  });

  it("evicts failed language strategy initialization and shares the replacement", async () => {
    const actual = await vi.importActual<typeof ResponsesStrategyModule>(
      "./responses-language-model-strategy.js",
    );
    const failure = new Error("Fixture strategy initialization failure");
    let attempts = 0;
    vi.doMock("./responses-language-model-strategy.js", () => ({
      ResponsesLanguageModelStrategy: class extends actual.ResponsesLanguageModelStrategy {
        constructor() {
          super();
          if (attempts++ === 0) throw failure;
        }
      },
    }));
    try {
      const pending = getOrCreateLanguageModelStrategy("responses");
      expect(getOrCreateLanguageModelStrategy("responses")).toBe(pending);
      await expect(pending).rejects.toBe(failure);
      const replacement = getOrCreateLanguageModelStrategy("responses");
      expect(replacement).not.toBe(pending);
      expect(getOrCreateLanguageModelStrategy("responses")).toBe(replacement);
      const selected = await replacement;
      expect(selected.api).toBe("responses");
      expect(attempts).toBe(2);
      expect(await getOrCreateLanguageModelStrategy("responses")).toBe(selected);
    } finally {
      vi.doUnmock("./responses-language-model-strategy.js");
    }
  });

  it("rejects Responses embedding strategy selection", async () => {
    await expect(getOrCreateEmbeddingModelStrategy("responses")).rejects.toMatchObject({
      api: "responses",
      name: "UnsupportedFeatureError",
      suggestedApi: "foundation-models",
    });
  });
});
