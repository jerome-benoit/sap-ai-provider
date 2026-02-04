/**
 * Zod schemas for runtime validation of per-call options via `providerOptions['sap-ai']`.
 */

import type { SharedV3Warning } from "@ai-sdk/provider";
import type { InferSchema } from "@ai-sdk/provider-utils";

import { lazySchema, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";

/** Default provider name used as key in `providerOptions` and `providerMetadata` objects. */
export const SAP_AI_PROVIDER_NAME = "sap-ai" as const;

/**
 * Extracts the provider name from a provider identifier (e.g., "sap-ai.chat" → "sap-ai").
 * @param providerIdentifier - The full provider identifier string.
 * @returns The provider name without any suffix.
 */
export function getProviderName(providerIdentifier: string): string {
  const dotIndex = providerIdentifier.indexOf(".");
  return dotIndex === -1 ? providerIdentifier : providerIdentifier.slice(0, dotIndex);
}

/**
 * @internal
 */
export const modelParamsSchema = z
  .object({
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    n: z.number().int().positive().optional(),
    parallel_tool_calls: z.boolean().optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
  })
  .catchall(z.unknown());

/** @internal */
export type ModelParams = z.infer<typeof modelParamsSchema>;

/**
 * @internal
 */
export const embeddingModelParamsSchema = z
  .object({
    dimensions: z.number().int().positive().optional(),
    encoding_format: z.enum(["base64", "binary", "float"]).optional(),
    normalize: z.boolean().optional(),
  })
  .catchall(z.unknown());

/** @internal */
export type EmbeddingModelParams = z.infer<typeof embeddingModelParamsSchema>;

/**
 * Validates embedding model parameters from constructor settings.
 * @param modelParams - The model parameters to validate.
 * @returns The validated embedding model parameters.
 * @throws {z.ZodError} If validation fails.
 */
export function validateEmbeddingModelParamsSettings(modelParams: unknown): EmbeddingModelParams {
  return embeddingModelParamsSchema.parse(modelParams);
}

/**
 * Validates model parameters from constructor settings.
 * @param modelParams - The model parameters to validate.
 * @returns The validated model parameters.
 * @throws {z.ZodError} If validation fails.
 */
export function validateModelParamsSettings(modelParams: unknown): ModelParams {
  return modelParamsSchema.parse(modelParams);
}

/**
 * Validates Vercel AI SDK standard parameters and adds warnings for out-of-range values.
 * @param params - The parameters to validate.
 * @param params.frequencyPenalty - Frequency penalty value (-2.0 to 2.0).
 * @param params.maxTokens - Maximum tokens value (positive integer).
 * @param params.presencePenalty - Presence penalty value (-2.0 to 2.0).
 * @param params.temperature - Temperature value (0 to 2).
 * @param params.topP - Top-p value (0 to 1).
 * @param warnings - Array to collect validation warnings.
 */
export function validateModelParamsWithWarnings(
  params: {
    frequencyPenalty?: number;
    maxTokens?: number;
    presencePenalty?: number;
    temperature?: number;
    topP?: number;
  },
  warnings: SharedV3Warning[],
): void {
  const result = modelParamsSchema.safeParse(params);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      const value = path ? (params as Record<string, unknown>)[path] : undefined;
      warnings.push({
        message: `${path}=${String(value)} is invalid: ${issue.message}. The API may reject this value.`,
        type: "other",
      });
    }
  }
}

/** @internal */
export const sapAIApiTypeSchema = z.enum(["orchestration", "foundation-models"]);

/** @internal */
export const promptTemplateScopeSchema = z.enum(["tenant", "resource_group"]);

/** @internal */
export const promptTemplateRefByIdSchema = z.object({
  id: z.string().min(1, "Template ID cannot be empty"),
  scope: promptTemplateScopeSchema.optional(),
});

/** @internal */
export const promptTemplateRefByScenarioNameVersionSchema = z.object({
  name: z.string().min(1, "Template name cannot be empty"),
  scenario: z.string().min(1, "Scenario cannot be empty"),
  scope: promptTemplateScopeSchema.optional(),
  version: z.string().min(1, "Version cannot be empty"),
});

/** @internal */
export const promptTemplateRefSchema = z.union([
  promptTemplateRefByIdSchema,
  promptTemplateRefByScenarioNameVersionSchema,
]);

/** @internal */
export const sapAILanguageModelProviderOptions = lazySchema(() =>
  zodSchema(
    z.object({
      api: sapAIApiTypeSchema.optional(),
      escapeTemplatePlaceholders: z.boolean().optional(),
      includeReasoning: z.boolean().optional(),
      modelParams: modelParamsSchema.optional(),
      placeholderValues: z.record(z.string(), z.string()).optional(),
      promptTemplateRef: promptTemplateRefSchema.optional(),
    }),
  ),
);

/** @internal */
export type SAPAILanguageModelProviderOptions = InferSchema<
  typeof sapAILanguageModelProviderOptions
>;

/** @internal */
export const sapAIEmbeddingProviderOptions = lazySchema(() =>
  zodSchema(
    z.object({
      api: sapAIApiTypeSchema.optional(),
      modelParams: embeddingModelParamsSchema.optional(),
      type: z.enum(["document", "query", "text"]).optional(),
    }),
  ),
);

/** @internal */
export type SAPAIEmbeddingProviderOptions = InferSchema<typeof sapAIEmbeddingProviderOptions>;
