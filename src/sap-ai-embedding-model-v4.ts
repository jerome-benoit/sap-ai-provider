/**
 * SAP AI Embedding Model V4 - Vercel AI SDK EmbeddingModelV4 implementation for SAP AI Core.
 *
 * Wraps the internal V3 embedding model; V4 results use the same
 * `{ tokens: number }` usage shape and warning variants.
 */

import type {
  EmbeddingModelV4,
  EmbeddingModelV4CallOptions,
  EmbeddingModelV4Result,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { SAPAIApiType, SAPAIEmbeddingSettings } from "./sap-ai-settings.js";

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

  doEmbed(options: EmbeddingModelV4CallOptions): Promise<EmbeddingModelV4Result> {
    return this.internalModel.doEmbed(options);
  }
}
