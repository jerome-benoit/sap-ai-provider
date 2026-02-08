/**
 * SAP AI Embedding Model - Vercel AI SDK EmbeddingModelV3 implementation for SAP AI Core.
 *
 * This module provides the embedding model implementation that connects to SAP AI Core
 * services (Orchestration API or Foundation Models API) to generate vector embeddings.
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/embed | Vercel AI SDK embed()}
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/embed-many | Vercel AI SDK embedMany()}
 */
import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { SAPAIApiType, SAPAIEmbeddingSettings } from "./sap-ai-settings.js";

import {
  getProviderName,
  sapAIEmbeddingProviderOptions,
  validateEmbeddingModelParamsSettings,
} from "./sap-ai-provider-options.js";
import {
  type EmbeddingModelStrategyConfig,
  getOrCreateEmbeddingModelStrategy,
} from "./sap-ai-strategy.js";
import { resolveApi, validateSettings } from "./sap-ai-validation.js";

const DEFAULT_MAX_EMBEDDINGS_PER_CALL = 2048;

/**
 * Model identifier for SAP AI embedding models.
 *
 * Common embedding model IDs include:
 * - `"text-embedding-3-small"` - OpenAI small embedding model (recommended)
 * - `"text-embedding-3-large"` - OpenAI large embedding model
 *
 * The actual available models depend on your SAP AI Core deployment configuration.
 * @see {@link https://help.sap.com/docs/sap-ai-core | SAP AI Core Documentation}
 */
export type SAPAIEmbeddingModelId = string;

/** @internal */
interface SAPAIEmbeddingModelConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Core Embedding Model implementing Vercel AI SDK EmbeddingModelV3.
 *
 * This class provides embedding generation capabilities through SAP AI Core,
 * supporting both the Orchestration API and Foundation Models API.
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * {@link createSAPAIProvider} factory function:
 * @example
 * ```typescript
 * import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
 * import { embed, embedMany } from "ai";
 *
 * const provider = createSAPAIProvider();
 * const embeddingModel = provider.embedding("text-embedding-3-small");
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
export class SAPAIEmbeddingModel implements EmbeddingModelV3 {
  readonly maxEmbeddingsPerCall: number;
  readonly modelId: string;
  readonly provider: string;
  readonly specificationVersion = "v3" as const;
  readonly supportsParallelCalls: boolean = true;

  private readonly config: SAPAIEmbeddingModelConfig;
  private readonly settings: SAPAIEmbeddingSettings;

  /**
   * @param modelId - Model identifier.
   * @param settings - Model settings.
   * @param config - Model configuration.
   * @internal
   */
  constructor(
    modelId: SAPAIEmbeddingModelId,
    settings: SAPAIEmbeddingSettings = {},
    config: SAPAIEmbeddingModelConfig,
  ) {
    if (settings.modelParams) {
      validateEmbeddingModelParamsSettings(settings.modelParams);
    }
    this.modelId = modelId;
    this.settings = settings;
    this.config = config;
    this.provider = config.provider;
    this.maxEmbeddingsPerCall = settings.maxEmbeddingsPerCall ?? DEFAULT_MAX_EMBEDDINGS_PER_CALL;
  }

  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    const providerName = getProviderName(this.config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAIEmbeddingProviderOptions,
    });

    const effectiveApi = resolveApi(this.config.providerApi, this.settings.api, sapOptions?.api);

    validateSettings({
      api: effectiveApi,
      embeddingSettings: this.settings,
      invocationSettings: sapOptions ? { api: sapOptions.api } : undefined,
      modelApi: this.settings.api,
    });

    const strategy = await getOrCreateEmbeddingModelStrategy(effectiveApi);

    const strategyConfig: EmbeddingModelStrategyConfig = {
      deploymentConfig: this.config.deploymentConfig,
      destination: this.config.destination,
      modelId: this.modelId,
      provider: this.config.provider,
    };

    return strategy.doEmbed(strategyConfig, this.settings, options, this.maxEmbeddingsPerCall);
  }
}
