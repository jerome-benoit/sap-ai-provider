import { afterEach, describe, expect, it } from "vitest";

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
  });

  it("rejects Responses embedding strategy selection", async () => {
    await expect(getOrCreateEmbeddingModelStrategy("responses")).rejects.toMatchObject({
      api: "responses",
      name: "UnsupportedFeatureError",
      suggestedApi: "foundation-models",
    });
  });
});
