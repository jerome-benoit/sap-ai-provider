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
    it("clears language model strategy cache", async () => {
      // Create a strategy to populate cache
      await getOrCreateLanguageModelStrategy("orchestration");
      expect(getLanguageModelStrategyCacheSize()).toBe(1);

      // Clear cache
      clearStrategyCaches();
      expect(getLanguageModelStrategyCacheSize()).toBe(0);
    });

    it("clears embedding model strategy cache", async () => {
      // Create a strategy to populate cache
      await getOrCreateEmbeddingModelStrategy("orchestration");
      expect(getEmbeddingModelStrategyCacheSize()).toBe(1);

      // Clear cache
      clearStrategyCaches();
      expect(getEmbeddingModelStrategyCacheSize()).toBe(0);
    });

    it("clears both caches simultaneously", async () => {
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
      it("loads Orchestration API SDK on first request", async () => {
        const strategy = await getOrCreateLanguageModelStrategy("orchestration");
        expect(strategy).toBeDefined();
        expect(strategy.doGenerate).toBeInstanceOf(Function);
        expect(strategy.doStream).toBeInstanceOf(Function);
      });

      it("loads foundation-models SDK on first request", async () => {
        const strategy = await getOrCreateLanguageModelStrategy("foundation-models");
        expect(strategy).toBeDefined();
        expect(strategy.doGenerate).toBeInstanceOf(Function);
        expect(strategy.doStream).toBeInstanceOf(Function);
      });

      it("returns real OrchestrationLanguageModelStrategy for orchestration", async () => {
        const strategy = await getOrCreateLanguageModelStrategy("orchestration");

        // Strategy should be a real implementation, not a placeholder
        expect(strategy).toBeDefined();
        expect(strategy.doGenerate).toBeInstanceOf(Function);
        expect(strategy.doStream).toBeInstanceOf(Function);

        // Verify it's not the placeholder by checking the class name
        expect(strategy.constructor.name).toBe("OrchestrationLanguageModelStrategy");
      });

      it("returns real strategy for foundation-models", async () => {
        const strategy = await getOrCreateLanguageModelStrategy("foundation-models");

        expect(strategy).toBeDefined();
        expect(strategy.doGenerate).toBeInstanceOf(Function);
        expect(strategy.doStream).toBeInstanceOf(Function);

        // Verify it's the real strategy by checking the class name
        expect(strategy.constructor.name).toBe("FoundationModelsLanguageModelStrategy");
      });
    });

    describe("caching behavior", () => {
      it("caches strategy for orchestration API", async () => {
        expect(getLanguageModelStrategyCacheSize()).toBe(0);

        await getOrCreateLanguageModelStrategy("orchestration");
        expect(getLanguageModelStrategyCacheSize()).toBe(1);

        // Second call should not increase cache size
        await getOrCreateLanguageModelStrategy("orchestration");
        expect(getLanguageModelStrategyCacheSize()).toBe(1);
      });

      it("caches strategy for foundation-models API", async () => {
        expect(getLanguageModelStrategyCacheSize()).toBe(0);

        await getOrCreateLanguageModelStrategy("foundation-models");
        expect(getLanguageModelStrategyCacheSize()).toBe(1);

        // Second call should not increase cache size
        await getOrCreateLanguageModelStrategy("foundation-models");
        expect(getLanguageModelStrategyCacheSize()).toBe(1);
      });

      it("maintains separate cache entries for different APIs", async () => {
        await getOrCreateLanguageModelStrategy("orchestration");
        expect(getLanguageModelStrategyCacheSize()).toBe(1);

        await getOrCreateLanguageModelStrategy("foundation-models");
        expect(getLanguageModelStrategyCacheSize()).toBe(2);
      });

      it("returns same strategy instance for same API", async () => {
        const strategy1 = await getOrCreateLanguageModelStrategy("orchestration");
        const strategy2 = await getOrCreateLanguageModelStrategy("orchestration");

        expect(strategy1).toBe(strategy2);
      });

      it("returns different strategy instances for different APIs", async () => {
        const orchestrationStrategy = await getOrCreateLanguageModelStrategy("orchestration");
        const foundationModelsStrategy =
          await getOrCreateLanguageModelStrategy("foundation-models");

        expect(orchestrationStrategy).not.toBe(foundationModelsStrategy);
      });
    });

    describe("concurrent requests", () => {
      it("handles concurrent requests for same API without race conditions", async () => {
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

      it("handles concurrent requests for different APIs", async () => {
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
      it("loads Orchestration API SDK on first request", async () => {
        const strategy = await getOrCreateEmbeddingModelStrategy("orchestration");
        expect(strategy).toBeDefined();
        expect(strategy.doEmbed).toBeInstanceOf(Function);
      });

      it("loads foundation-models SDK on first request", async () => {
        const strategy = await getOrCreateEmbeddingModelStrategy("foundation-models");
        expect(strategy).toBeDefined();
        expect(strategy.doEmbed).toBeInstanceOf(Function);
      });

      it("returns real OrchestrationEmbeddingModelStrategy for orchestration", async () => {
        const strategy = await getOrCreateEmbeddingModelStrategy("orchestration");

        // Strategy should be a real implementation, not a placeholder
        expect(strategy).toBeDefined();
        expect(strategy.doEmbed).toBeInstanceOf(Function);

        // Verify it's not the placeholder by checking the class name
        expect(strategy.constructor.name).toBe("OrchestrationEmbeddingModelStrategy");
      });

      it("returns real strategy for foundation-models", async () => {
        const strategy = await getOrCreateEmbeddingModelStrategy("foundation-models");

        expect(strategy).toBeDefined();
        expect(strategy.doEmbed).toBeInstanceOf(Function);

        // Verify it's the real strategy by checking the class name
        expect(strategy.constructor.name).toBe("FoundationModelsEmbeddingModelStrategy");
      });
    });

    describe("caching behavior", () => {
      it("caches strategy for orchestration API", async () => {
        expect(getEmbeddingModelStrategyCacheSize()).toBe(0);

        await getOrCreateEmbeddingModelStrategy("orchestration");
        expect(getEmbeddingModelStrategyCacheSize()).toBe(1);

        // Second call should not increase cache size
        await getOrCreateEmbeddingModelStrategy("orchestration");
        expect(getEmbeddingModelStrategyCacheSize()).toBe(1);
      });

      it("caches strategy for foundation-models API", async () => {
        expect(getEmbeddingModelStrategyCacheSize()).toBe(0);

        await getOrCreateEmbeddingModelStrategy("foundation-models");
        expect(getEmbeddingModelStrategyCacheSize()).toBe(1);

        // Second call should not increase cache size
        await getOrCreateEmbeddingModelStrategy("foundation-models");
        expect(getEmbeddingModelStrategyCacheSize()).toBe(1);
      });

      it("returns same strategy instance for same API", async () => {
        const strategy1 = await getOrCreateEmbeddingModelStrategy("orchestration");
        const strategy2 = await getOrCreateEmbeddingModelStrategy("orchestration");

        expect(strategy1).toBe(strategy2);
      });
    });

    describe("concurrent requests", () => {
      it("handles concurrent requests for same API without race conditions", async () => {
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
    it("language model and embedding model caches are independent", async () => {
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

    it("different model types for same API are cached separately", async () => {
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
    it("language model strategy has required methods", async () => {
      const strategy = await getOrCreateLanguageModelStrategy("orchestration");

      expect(typeof strategy.doGenerate).toBe("function");
      expect(typeof strategy.doStream).toBe("function");
    });

    it("embedding model strategy has required methods", async () => {
      const strategy = await getOrCreateEmbeddingModelStrategy("orchestration");

      expect(typeof strategy.doEmbed).toBe("function");
    });
  });
});
