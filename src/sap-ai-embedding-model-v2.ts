/**
 * SAP AI Embedding Model V2 - Vercel AI SDK EmbeddingModelV2 facade for SAP AI Core Orchestration.
 *
 * This is a facade that delegates to the V3 implementation and transforms responses to V2 format.
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

import type { SAPAIApiType, SAPAIEmbeddingSettings } from "./sap-ai-settings.js";

import { convertWarningsV3ToV2 } from "./sap-ai-adapters-v3-to-v2.js";
import { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";

/**
 * Internal configuration for SAP AI Embedding Model V2.
 * @internal
 */
interface SAPAIEmbeddingModelV2Config {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  /** Provider-level API setting for fallback during API resolution. */
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Embedding Model V2 implementing Vercel AI SDK EmbeddingModelV2.
 *
 * Facade delegating to V3 implementation with V2 format transformation.
 * Features: text embedding generation, multiple embedding types, parallel batch processing.
 * Supports: Azure OpenAI embeddings, other embedding models available in SAP AI Core.
 */
export class SAPAIEmbeddingModelV2 implements EmbeddingModelV2<string> {
  /** Maximum number of embeddings per API call. */
  readonly maxEmbeddingsPerCall: number;
  /** The model identifier. */
  readonly modelId: string;
  /** The provider identifier string. */
  readonly provider: string;
  /** The Vercel AI SDK specification version. */
  readonly specificationVersion = "v2" as const;
  /** Whether the model supports parallel API calls. */
  readonly supportsParallelCalls: boolean;

  /** Internal V3 model instance that handles all SAP AI Core logic. */
  private readonly v3Model: SAPAIEmbeddingModel;

  /**
   * Creates a new SAP AI Embedding Model V2 instance.
   *
   * This constructor creates a V3 implementation internally and delegates all operations to it.
   * @param modelId - The model identifier (e.g., 'text-embedding-ada-002', 'text-embedding-3-small').
   * @param settings - Model configuration settings (embedding type, model parameters, etc.).
   * @param config - SAP AI Core deployment and destination configuration.
   * @internal
   */
  constructor(
    modelId: string,
    settings: SAPAIEmbeddingSettings,
    config: SAPAIEmbeddingModelV2Config,
  ) {
    this.v3Model = new SAPAIEmbeddingModel(modelId, settings, config);
    this.provider = this.v3Model.provider;
    this.modelId = this.v3Model.modelId;
    this.maxEmbeddingsPerCall = this.v3Model.maxEmbeddingsPerCall;
    this.supportsParallelCalls = this.v3Model.supportsParallelCalls;
  }

  /**
   * Generates embeddings for the given text values.
   *
   * Delegates to V3 implementation and transforms the result to V2 format.
   * Warnings are logged to console instead of being returned (V2 API limitation).
   * @param options - The embedding generation options.
   * @param options.abortSignal - Optional abort signal to cancel the request.
   * @param options.headers - Optional HTTP headers to include in the request.
   * @param options.providerOptions - Optional provider-specific options.
   * @param options.values - The text values to generate embeddings for.
   * @returns The embedding result with vectors, usage, and provider metadata.
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
 * Casts V3 provider metadata to V2 format.
 * @param v3Metadata - The V3 provider metadata to cast.
 * @returns The V2 provider metadata or undefined.
 * @internal
 */
function castProviderMetadataV3ToV2(
  v3Metadata: SharedV3ProviderMetadata | undefined,
): SharedV2ProviderMetadata | undefined {
  // Safe cast - SAP implementation uses conditional spreads to avoid undefined values
  return v3Metadata as SharedV2ProviderMetadata | undefined;
}
