/** Unit tests for SAP AI Provider Options. */

import type { SharedV3Warning } from "@ai-sdk/provider";

import { safeValidateTypes } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";

import {
  embeddingModelParamsSchema,
  getProviderName,
  modelParamsSchema,
  SAP_AI_PROVIDER_NAME,
  sapAIEmbeddingProviderOptions,
  type SAPAIEmbeddingProviderOptions,
  sapAILanguageModelProviderOptions,
  type SAPAILanguageModelProviderOptions,
  validateEmbeddingModelParamsSettings,
  validateModelParamsSettings,
  validateModelParamsWithWarnings,
} from "./sap-ai-provider-options";

describe("SAP_AI_PROVIDER_NAME", () => {
  it("should have the correct provider name", () => {
    expect(SAP_AI_PROVIDER_NAME).toBe("sap-ai");
  });
});

describe("getProviderName", () => {
  it("should extract provider name from identifier with .chat suffix", () => {
    expect(getProviderName("sap-ai.chat")).toBe("sap-ai");
  });

  it("should extract provider name from identifier with .embedding suffix", () => {
    expect(getProviderName("sap-ai.embedding")).toBe("sap-ai");
  });

  it("should extract provider name from custom provider identifiers", () => {
    expect(getProviderName("sap-ai-core.chat")).toBe("sap-ai-core");
    expect(getProviderName("my-custom-provider.embedding")).toBe("my-custom-provider");
  });

  it("should return the input unchanged if no dot is present", () => {
    expect(getProviderName("sap-ai")).toBe("sap-ai");
    expect(getProviderName("openai")).toBe("openai");
  });

  it("should handle empty string", () => {
    expect(getProviderName("")).toBe("");
  });

  it("should only split on first dot", () => {
    expect(getProviderName("sap.ai.chat")).toBe("sap");
  });
});

describe("sapAILanguageModelProviderOptions", () => {
  describe("valid options", () => {
    it("should accept empty object", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({});
      }
    });

    it("should accept includeReasoning boolean", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: { includeReasoning: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({ includeReasoning: true });
      }
    });

    it("should accept modelParams with temperature", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: { modelParams: { temperature: 0.7 } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({ modelParams: { temperature: 0.7 } });
      }
    });

    it("should accept modelParams with all fields", async () => {
      const options = {
        includeReasoning: false,
        modelParams: {
          frequencyPenalty: 0.5,
          maxTokens: 1000,
          n: 1,
          parallel_tool_calls: true,
          presencePenalty: 0.3,
          temperature: 0.8,
          topP: 0.9,
        },
      };
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: options,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual(options);
      }
    });

    it("should allow passthrough of unknown modelParams fields", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          modelParams: {
            customField: "custom-value",
            temperature: 0.5,
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          modelParams: {
            customField: "custom-value",
            temperature: 0.5,
          },
        });
      }
    });
  });

  describe("validation constraints", () => {
    it("should reject invalid modelParams", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: { modelParams: { temperature: 99 } },
      });
      expect(result.success).toBe(false);
    });

    it("should reject includeReasoning non-boolean", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: { includeReasoning: "true" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("type inference", () => {
    it("should have correct TypeScript type", () => {
      const validOptions: SAPAILanguageModelProviderOptions = {
        includeReasoning: true,
        modelParams: {
          maxTokens: 100,
          temperature: 0.5,
        },
      };
      expect(validOptions).toBeDefined();
    });
  });
});

describe("sapAIEmbeddingProviderOptions", () => {
  describe("valid options", () => {
    it("should accept empty object", async () => {
      const result = await safeValidateTypes({
        schema: sapAIEmbeddingProviderOptions,
        value: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({});
      }
    });

    it.each([{ type: "text" as const }, { type: "query" as const }, { type: "document" as const }])(
      "should accept type '$type'",
      async ({ type }) => {
        const result = await safeValidateTypes({
          schema: sapAIEmbeddingProviderOptions,
          value: { type },
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value).toEqual({ type });
        }
      },
    );

    it("should accept modelParams as record", async () => {
      const result = await safeValidateTypes({
        schema: sapAIEmbeddingProviderOptions,
        value: { modelParams: { dimensions: 1536 } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({ modelParams: { dimensions: 1536 } });
      }
    });

    it("should accept all fields together", async () => {
      const options = {
        modelParams: { customParam: true, dimensions: 1536 },
        type: "query" as const,
      };
      const result = await safeValidateTypes({
        schema: sapAIEmbeddingProviderOptions,
        value: options,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual(options);
      }
    });
  });

  describe("validation constraints", () => {
    it("should reject invalid type value", async () => {
      const result = await safeValidateTypes({
        schema: sapAIEmbeddingProviderOptions,
        value: { type: "invalid" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject type as number", async () => {
      const result = await safeValidateTypes({
        schema: sapAIEmbeddingProviderOptions,
        value: { type: 123 },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid modelParams", async () => {
      const result = await safeValidateTypes({
        schema: sapAIEmbeddingProviderOptions,
        value: { modelParams: { dimensions: -1 } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("type inference", () => {
    it("should have correct TypeScript type", () => {
      const validOptions: SAPAIEmbeddingProviderOptions = {
        modelParams: { dimensions: 1536 },
        type: "query",
      };
      expect(validOptions).toBeDefined();
    });
  });
});

describe("modelParamsSchema", () => {
  describe("valid parameters", () => {
    it("should accept empty object", () => {
      const result = modelParamsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept all valid parameters", () => {
      const result = modelParamsSchema.safeParse({
        frequencyPenalty: 0.5,
        maxTokens: 1000,
        n: 2,
        parallel_tool_calls: true,
        presencePenalty: -0.5,
        temperature: 0.7,
        topP: 0.9,
      });
      expect(result.success).toBe(true);
    });

    it("should accept boundary values", () => {
      const result = modelParamsSchema.safeParse({
        frequencyPenalty: -2,
        maxTokens: 1,
        n: 1,
        presencePenalty: 2,
        temperature: 0,
        topP: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should accept unknown additional properties", () => {
      const result = modelParamsSchema.safeParse({
        customProperty: "value",
        temperature: 0.5,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid parameters", () => {
    it("should reject temperature below 0", () => {
      const result = modelParamsSchema.safeParse({ temperature: -0.1 });
      expect(result.success).toBe(false);
    });

    it("should reject temperature above 2", () => {
      const result = modelParamsSchema.safeParse({ temperature: 2.1 });
      expect(result.success).toBe(false);
    });

    it("should reject topP below 0", () => {
      const result = modelParamsSchema.safeParse({ topP: -0.1 });
      expect(result.success).toBe(false);
    });

    it("should reject topP above 1", () => {
      const result = modelParamsSchema.safeParse({ topP: 1.1 });
      expect(result.success).toBe(false);
    });

    it("should reject frequencyPenalty below -2", () => {
      const result = modelParamsSchema.safeParse({ frequencyPenalty: -2.1 });
      expect(result.success).toBe(false);
    });

    it("should reject frequencyPenalty above 2", () => {
      const result = modelParamsSchema.safeParse({ frequencyPenalty: 2.1 });
      expect(result.success).toBe(false);
    });

    it("should reject presencePenalty below -2", () => {
      const result = modelParamsSchema.safeParse({ presencePenalty: -2.1 });
      expect(result.success).toBe(false);
    });

    it("should reject presencePenalty above 2", () => {
      const result = modelParamsSchema.safeParse({ presencePenalty: 2.1 });
      expect(result.success).toBe(false);
    });

    it("should reject non-positive maxTokens", () => {
      const result = modelParamsSchema.safeParse({ maxTokens: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject negative maxTokens", () => {
      const result = modelParamsSchema.safeParse({ maxTokens: -1 });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer maxTokens", () => {
      const result = modelParamsSchema.safeParse({ maxTokens: 100.5 });
      expect(result.success).toBe(false);
    });

    it("should reject non-positive n", () => {
      const result = modelParamsSchema.safeParse({ n: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer n", () => {
      const result = modelParamsSchema.safeParse({ n: 1.5 });
      expect(result.success).toBe(false);
    });

    it("should reject non-boolean parallel_tool_calls", () => {
      const result = modelParamsSchema.safeParse({ parallel_tool_calls: "true" });
      expect(result.success).toBe(false);
    });
  });
});

describe("validateModelParamsSettings", () => {
  it("should accept valid modelParams", () => {
    expect(() =>
      validateModelParamsSettings({
        maxTokens: 1000,
        temperature: 0.7,
      }),
    ).not.toThrow();
  });

  it("should return validated params", () => {
    const result = validateModelParamsSettings({
      temperature: 0.5,
      topP: 0.9,
    });
    expect(result).toEqual({
      temperature: 0.5,
      topP: 0.9,
    });
  });

  it("should throw on invalid params", () => {
    expect(() => validateModelParamsSettings({ temperature: 99 })).toThrow();
  });

  it("should throw with descriptive error message", () => {
    try {
      validateModelParamsSettings({ temperature: -1 });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeDefined();
      expect(String(error)).toContain("temperature");
    }
  });
});

describe("validateModelParamsWithWarnings", () => {
  describe("consistency with modelParamsSchema", () => {
    const testCases = [
      // Valid values - should NOT produce warnings
      { desc: "empty object", expectWarning: false, params: {} },
      { desc: "temperature at min (0)", expectWarning: false, params: { temperature: 0 } },
      { desc: "temperature at max (2)", expectWarning: false, params: { temperature: 2 } },
      { desc: "temperature in range", expectWarning: false, params: { temperature: 0.7 } },
      { desc: "topP at min (0)", expectWarning: false, params: { topP: 0 } },
      { desc: "topP at max (1)", expectWarning: false, params: { topP: 1 } },
      { desc: "topP in range", expectWarning: false, params: { topP: 0.5 } },
      {
        desc: "frequencyPenalty at min (-2)",
        expectWarning: false,
        params: { frequencyPenalty: -2 },
      },
      {
        desc: "frequencyPenalty at max (2)",
        expectWarning: false,
        params: { frequencyPenalty: 2 },
      },
      {
        desc: "presencePenalty at min (-2)",
        expectWarning: false,
        params: { presencePenalty: -2 },
      },
      { desc: "presencePenalty at max (2)", expectWarning: false, params: { presencePenalty: 2 } },
      { desc: "maxTokens at min (1)", expectWarning: false, params: { maxTokens: 1 } },
      { desc: "maxTokens in range", expectWarning: false, params: { maxTokens: 1000 } },

      // Invalid values - SHOULD produce warnings
      { desc: "temperature below min", expectWarning: true, params: { temperature: -0.1 } },
      { desc: "temperature above max", expectWarning: true, params: { temperature: 2.1 } },
      { desc: "topP below min", expectWarning: true, params: { topP: -0.1 } },
      { desc: "topP above max", expectWarning: true, params: { topP: 1.1 } },
      {
        desc: "frequencyPenalty below min",
        expectWarning: true,
        params: { frequencyPenalty: -2.1 },
      },
      {
        desc: "frequencyPenalty above max",
        expectWarning: true,
        params: { frequencyPenalty: 2.1 },
      },
      { desc: "presencePenalty below min", expectWarning: true, params: { presencePenalty: -2.1 } },
      { desc: "presencePenalty above max", expectWarning: true, params: { presencePenalty: 2.1 } },
      { desc: "maxTokens at zero", expectWarning: true, params: { maxTokens: 0 } },
      { desc: "maxTokens negative", expectWarning: true, params: { maxTokens: -1 } },
    ];

    it.each(testCases)("should $expectWarning for $desc", ({ expectWarning, params }) => {
      const warnings: SharedV3Warning[] = [];
      validateModelParamsWithWarnings(params, warnings);

      const schemaResult = modelParamsSchema.safeParse(params);
      const schemaIsValid = schemaResult.success;
      const hasWarnings = warnings.length > 0;

      expect(hasWarnings).toBe(!schemaIsValid);
      expect(hasWarnings).toBe(expectWarning);
    });

    it("should produce warnings with type 'other'", () => {
      const warnings: SharedV3Warning[] = [];
      validateModelParamsWithWarnings({ temperature: 3 }, warnings);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]?.type).toBe("other");
    });

    it("should include parameter name in warning message", () => {
      const warnings: SharedV3Warning[] = [];
      validateModelParamsWithWarnings({ temperature: 3, topP: 2 }, warnings);

      expect(warnings.length).toBe(2);
      const tempWarning = warnings.find(
        (w) => w.type === "other" && w.message.includes("temperature"),
      );
      const topPWarning = warnings.find((w) => w.type === "other" && w.message.includes("topP"));
      expect(tempWarning).toBeDefined();
      expect(topPWarning).toBeDefined();
    });
  });
});

describe("embeddingModelParamsSchema", () => {
  describe("valid parameters", () => {
    it("should accept empty object", () => {
      const result = embeddingModelParamsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept all known parameters", () => {
      const result = embeddingModelParamsSchema.safeParse({
        dimensions: 1536,
        encoding_format: "float",
        normalize: true,
      });
      expect(result.success).toBe(true);
    });

    it("should accept dimensions as positive integer", () => {
      const result = embeddingModelParamsSchema.safeParse({ dimensions: 256 });
      expect(result.success).toBe(true);
    });

    it("should accept all encoding_format values", () => {
      for (const format of ["float", "base64", "binary"] as const) {
        const result = embeddingModelParamsSchema.safeParse({ encoding_format: format });
        expect(result.success).toBe(true);
      }
    });

    it("should accept unknown additional properties", () => {
      const result = embeddingModelParamsSchema.safeParse({
        customProperty: "value",
        dimensions: 1536,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid parameters", () => {
    it("should reject non-positive dimensions", () => {
      const result = embeddingModelParamsSchema.safeParse({ dimensions: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject negative dimensions", () => {
      const result = embeddingModelParamsSchema.safeParse({ dimensions: -1 });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer dimensions", () => {
      const result = embeddingModelParamsSchema.safeParse({ dimensions: 1.5 });
      expect(result.success).toBe(false);
    });

    it("should reject invalid encoding_format", () => {
      const result = embeddingModelParamsSchema.safeParse({ encoding_format: "invalid" });
      expect(result.success).toBe(false);
    });

    it("should reject non-boolean normalize", () => {
      const result = embeddingModelParamsSchema.safeParse({ normalize: "true" });
      expect(result.success).toBe(false);
    });
  });
});

describe("validateEmbeddingModelParamsSettings", () => {
  it("should accept valid embedding params", () => {
    expect(() =>
      validateEmbeddingModelParamsSettings({
        dimensions: 1536,
        encoding_format: "float",
      }),
    ).not.toThrow();
  });

  it("should throw on invalid dimensions", () => {
    expect(() => validateEmbeddingModelParamsSettings({ dimensions: -1 })).toThrow();
  });

  it("should return validated params", () => {
    const result = validateEmbeddingModelParamsSettings({
      dimensions: 1536,
      normalize: true,
    });
    expect(result).toEqual({
      dimensions: 1536,
      normalize: true,
    });
  });
});
