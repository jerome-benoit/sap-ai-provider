/**
 * Zod schemas for runtime validation of per-call options via `providerOptions['sap-ai']`.
 *
 * Implements dual validation: strict throws for providerOptions, warnings for Vercel AI SDK params.
 * @module
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
 * Zod schema for model generation parameters.
 * @internal
 */
export const modelParamsSchema = z
  .object({
    /** Frequency penalty value (-2.0 to 2.0). */
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    /** Maximum number of tokens to generate (must be a positive integer). */
    maxTokens: z.number().int().positive().optional(),
    /** Number of completions to generate (not supported by Amazon/Anthropic models). */
    n: z.number().int().positive().optional(),
    /** Whether to enable parallel tool calls. */
    parallel_tool_calls: z.boolean().optional(),
    /** Presence penalty value (-2.0 to 2.0). */
    presencePenalty: z.number().min(-2).max(2).optional(),
    /** Sampling temperature value (0 to 2). */
    temperature: z.number().min(0).max(2).optional(),
    /** Nucleus sampling probability (0 to 1). */
    topP: z.number().min(0).max(1).optional(),
  })
  .catchall(z.unknown());

/** Model generation parameters type inferred from Zod schema. */
export type ModelParams = z.infer<typeof modelParamsSchema>;

/**
 * Zod schema for embedding model parameters.
 * @internal
 */
export const embeddingModelParamsSchema = z
  .object({
    /** Output embedding dimensions (model-dependent, must be a positive integer). */
    dimensions: z.number().int().positive().optional(),
    /** Encoding format for embeddings: 'float' (default), 'base64', or 'binary'. */
    encoding_format: z.enum(["base64", "binary", "float"]).optional(),
    /** Whether to normalize embedding vectors to unit length. */
    normalize: z.boolean().optional(),
  })
  .catchall(z.unknown());

/** Embedding model parameters type inferred from Zod schema. */
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

/** Zod schema for SAP AI language model provider options passed via `providerOptions['sap-ai']` object. */
export const sapAILanguageModelProviderOptions = lazySchema(() =>
  zodSchema(
    z.object({
      /** Escape template delimiters (`{{`, `{%`, `{#`) to prevent SAP orchestration template conflicts. */
      escapeTemplatePlaceholders: z.boolean().optional(),
      /** Whether to include assistant reasoning parts in the response. */
      includeReasoning: z.boolean().optional(),
      /** Model generation parameters for this specific call. */
      modelParams: modelParamsSchema.optional(),
    }),
  ),
);

/** SAP AI language model provider options type inferred from Zod schema. */
export type SAPAILanguageModelProviderOptions = InferSchema<
  typeof sapAILanguageModelProviderOptions
>;

/** Zod schema for SAP AI embedding model provider options passed via `providerOptions['sap-ai']` object. */
export const sapAIEmbeddingProviderOptions = lazySchema(() =>
  zodSchema(
    z.object({
      /** Additional model parameters for this call. */
      modelParams: embeddingModelParamsSchema.optional(),
      /** Embedding task type: 'text' (default), 'query', or 'document'. */
      type: z.enum(["document", "query", "text"]).optional(),
    }),
  ),
);

/** SAP AI embedding model provider options type inferred from Zod schema. */
export type SAPAIEmbeddingProviderOptions = InferSchema<typeof sapAIEmbeddingProviderOptions>;
