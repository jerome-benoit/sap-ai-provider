/** Unit tests for SAP AI Provider Options. */

import type { SharedV3Warning } from "@ai-sdk/provider";

import { safeValidateTypes } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";

import {
  embeddingModelParamsSchema,
  getProviderName,
  modelParamsSchema,
  orchestrationConfigRefSchema,
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

    it("should accept placeholderValues as record of strings", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: { placeholderValues: { product: "SAP Cloud SDK", version: "1.0" } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          placeholderValues: { product: "SAP Cloud SDK", version: "1.0" },
        });
      }
    });

    it("should accept empty placeholderValues", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: { placeholderValues: {} },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({ placeholderValues: {} });
      }
    });

    it("should accept placeholderValues with grounding placeholders", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          placeholderValues: {
            groundingInput: "What is SAP?",
            groundingOutput: "",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          placeholderValues: {
            groundingInput: "What is SAP?",
            groundingOutput: "",
          },
        });
      }
    });

    it("should accept promptTemplateRef with id", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          promptTemplateRef: {
            id: "my-template-id",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          promptTemplateRef: { id: "my-template-id" },
        });
      }
    });

    it("should accept promptTemplateRef with id and scope", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          promptTemplateRef: {
            id: "my-template-id",
            scope: "resource_group",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          promptTemplateRef: { id: "my-template-id", scope: "resource_group" },
        });
      }
    });

    it("should accept promptTemplateRef with scenario/name/version", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          promptTemplateRef: {
            name: "greeting-template",
            scenario: "customer-support",
            version: "latest",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          promptTemplateRef: {
            name: "greeting-template",
            scenario: "customer-support",
            version: "latest",
          },
        });
      }
    });

    it("should accept promptTemplateRef with scenario/name/version and scope", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          promptTemplateRef: {
            name: "greeting-template",
            scenario: "customer-support",
            scope: "tenant",
            version: "1.0",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          promptTemplateRef: {
            name: "greeting-template",
            scenario: "customer-support",
            scope: "tenant",
            version: "1.0",
          },
        });
      }
    });

    it("should accept orchestrationConfigRef with id", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          orchestrationConfigRef: {
            id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          orchestrationConfigRef: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
        });
      }
    });

    it("should accept orchestrationConfigRef with scenario/name/version", async () => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value: {
          orchestrationConfigRef: {
            name: "prod-config",
            scenario: "customer-support",
            version: "1.0.0",
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual({
          orchestrationConfigRef: {
            name: "prod-config",
            scenario: "customer-support",
            version: "1.0.0",
          },
        });
      }
    });
  });

  describe("validation constraints", () => {
    it.each([
      {
        description: "invalid modelParams",
        value: { modelParams: { temperature: 99 } },
      },
      {
        description: "includeReasoning non-boolean",
        value: { includeReasoning: "true" },
      },
      {
        description: "placeholderValues with non-string values",
        value: { placeholderValues: { product: 123 } },
      },
      {
        description: "placeholderValues as array",
        value: { placeholderValues: ["product", "version"] },
      },
      {
        description: "promptTemplateRef with empty id",
        value: { promptTemplateRef: { id: "" } },
      },
      {
        description: "promptTemplateRef with invalid scope",
        value: { promptTemplateRef: { id: "my-id", scope: "invalid" } },
      },
      {
        description: "promptTemplateRef with missing scenario fields",
        value: { promptTemplateRef: { scenario: "test" } },
      },
      {
        description: "promptTemplateRef with empty scenario",
        value: { promptTemplateRef: { name: "test", scenario: "", version: "1.0" } },
      },
      {
        description: "promptTemplateRef with empty name",
        value: { promptTemplateRef: { name: "", scenario: "test", version: "1.0" } },
      },
      {
        description: "promptTemplateRef with empty version",
        value: { promptTemplateRef: { name: "test", scenario: "test", version: "" } },
      },
      {
        description: "orchestrationConfigRef with empty id",
        value: { orchestrationConfigRef: { id: "" } },
      },
      {
        description: "orchestrationConfigRef with missing scenario fields",
        value: { orchestrationConfigRef: { scenario: "test" } },
      },
      {
        description: "orchestrationConfigRef with empty scenario",
        value: { orchestrationConfigRef: { name: "test", scenario: "", version: "1.0" } },
      },
      {
        description: "orchestrationConfigRef with empty name",
        value: { orchestrationConfigRef: { name: "", scenario: "test", version: "1.0" } },
      },
      {
        description: "orchestrationConfigRef with empty version",
        value: { orchestrationConfigRef: { name: "test", scenario: "test", version: "" } },
      },
    ])("should reject $description", async ({ value }) => {
      const result = await safeValidateTypes({
        schema: sapAILanguageModelProviderOptions,
        value,
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

    it("should have correct TypeScript type with placeholderValues", () => {
      const validOptions: SAPAILanguageModelProviderOptions = {
        placeholderValues: {
          groundingInput: "What is SAP?",
          groundingOutput: "",
          product: "SAP Cloud SDK",
        },
      };
      expect(validOptions).toBeDefined();
      expect(validOptions.placeholderValues?.product).toBe("SAP Cloud SDK");
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
    it.each([
      { description: "temperature below 0", params: { temperature: -0.1 } },
      { description: "temperature above 2", params: { temperature: 2.1 } },
      { description: "topP below 0", params: { topP: -0.1 } },
      { description: "topP above 1", params: { topP: 1.1 } },
      { description: "frequencyPenalty below -2", params: { frequencyPenalty: -2.1 } },
      { description: "frequencyPenalty above 2", params: { frequencyPenalty: 2.1 } },
      { description: "presencePenalty below -2", params: { presencePenalty: -2.1 } },
      { description: "presencePenalty above 2", params: { presencePenalty: 2.1 } },
      { description: "non-positive maxTokens", params: { maxTokens: 0 } },
      { description: "negative maxTokens", params: { maxTokens: -1 } },
      { description: "non-integer maxTokens", params: { maxTokens: 100.5 } },
      { description: "non-positive n", params: { n: 0 } },
      { description: "non-integer n", params: { n: 1.5 } },
      { description: "non-boolean parallel_tool_calls", params: { parallel_tool_calls: "true" } },
    ])("should reject $description", ({ params }) => {
      const result = modelParamsSchema.safeParse(params);
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

describe("orchestrationConfigRefSchema", () => {
  describe("valid config references", () => {
    it.each([
      {
        config: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
        description: "config ref with UUID id",
      },
      {
        config: { name: "prod-config", scenario: "customer-support", version: "1.0.0" },
        description: "config ref with scenario/name/version",
      },
      {
        config: { id: "12345678-1234-1234-1234-123456789abc" },
        description: "config ref with alternate UUID",
      },
      { config: { id: "my-config" }, description: "config ref with simple string id" },
    ])("should accept $description", ({ config }) => {
      const result = orchestrationConfigRefSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid config references", () => {
    it.each([
      { description: "empty id", value: { id: "" } },
      { description: "empty scenario", value: { name: "test", scenario: "", version: "1.0" } },
      { description: "empty name", value: { name: "", scenario: "test", version: "1.0" } },
      { description: "empty version", value: { name: "test", scenario: "test", version: "" } },
      { description: "missing fields in scenario form", value: { scenario: "test" } },
      {
        description: "partial scenario/name (missing version)",
        value: { name: "test", scenario: "test" },
      },
      { description: "empty object", value: {} },
      { description: "non-string id", value: { id: 123 } },
    ])("should reject $description", ({ value }) => {
      const result = orchestrationConfigRefSchema.safeParse(value);
      expect(result.success).toBe(false);
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
    it.each([
      { description: "non-positive dimensions", params: { dimensions: 0 } },
      { description: "negative dimensions", params: { dimensions: -1 } },
      { description: "non-integer dimensions", params: { dimensions: 1.5 } },
      { description: "invalid encoding_format", params: { encoding_format: "invalid" } },
      { description: "non-boolean normalize", params: { normalize: "true" } },
    ])("should reject $description", ({ params }) => {
      const result = embeddingModelParamsSchema.safeParse(params);
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
