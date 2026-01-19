/**
 * Provider options schemas for SAP AI models.
 *
 * Zod schemas for runtime validation of per-call options via `providerOptions['sap-ai']`
 * and constructor settings.
 *
 * ## Validation Behavior
 *
 * This module implements a **dual validation strategy** for model parameters:
 *
 * | Source | Validation | Behavior |
 * |--------|------------|----------|
 * | `providerOptions['sap-ai'].modelParams` | **Strict** | Throws `ZodError` immediately |
 * | AI SDK standard options (`temperature`, etc.) | **Warning** | Emits warnings, lets API decide |
 *
 * ### Rationale
 *
 * - **Strict validation** for provider options catches invalid values early, preventing
 *   unnecessary API calls with malformed requests.
 * - **Warning-only validation** for AI SDK options allows flexibility since SAP AI Core
 *   may accept different ranges than documented, and the API is the final authority.
 *
 * ### Functions
 *
 * - {@link validateModelParamsSettings} - Strict validation (throws on error)
 * - {@link validateModelParamsWithWarnings} - Warning-only validation (for AI SDK params)
 * @example
 * ```typescript
 * import { generateText } from 'ai';
 * import { createSAPAIProvider } from '@mymediset/sap-ai-provider';
 *
 * const provider = createSAPAIProvider();
 *
 * const result = await generateText({
 *   model: provider('gpt-4o'),
 *   prompt: 'Hello',
 *   // AI SDK params - warning-only validation
 *   temperature: 0.8,
 *   // Provider options - strict validation
 *   providerOptions: {
 *     'sap-ai': {
 *       includeReasoning: true,
 *       modelParams: { temperature: 0.8 }
 *     }
 *   }
 * });
 * ```
 * @module
 */

import type { SharedV3Warning } from "@ai-sdk/provider";
import type { InferSchema } from "@ai-sdk/provider-utils";

import { lazySchema, zodSchema } from "@ai-sdk/provider-utils";
import { z } from "zod";

/**
 * The provider identifier used for provider options.
 * Use this key in `providerOptions` to pass SAP AI-specific options.
 * @example
 * ```typescript
 * providerOptions: {
 *   [SAP_AI_PROVIDER_NAME]: { includeReasoning: true }
 * }
 * ```
 */
export const SAP_AI_PROVIDER_NAME = "sap-ai" as const;

/**
 * Extracts the base provider name from a full provider identifier.
 *
 * Following the AI SDK convention, provider identifiers use the format `{name}.{modelType}`
 * (e.g., "openai.chat", "anthropic.messages"). This function extracts the base name
 * for use with `providerOptions` and `providerMetadata`, which use the base name as key.
 * @param provider - The full provider identifier (e.g., "sap-ai.chat", "sap-ai.embedding")
 * @returns The base provider name (e.g., "sap-ai")
 * @example
 * ```typescript
 * getBaseProviderName("sap-ai.chat") // => "sap-ai"
 * getBaseProviderName("sap-ai-core.embedding") // => "sap-ai-core"
 * getBaseProviderName("sap-ai") // => "sap-ai" (backward compatible)
 * ```
 */
export function getBaseProviderName(provider: string): string {
  const dotIndex = provider.indexOf(".");
  return dotIndex === -1 ? provider : provider.slice(0, dotIndex);
}

/**
 * Zod schema for model generation parameters.
 * @internal
 */
export const modelParamsSchema = z
  .object({
    /**
     * Frequency penalty between -2.0 and 2.0.
     * Positive values penalize tokens based on their frequency in the text so far.
     */
    frequencyPenalty: z.number().min(-2).max(2).optional(),

    /**
     * Maximum number of tokens to generate.
     * Must be a positive integer.
     */
    maxTokens: z.number().int().positive().optional(),

    /**
     * Number of completions to generate.
     * Must be a positive integer.
     * Note: Not supported by Amazon and Anthropic models.
     */
    n: z.number().int().positive().optional(),

    /**
     * Whether to enable parallel tool calls.
     * When enabled, the model can call multiple tools in parallel.
     */
    parallel_tool_calls: z.boolean().optional(),

    /**
     * Presence penalty between -2.0 and 2.0.
     * Positive values penalize tokens that have appeared in the text so far.
     */
    presencePenalty: z.number().min(-2).max(2).optional(),

    /**
     * Sampling temperature between 0 and 2.
     * Higher values make output more random, lower values more deterministic.
     */
    temperature: z.number().min(0).max(2).optional(),

    /**
     * Nucleus sampling parameter between 0 and 1.
     * Controls diversity via cumulative probability cutoff.
     */
    topP: z.number().min(0).max(1).optional(),
  })
  .catchall(z.unknown());

/**
 * TypeScript type for model generation parameters.
 * Inferred from the Zod schema for type safety.
 */
export type ModelParams = z.infer<typeof modelParamsSchema>;

/**
 * Zod schema for embedding model parameters.
 *
 * Validates known parameters for SAP AI Core embedding models while
 * allowing additional model-specific parameters via catchall.
 * @internal
 */
export const embeddingModelParamsSchema = z
  .object({
    /**
     * The number of dimensions for output embeddings.
     * Must be a positive integer. Support varies by model.
     * - text-embedding-3-small: supports 512, 1536
     * - text-embedding-3-large: supports 256, 1024, 3072
     */
    dimensions: z.number().int().positive().optional(),

    /**
     * Encoding format for embeddings.
     * - 'float': Array of floats (default)
     * - 'base64': Base64-encoded binary
     * - 'binary': Raw binary format
     */
    encoding_format: z.enum(["base64", "binary", "float"]).optional(),

    /**
     * Whether to normalize the embedding vectors.
     * When true, vectors are normalized to unit length.
     */
    normalize: z.boolean().optional(),
  })
  .catchall(z.unknown());

/**
 * TypeScript type for embedding model parameters.
 * Inferred from the Zod schema for type safety.
 */
export type EmbeddingModelParams = z.infer<typeof embeddingModelParamsSchema>;

/**
 * Validates embedding model parameters from constructor settings.
 *
 * This function validates the `modelParams` object passed to embedding model
 * constructors, ensuring values are within valid ranges before any API calls.
 * @param modelParams - The embedding model parameters to validate
 * @returns The validated embedding model parameters with proper typing
 * @throws {z.ZodError} If validation fails with details about invalid fields
 * @example
 * ```typescript
 * // In constructor
 * if (settings.modelParams) {
 *   validateEmbeddingModelParamsSettings(settings.modelParams);
 * }
 * ```
 */
export function validateEmbeddingModelParamsSettings(modelParams: unknown): EmbeddingModelParams {
  return embeddingModelParamsSchema.parse(modelParams);
}

/**
 * Validates model parameters from constructor settings.
 *
 * This function validates the `modelParams` object passed to model constructors,
 * ensuring values are within valid ranges before any API calls are made.
 * @param modelParams - The model parameters to validate
 * @returns The validated model parameters with proper typing
 * @throws {z.ZodError} If validation fails with details about invalid fields
 * @example
 * ```typescript
 * // In constructor
 * if (settings.modelParams) {
 *   validateModelParamsSettings(settings.modelParams);
 * }
 * ```
 */
export function validateModelParamsSettings(modelParams: unknown): ModelParams {
  return modelParamsSchema.parse(modelParams);
}

/**
 * Validates AI SDK standard parameters and adds warnings for out-of-range values.
 *
 * This function uses `modelParamsSchema.safeParse()` to ensure consistency with
 * the strict validation used for `providerOptions['sap-ai'].modelParams`.
 * Unlike `validateModelParamsSettings`, this function does NOT throw - it only
 * emits warnings to allow the API to be the final authority on parameter validity.
 *
 * **Validation behavior:**
 * - `providerOptions['sap-ai'].modelParams` → strict validation (throws via Zod)
 * - AI SDK standard options (`temperature`, `topP`, etc.) → warnings only (this function)
 * @param params - AI SDK options parameters to validate
 * @param params.frequencyPenalty - Frequency penalty (-2 to 2)
 * @param params.maxTokens - Maximum tokens (positive integer)
 * @param params.presencePenalty - Presence penalty (-2 to 2)
 * @param params.temperature - Sampling temperature (0 to 2)
 * @param params.topP - Nucleus sampling (0 to 1)
 * @param warnings - Array to append warnings to (must be compatible with SharedV3Warning[])
 * @example
 * ```typescript
 * const warnings: SharedV3Warning[] = [];
 * validateModelParamsWithWarnings(
 *   { temperature: 2.5, maxTokens: -1 },
 *   warnings
 * );
 * // warnings now contains messages about invalid values with type: "other"
 * ```
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

/**
 * Zod schema for SAP AI language model provider options.
 *
 * These options can be passed per-call via `providerOptions['sap-ai']` to override
 * constructor settings or provide request-specific configuration.
 * @example
 * ```typescript
 * const result = await generateText({
 *   model: provider('gpt-4o'),
 *   prompt: 'Hello',
 *   providerOptions: {
 *     'sap-ai': {
 *       includeReasoning: true,
 *       modelParams: { temperature: 0.7, maxTokens: 1000 }
 *     }
 *   }
 * });
 * ```
 */
export const sapAILanguageModelProviderOptions = lazySchema(() =>
  zodSchema(
    z.object({
      /**
       * Whether to include assistant reasoning parts in the response.
       * Overrides the constructor `includeReasoning` setting for this specific call.
       *
       * Reasoning parts contain internal model chain-of-thought reasoning.
       * Enable for debugging/analysis; disable for production applications.
       */
      includeReasoning: z.boolean().optional(),

      /**
       * Model generation parameters for this specific call.
       * These override the corresponding constructor `modelParams` settings.
       */
      modelParams: modelParamsSchema.optional(),
    }),
  ),
);

/**
 * TypeScript type for SAP AI language model provider options.
 * Inferred from the Zod schema for type safety.
 */
export type SAPAILanguageModelProviderOptions = InferSchema<
  typeof sapAILanguageModelProviderOptions
>;

/**
 * Zod schema for SAP AI embedding model provider options.
 *
 * These options can be passed per-call via `providerOptions['sap-ai']` to override
 * constructor settings or provide request-specific configuration.
 * @example
 * ```typescript
 * const { embedding } = await embed({
 *   model: provider.embedding('text-embedding-ada-002'),
 *   value: 'Hello, world!',
 *   providerOptions: {
 *     'sap-ai': {
 *       type: 'query'
 *     }
 *   }
 * });
 * ```
 */
export const sapAIEmbeddingProviderOptions = lazySchema(() =>
  zodSchema(
    z.object({
      /**
       * Additional model parameters for this call.
       * Passed directly to the embedding API.
       *
       * Known parameters:
       * - `dimensions`: Output embedding dimensions (model-dependent)
       * - `encoding_format`: 'float' | 'base64' | 'binary'
       * - `normalize`: Whether to normalize vectors
       * @see {@link embeddingModelParamsSchema} for validation rules
       */
      modelParams: embeddingModelParamsSchema.optional(),

      /**
       * Embedding task type for this specific call.
       * Overrides the constructor `type` setting.
       *
       * - `text`: General-purpose text embeddings (default)
       * - `query`: Optimized for search queries
       * - `document`: Optimized for document content
       */
      type: z.enum(["document", "query", "text"]).optional(),
    }),
  ),
);

/**
 * TypeScript type for SAP AI embedding model provider options.
 * Inferred from the Zod schema for type safety.
 */
export type SAPAIEmbeddingProviderOptions = InferSchema<typeof sapAIEmbeddingProviderOptions>;
