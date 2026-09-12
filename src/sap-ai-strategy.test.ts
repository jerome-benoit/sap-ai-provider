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
