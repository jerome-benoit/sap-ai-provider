/**
 * SAP AI Embedding Model V2 implementation.
 *
 * This module provides an EmbeddingModelV2 facade that wraps the internal
 * EmbeddingModelV3 implementation and transforms the output to V2 format.
 *
 * This approach allows us to:
 * - Reuse all SAP AI Core business logic from the V3 implementation
 * - Present a V2 API to users (compatible with AI SDK 5.x)
 * - Keep the upstream V3 code unchanged for easy git merges
 * @module sap-ai-embedding-model-v2
 */

import type {
  EmbeddingModelV2,
  EmbeddingModelV3CallOptions,
  SharedV2Headers,
  SharedV2ProviderMetadata,
  SharedV2ProviderOptions,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { SAPAIEmbeddingSettings } from "./sap-ai-embedding-model.js";

import { convertWarningsV3ToV2 } from "./sap-ai-adapters-v3-to-v2.js";
import { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";

/**
 * Internal configuration for the SAP AI Embedding Model.
 * @internal
 */
interface SAPAIEmbeddingConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
}

/**
 * SAP AI Core Embedding Model implementing the Vercel AI SDK EmbeddingModelV2 interface.
 *
 * This class implements the AI SDK's `EmbeddingModelV2` interface (for AI SDK 5.x),
 * providing a bridge between AI SDK 5.x and SAP AI Core's Orchestration API
 * using the official SAP AI SDK (@sap-ai-sdk/orchestration).
 *
 * **Architecture:**
 * This is a thin facade that delegates to the internal V3 implementation
 * (SAPAIEmbeddingModel) and transforms the output to V2 format.
 *
 * **Features:**
 * - Text embedding generation (single and batch)
 * - Multiple embedding types (query, document)
 * - Parallel batch processing
 *
 * **Model Support:**
 * - Azure OpenAI embeddings (text-embedding-ada-002, text-embedding-3-small, text-embedding-3-large)
 * - Anthropic embeddings (if available through SAP AI Core)
 * - Other embedding models available in SAP AI Core
 * @see {@link https://sdk.vercel.ai/docs/ai-sdk-core/embeddings Vercel AI SDK Embeddings}
 * @see {@link https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/orchestration SAP AI Core Orchestration}
 * @example
 * ```typescript
 * // Create via provider
 * const provider = createSAPAIProvider();
 *
 * // Single embedding
 * const { embedding } = await embed({
 *   model: provider.textEmbedding('text-embedding-ada-002'),
 *   value: 'Hello, world!'
 * });
 *
 * // Multiple embeddings
 * const { embeddings } = await embedMany({
 *   model: provider.textEmbedding('text-embedding-3-small'),
 *   values: ['Hello', 'World', 'AI']
 * });
 * ```
 */
export class SAPAIEmbeddingModelV2 implements EmbeddingModelV2<string> {
  readonly maxEmbeddingsPerCall: number | undefined;
  readonly modelId: string;
  readonly provider: string;
  readonly specificationVersion = "v2" as const;
  readonly supportsParallelCalls: boolean;

  /** Internal V3 model instance that handles all SAP AI Core logic */
  private readonly v3Model: SAPAIEmbeddingModel;

  /**
   * Creates a new SAP AI Embedding Model V2 instance.
   * @internal
   * @param modelId - The embedding model identifier (e.g., 'text-embedding-ada-002')
   * @param settings - Model-specific configuration settings
   * @param config - Internal configuration (deployment config, destination, etc.)
   */
  constructor(modelId: string, settings: SAPAIEmbeddingSettings, config: SAPAIEmbeddingConfig) {
    this.v3Model = new SAPAIEmbeddingModel(modelId, settings, config);
    this.provider = this.v3Model.provider;
    this.modelId = this.v3Model.modelId;
    this.maxEmbeddingsPerCall = this.v3Model.maxEmbeddingsPerCall;
    this.supportsParallelCalls = this.v3Model.supportsParallelCalls;
  }

  /**
   * Generates embeddings for the given text values.
   *
   * Implements `EmbeddingModelV2.doEmbed`, delegating to the internal V3 implementation
   * and transforming the response to V2 format.
   *
   * The main differences between V2 and V3:
   * - V3 includes a `warnings` array that needs to be converted
   * - Provider metadata and headers use different type definitions
   * @param options - Embedding options including values and headers
   * @param options.values - Array of text values to embed
   * @param options.abortSignal - Optional abort signal for cancelling the operation
   * @param options.providerOptions - Optional provider-specific options
   * @param options.headers - Optional HTTP headers
   * @returns Promise resolving to embeddings and metadata in V2 format
   * @since 1.0.0
   */
  async doEmbed(options: {
    abortSignal?: AbortSignal;
    headers?: Record<string, string | undefined>;
    providerOptions?: SharedV2ProviderOptions;
    values: string[];
  }): Promise<{
    embeddings: number[][];
    providerMetadata?: SharedV2ProviderMetadata;
    response?: {
      body?: unknown;
      headers?: SharedV2Headers;
    };
    usage?: { tokens: number };
  }> {
    // Call internal V3 implementation
    // Map V2 options to V3 format explicitly for type safety
    const v3Options: EmbeddingModelV3CallOptions = {
      abortSignal: options.abortSignal,
      headers: options.headers as Record<string, string> | undefined,
      providerOptions: options.providerOptions,
      values: options.values,
    };
    const v3Result = await this.v3Model.doEmbed(v3Options);

    // V3 always includes warnings array, V2 doesn't have warnings
    // We convert warnings to logs/errors instead of returning them
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (v3Result.warnings && v3Result.warnings.length > 0) {
      const v2Warnings = convertWarningsV3ToV2(v3Result.warnings);
      // Log warnings instead of including them in the response
      v2Warnings.forEach((warning) => {
        if (warning.type === "other") {
          console.warn(`[SAP AI Embedding] ${warning.message}`);
        } else if (warning.type === "unsupported-setting") {
          console.warn(
            `[SAP AI Embedding] Unsupported setting: ${String(warning.setting)}${warning.details ? ` - ${warning.details}` : ""}`,
          );
        } else {
          console.warn(
            `[SAP AI Embedding] Unsupported tool: ${warning.tool.name}${warning.details ? ` - ${warning.details}` : ""}`,
          );
        }
      });
    }

    // Transform V3 result to V2 format
    return {
      embeddings: v3Result.embeddings,
      providerMetadata: castProviderMetadataV3ToV2(v3Result.providerMetadata),
      response: v3Result.response
        ? {
            body: v3Result.response.body,
            headers: v3Result.response.headers as SharedV2Headers | undefined,
          }
        : undefined,
      usage: v3Result.usage,
    };
  }
}

/**
 * Safely casts V3 provider metadata to V2 format.
 *
 * This cast is safe because SAP AI Core implementation guarantees that
 * provider metadata never contains undefined values (verified in V2_ADAPTER_VERIFICATION.md).
 *
 * V3 type: Record<string, JSONObject> where JSONObject allows undefined
 * V2 type: Record<string, Record<string, JSONValue>> where undefined is not allowed
 * @param v3Metadata - V3 provider metadata
 * @returns V2-compatible provider metadata
 * @internal
 */
function castProviderMetadataV3ToV2(
  v3Metadata: SharedV3ProviderMetadata | undefined,
): SharedV2ProviderMetadata | undefined {
  // Safe cast - SAP implementation uses conditional spreads to avoid undefined values
  return v3Metadata as SharedV2ProviderMetadata | undefined;
}
