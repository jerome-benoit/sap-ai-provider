/**
 * SAP AI Embedding Model - Vercel AI SDK EmbeddingModelV3 implementation for SAP AI Core.
 *
 * This is a thin wrapper that delegates to API-specific strategies (Orchestration or Foundation Models).
 * Strategy selection happens at invocation time using the late-binding pattern.
 * @module sap-ai-embedding-model
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
// Note: SAPAIEmbeddingSettings is also re-exported below for backward compatibility
import {
  type EmbeddingModelStrategyConfig,
  getOrCreateEmbeddingModelStrategy,
} from "./sap-ai-strategy.js";
import { resolveApi, validateSettings } from "./sap-ai-validation.js";

/** Default maximum embeddings per API call (OpenAI limit). */
const DEFAULT_MAX_EMBEDDINGS_PER_CALL = 2048;

/** Model identifier for SAP AI embedding models (e.g., 'text-embedding-ada-002'). */
export type SAPAIEmbeddingModelId = string;

// Re-export SAPAIEmbeddingSettings from sap-ai-settings.ts for backward compatibility
export type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";

/**
 * Internal configuration for SAP AI Embedding Model.
 * @internal
 */
interface SAPAIEmbeddingModelConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  /** Provider-level API setting for fallback during API resolution. */
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Core Embedding Model implementing Vercel AI SDK EmbeddingModelV3.
 *
 * This class is a thin wrapper that delegates to API-specific strategies:
 * - Orchestration API: uses OrchestrationEmbeddingClient
 * - Foundation Models API: uses AzureOpenAiEmbeddingClient
 * @example
 * ```typescript
 * const { embedding } = await embed({
 *   model: provider.embedding('text-embedding-ada-002'),
 *   value: 'Hello, world!'
 * });
 * ```
 */
export class SAPAIEmbeddingModel implements EmbeddingModelV3 {
  /** Maximum number of embeddings per API call. */
  readonly maxEmbeddingsPerCall: number;
  /** The model identifier. */
  readonly modelId: string;
  /** The provider identifier string. */
  readonly provider: string;
  /** The Vercel AI SDK specification version. */
  readonly specificationVersion = "v3" as const;
  /** Whether the model supports parallel API calls. */
  readonly supportsParallelCalls: boolean = true;

  private readonly config: SAPAIEmbeddingModelConfig;
  private readonly settings: SAPAIEmbeddingSettings;

  /**
   * Creates a new SAP AI Embedding Model instance.
   *
   * This is the main implementation that handles all SAP AI Core embedding logic.
   * @param modelId - The model identifier (e.g., 'text-embedding-ada-002', 'text-embedding-3-small').
   * @param settings - Model configuration settings (embedding type, model parameters, etc.).
   * @param config - SAP AI Core deployment and destination configuration.
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

  /**
   * Generates embeddings for the given input values.
   *
   * Implements late-binding: resolves API at invocation time, validates settings,
   * gets the appropriate strategy, and delegates the call.
   * @param options - The Vercel AI SDK V3 embedding call options.
   * @returns The embedding result with vectors, usage data, and warnings.
   */
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
      invocationSettings: sapOptions ? { api: sapOptions.api } : undefined,
      modelApi: this.settings.api,
      modelSettings: this.settings.api ? { api: this.settings.api } : undefined,
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
