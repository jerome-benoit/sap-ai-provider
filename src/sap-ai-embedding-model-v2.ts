/**
 * SAP AI Embedding Model V2 - Vercel AI SDK EmbeddingModelV2 implementation for SAP AI Core.
 *
 * This module provides the embedding model implementation that connects to SAP AI Core
 * services (Orchestration API or Foundation Models API) to generate vector embeddings.
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/embed | Vercel AI SDK embed()}
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/embed-many | Vercel AI SDK embedMany()}
 */

import type {
  EmbeddingModelV2,
  EmbeddingModelV3CallOptions as InternalCallOptions,
  SharedV3ProviderMetadata as InternalProviderMetadata,
  SharedV2Headers,
  SharedV2ProviderMetadata,
  SharedV2ProviderOptions,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { SAPAIApiType, SAPAIEmbeddingSettings } from "./sap-ai-settings.js";

import { convertWarningsToV2 } from "./sap-ai-adapters-v3-to-v2.js";
import { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";

/** @internal */
interface SAPAIEmbeddingModelV2Config {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Core Embedding Model implementing Vercel AI SDK EmbeddingModelV2.
 *
 * This class provides embedding generation capabilities through SAP AI Core,
 * supporting both the Orchestration API and Foundation Models API.
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * {@link createSAPAIProvider} factory function:
 * @example
 * ```typescript
 * import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
 * import { embed, embedMany } from "ai";
 *
 * const provider = createSAPAIProvider();
 * const embeddingModel = provider.textEmbeddingModel("text-embedding-3-small");
 *
 * // Single embedding
 * const { embedding } = await embed({
 *   model: embeddingModel,
 *   value: "Hello, world!",
 * });
 *
 * // Multiple embeddings
 * const { embeddings } = await embedMany({
 *   model: embeddingModel,
 *   values: ["Hello", "World"],
 * });
 * ```
 * @see {@link https://sdk.vercel.ai/docs/ai-sdk-core/embeddings | Vercel AI SDK Embeddings}
 * @see {@link createSAPAIProvider} - Factory function to create provider instances
 */
export class SAPAIEmbeddingModelV2 implements EmbeddingModelV2<string> {
  readonly maxEmbeddingsPerCall: number;
  readonly modelId: string;
  readonly provider: string;
  readonly specificationVersion = "v2" as const;
  readonly supportsParallelCalls: boolean = true;

  /** @internal */
  private readonly internalModel: SAPAIEmbeddingModel;

  /**
   * @param modelId - Model identifier.
   * @param settings - Model settings.
   * @param config - Model configuration.
   * @internal
   */
  constructor(
    modelId: string,
    settings: SAPAIEmbeddingSettings,
    config: SAPAIEmbeddingModelV2Config,
  ) {
    this.internalModel = new SAPAIEmbeddingModel(modelId, settings, config);
    this.provider = this.internalModel.provider;
    this.modelId = this.internalModel.modelId;
    this.maxEmbeddingsPerCall = this.internalModel.maxEmbeddingsPerCall;
    this.supportsParallelCalls = this.internalModel.supportsParallelCalls;
  }

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
    // Map options for the internal model call
    const callOptions: InternalCallOptions = {
      abortSignal: options.abortSignal,
      headers: options.headers as Record<string, string> | undefined,
      providerOptions: options.providerOptions,
      values: options.values,
    };
    const result = await this.internalModel.doEmbed(callOptions);

    // Handle any warnings by logging them (V2 API doesn't support returning warnings)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.warnings && result.warnings.length > 0) {
      const warnings = convertWarningsToV2(result.warnings);
      // Log warnings instead of including them in the response
      warnings.forEach((warning) => {
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

    // Return result in V2 format
    return {
      embeddings: result.embeddings,
      providerMetadata: castProviderMetadataToV2(result.providerMetadata),
      response: result.response
        ? {
            body: result.response.body,
            headers: result.response.headers as SharedV2Headers | undefined,
          }
        : undefined,
      usage: result.usage,
    };
  }
}

/**
 * Casts internal provider metadata to V2 format.
 * @param metadata - Internal provider metadata.
 * @returns V2 provider metadata.
 * @internal
 */
function castProviderMetadataToV2(
  metadata: InternalProviderMetadata | undefined,
): SharedV2ProviderMetadata | undefined {
  // Safe cast - SAP implementation uses conditional spreads to avoid undefined values
  return metadata as SharedV2ProviderMetadata | undefined;
}
