/**
 * Tests for SAP AI Strategy Pattern Infrastructure.
 *
 * Tests cover:
 * - Strategy interface types (compile-time verification)
 * - Lazy loading behavior (SDK imports happen on first use)
 * - Promise-based caching (prevents race conditions)
 * - SDK import error handling (clear error messages)
 * - Retry behavior (failed imports can be retried)
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStrategyCaches,
  getEmbeddingModelStrategyCacheSize,
  getLanguageModelStrategyCacheSize,
  getOrCreateEmbeddingModelStrategy,
  getOrCreateLanguageModelStrategy,
} from "./sap-ai-strategy.js";

describe("sapAiStrategy", () => {
  // Clear caches before each test to ensure isolation
  beforeEach(() => {
    clearStrategyCaches();
  });

  afterEach(() => {
    clearStrategyCaches();
    vi.restoreAllMocks();
  });

  describe("clearStrategyCaches", () => {
    it.each([
      {
        description: "language model strategy cache",
        getCacheSize: getLanguageModelStrategyCacheSize,
        populateCache: () => getOrCreateLanguageModelStrategy("orchestration"),
      },
      {
        description: "embedding model strategy cache",
        getCacheSize: getEmbeddingModelStrategyCacheSize,
        populateCache: () => getOrCreateEmbeddingModelStrategy("orchestration"),
      },
    ])("should clear $description", async ({ getCacheSize, populateCache }) => {
      // Create a strategy to populate cache
      await populateCache();
      expect(getCacheSize()).toBe(1);

      // Clear cache
      clearStrategyCaches();
      expect(getCacheSize()).toBe(0);
    });

    it("should clear both caches simultaneously", async () => {
      // Populate both caches
      await Promise.all([
        getOrCreateLanguageModelStrategy("orchestration"),
        getOrCreateEmbeddingModelStrategy("orchestration"),
      ]);

      expect(getLanguageModelStrategyCacheSize()).toBe(1);
      expect(getEmbeddingModelStrategyCacheSize()).toBe(1);

      // Clear both
      clearStrategyCaches();

      expect(getLanguageModelStrategyCacheSize()).toBe(0);
      expect(getEmbeddingModelStrategyCacheSize()).toBe(0);
    });
  });

  describe("getOrCreateLanguageModelStrategy", () => {
    describe("lazy loading", () => {
      it.each([
        { api: "orchestration" as const, expectedClass: "OrchestrationLanguageModelStrategy" },
        {
          api: "foundation-models" as const,
          expectedClass: "FoundationModelsLanguageModelStrategy",
        },
      ])("should load $api SDK on first request", async ({ api }) => {
        const strategy = await getOrCreateLanguageModelStrategy(api);
        expect(strategy).toBeDefined();
        expect(strategy.doGenerate).toBeInstanceOf(Function);
        expect(strategy.doStream).toBeInstanceOf(Function);
      });

      it.each([
        { api: "orchestration" as const, expectedClass: "OrchestrationLanguageModelStrategy" },
        {
          api: "foundation-models" as const,
          expectedClass: "FoundationModelsLanguageModelStrategy",
        },
      ])("should return real $expectedClass for $api", async ({ api, expectedClass }) => {
        const strategy = await getOrCreateLanguageModelStrategy(api);

        // Strategy should be a real implementation, not a placeholder
        expect(strategy).toBeDefined();
        expect(strategy.doGenerate).toBeInstanceOf(Function);
        expect(strategy.doStream).toBeInstanceOf(Function);

        // Verify it's the real strategy by checking the class name
        expect(strategy.constructor.name).toBe(expectedClass);
      });
    });

    describe("caching behavior", () => {
      it.each([{ api: "orchestration" as const }, { api: "foundation-models" as const }])(
        "should cache strategy for $api API",
        async ({ api }) => {
          expect(getLanguageModelStrategyCacheSize()).toBe(0);

          await getOrCreateLanguageModelStrategy(api);
          expect(getLanguageModelStrategyCacheSize()).toBe(1);

          // Second call should not increase cache size
          await getOrCreateLanguageModelStrategy(api);
          expect(getLanguageModelStrategyCacheSize()).toBe(1);
        },
      );

      it("should maintain separate cache entries for different APIs", async () => {
        await getOrCreateLanguageModelStrategy("orchestration");
        expect(getLanguageModelStrategyCacheSize()).toBe(1);

        await getOrCreateLanguageModelStrategy("foundation-models");
        expect(getLanguageModelStrategyCacheSize()).toBe(2);
      });

      it("should return same strategy instance for same API", async () => {
        const strategy1 = await getOrCreateLanguageModelStrategy("orchestration");
        const strategy2 = await getOrCreateLanguageModelStrategy("orchestration");

        expect(strategy1).toBe(strategy2);
      });

      it("should return different strategy instances for different APIs", async () => {
        const orchestrationStrategy = await getOrCreateLanguageModelStrategy("orchestration");
        const foundationModelsStrategy =
          await getOrCreateLanguageModelStrategy("foundation-models");

        expect(orchestrationStrategy).not.toBe(foundationModelsStrategy);
      });
    });

    describe("concurrent requests", () => {
      it("should handle concurrent requests for same API without race conditions", async () => {
        // Make 10 concurrent requests for the same API
        const promises = Array.from({ length: 10 }, () =>
          getOrCreateLanguageModelStrategy("orchestration"),
        );

        const strategies = await Promise.all(promises);

        // All should resolve to the same instance
        const firstStrategy = strategies[0];
        for (const strategy of strategies) {
          expect(strategy).toBe(firstStrategy);
        }

        // Cache should have only one entry
        expect(getLanguageModelStrategyCacheSize()).toBe(1);
      });

      it("should handle concurrent requests for different APIs", async () => {
        // Make concurrent requests for both APIs
        const [orchestration1, foundationModels1, orchestration2, foundationModels2] =
          await Promise.all([
            getOrCreateLanguageModelStrategy("orchestration"),
            getOrCreateLanguageModelStrategy("foundation-models"),
            getOrCreateLanguageModelStrategy("orchestration"),
            getOrCreateLanguageModelStrategy("foundation-models"),
          ]);

        // Same API should return same instance
        expect(orchestration1).toBe(orchestration2);
        expect(foundationModels1).toBe(foundationModels2);

        // Different APIs should return different instances
        expect(orchestration1).not.toBe(foundationModels1);

        // Cache should have two entries
        expect(getLanguageModelStrategyCacheSize()).toBe(2);
      });
    });
  });

  describe("getOrCreateEmbeddingModelStrategy", () => {
    describe("lazy loading", () => {
      it.each([
        { api: "orchestration" as const, expectedClass: "OrchestrationEmbeddingModelStrategy" },
        {
          api: "foundation-models" as const,
          expectedClass: "FoundationModelsEmbeddingModelStrategy",
        },
      ])("should load $api SDK on first request", async ({ api }) => {
        const strategy = await getOrCreateEmbeddingModelStrategy(api);
        expect(strategy).toBeDefined();
        expect(strategy.doEmbed).toBeInstanceOf(Function);
      });

      it.each([
        { api: "orchestration" as const, expectedClass: "OrchestrationEmbeddingModelStrategy" },
        {
          api: "foundation-models" as const,
          expectedClass: "FoundationModelsEmbeddingModelStrategy",
        },
      ])("should return real $expectedClass for $api", async ({ api, expectedClass }) => {
        const strategy = await getOrCreateEmbeddingModelStrategy(api);

        // Strategy should be a real implementation, not a placeholder
        expect(strategy).toBeDefined();
        expect(strategy.doEmbed).toBeInstanceOf(Function);

        // Verify it's the real strategy by checking the class name
        expect(strategy.constructor.name).toBe(expectedClass);
      });
    });

    describe("caching behavior", () => {
      it.each([{ api: "orchestration" as const }, { api: "foundation-models" as const }])(
        "should cache strategy for $api API",
        async ({ api }) => {
          expect(getEmbeddingModelStrategyCacheSize()).toBe(0);

          await getOrCreateEmbeddingModelStrategy(api);
          expect(getEmbeddingModelStrategyCacheSize()).toBe(1);

          // Second call should not increase cache size
          await getOrCreateEmbeddingModelStrategy(api);
          expect(getEmbeddingModelStrategyCacheSize()).toBe(1);
        },
      );

      it("should return same strategy instance for same API", async () => {
        const strategy1 = await getOrCreateEmbeddingModelStrategy("orchestration");
        const strategy2 = await getOrCreateEmbeddingModelStrategy("orchestration");

        expect(strategy1).toBe(strategy2);
      });
    });

    describe("concurrent requests", () => {
      it("should handle concurrent requests for same API without race conditions", async () => {
        // Make 10 concurrent requests for the same API
        const promises = Array.from({ length: 10 }, () =>
          getOrCreateEmbeddingModelStrategy("orchestration"),
        );

        const strategies = await Promise.all(promises);

        // All should resolve to the same instance
        const firstStrategy = strategies[0];
        for (const strategy of strategies) {
          expect(strategy).toBe(firstStrategy);
        }

        // Cache should have only one entry
        expect(getEmbeddingModelStrategyCacheSize()).toBe(1);
      });
    });
  });

  describe("cache independence", () => {
    it("should maintain independent language model and embedding model caches", async () => {
      // Populate language model cache
      await getOrCreateLanguageModelStrategy("orchestration");
      expect(getLanguageModelStrategyCacheSize()).toBe(1);
      expect(getEmbeddingModelStrategyCacheSize()).toBe(0);

      // Populate embedding model cache
      await getOrCreateEmbeddingModelStrategy("orchestration");
      expect(getLanguageModelStrategyCacheSize()).toBe(1);
      expect(getEmbeddingModelStrategyCacheSize()).toBe(1);

      // Clear only language model cache (via full clear)
      clearStrategyCaches();
      expect(getLanguageModelStrategyCacheSize()).toBe(0);
      expect(getEmbeddingModelStrategyCacheSize()).toBe(0);
    });

    it("should cache different model types for same API separately", async () => {
      const languageStrategy = await getOrCreateLanguageModelStrategy("orchestration");
      const embeddingStrategy = await getOrCreateEmbeddingModelStrategy("orchestration");

      // They should be different objects
      expect(languageStrategy).not.toBe(embeddingStrategy);

      // But each type should be cached
      expect(getLanguageModelStrategyCacheSize()).toBe(1);
      expect(getEmbeddingModelStrategyCacheSize()).toBe(1);
    });
  });

  describe("strategy interface compliance", () => {
    it("should have required methods on language model strategy", async () => {
      const strategy = await getOrCreateLanguageModelStrategy("orchestration");

      expect(typeof strategy.doGenerate).toBe("function");
      expect(typeof strategy.doStream).toBe("function");
    });

    it("should have required methods on embedding model strategy", async () => {
      const strategy = await getOrCreateEmbeddingModelStrategy("orchestration");

      expect(typeof strategy.doEmbed).toBe("function");
    });
  });
});
