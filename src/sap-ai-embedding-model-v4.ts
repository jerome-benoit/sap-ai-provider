/**
 * SAP AI Embedding Model V4 - Vercel AI SDK EmbeddingModelV4 implementation for SAP AI Core.
 *
 * Wraps the internal V3 embedding model; V4 results use the identical
 * nested usage shape and native warning passthrough.
 */

import type {
  EmbeddingModelV4,
  EmbeddingModelV4CallOptions,
  EmbeddingModelV4Result,
  SharedV4ProviderMetadata,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { SAPAIApiType, SAPAIEmbeddingSettings } from "./sap-ai-settings.js";

import { convertProviderMetadataToV4 } from "./sap-ai-adapters-v3-to-v4.js";
import {
  type SAPAIEmbeddingModelId,
  SAPAIEmbeddingModel as SAPAIEmbeddingModelInternal,
} from "./sap-ai-embedding-model.js";

/** @internal */
interface SAPAIEmbeddingModelV4Config {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
  readonly requestConfig?: CustomRequestConfig;
}

/**
 * SAP AI Core Embedding Model implementing Vercel AI SDK EmbeddingModelV4.
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * V4 provider factory.
 */
export class SAPAIEmbeddingModelV4 implements EmbeddingModelV4 {
  readonly maxEmbeddingsPerCall: number;
  readonly modelId: string;
  readonly provider: string;
  readonly specificationVersion = "v4" as const;
  readonly supportsParallelCalls: boolean = true;

  /** @internal */
  private readonly internalModel: SAPAIEmbeddingModelInternal;

  /**
   * @param modelId - Model identifier.
   * @param settings - Model settings.
   * @param config - Model configuration.
   * @internal
   */
  constructor(
    modelId: SAPAIEmbeddingModelId,
    settings: SAPAIEmbeddingSettings,
    config: SAPAIEmbeddingModelV4Config,
  ) {
    this.internalModel = new SAPAIEmbeddingModelInternal(modelId, settings, config);
    this.provider = this.internalModel.provider;
    this.modelId = this.internalModel.modelId;
    this.maxEmbeddingsPerCall = this.internalModel.maxEmbeddingsPerCall;
    this.supportsParallelCalls = this.internalModel.supportsParallelCalls;
  }

  async doEmbed(options: EmbeddingModelV4CallOptions): Promise<EmbeddingModelV4Result> {
    const result = await this.internalModel.doEmbed({
      abortSignal: options.abortSignal,
      headers: options.headers,
      providerOptions: options.providerOptions,
      values: options.values,
    });

    const providerMetadata: SharedV4ProviderMetadata | undefined = convertProviderMetadataToV4(
      result.providerMetadata,
    );

    return {
      embeddings: result.embeddings,
      providerMetadata,
      response: result.response
        ? {
            body: result.response.body,
            headers: result.response.headers,
          }
        : undefined,
      usage: result.usage,
      warnings: result.warnings,
    };
  }
}
