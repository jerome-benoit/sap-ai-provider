/**
 * Orchestration Embedding Model Strategy - Implementation using `@sap-ai-sdk/orchestration`.
 *
 * This strategy is stateless - it holds only a reference to the OrchestrationEmbeddingClient class.
 * All tenant-specific configuration flows through method parameters for security.
 */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import type { EmbeddingModelConfig, OrchestrationEmbeddingClient } from "@sap-ai-sdk/orchestration";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelAPIStrategy, EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { deepMerge } from "./deep-merge.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import { getProviderName, sapAIEmbeddingProviderOptions } from "./sap-ai-provider-options.js";
import { normalizeEmbedding } from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * Type for the OrchestrationEmbeddingClient class constructor.
 * @internal
 */
type OrchestrationEmbeddingClientClass = typeof OrchestrationEmbeddingClient;

/**
 * Orchestration Embedding Model Strategy.
 *
 * Implements embedding operations using the SAP AI SDK Orchestration API.
 * This class is stateless - it only holds a reference to the OrchestrationEmbeddingClient class.
 * @internal
 */
export class OrchestrationEmbeddingModelStrategy implements EmbeddingModelAPIStrategy {
  private readonly ClientClass: OrchestrationEmbeddingClientClass;

  /**
   * Creates a new OrchestrationEmbeddingModelStrategy.
   * @param ClientClass - The OrchestrationEmbeddingClient class from `@sap-ai-sdk/orchestration`.
   */
  constructor(ClientClass: OrchestrationEmbeddingClientClass) {
    this.ClientClass = ClientClass;
  }

  /**
   * Generates embeddings for the given input values.
   *
   * Validates input count, merges settings, calls SAP AI SDK, and normalizes embeddings.
   * @param config - The embedding model strategy configuration.
   * @param settings - The SAP AI embedding settings.
   * @param options - The Vercel AI SDK embedding call options.
   * @param maxEmbeddingsPerCall - Maximum number of embeddings allowed per call.
   * @returns A Promise resolving to the embedding result.
   * @throws {TooManyEmbeddingValuesForCallError} If values exceed maxEmbeddingsPerCall.
   * @throws {AISDKError} If the SAP AI SDK call fails.
   */
  async doEmbed(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    options: EmbeddingModelV3CallOptions,
    maxEmbeddingsPerCall: number,
  ): Promise<EmbeddingModelV3Result> {
    const { abortSignal, providerOptions, values } = options;

    const providerName = getProviderName(config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions,
      schema: sapAIEmbeddingProviderOptions,
    });

    if (values.length > maxEmbeddingsPerCall) {
      throw new TooManyEmbeddingValuesForCallError({
        maxEmbeddingsPerCall,
        modelId: config.modelId,
        provider: config.provider,
        values,
      });
    }

    const embeddingType = sapOptions?.type ?? settings.type ?? "text";

    try {
      const client = this.createClient(
        config,
        settings.modelParams as Record<string, unknown> | undefined,
        sapOptions?.modelParams,
      );

      const response = await client.embed(
        { input: values, type: embeddingType },
        abortSignal ? { signal: abortSignal } : undefined,
      );

      const embeddingData = response.getEmbeddings();
      const tokenUsage = response.getTokenUsage();
      const sortedEmbeddings = [...embeddingData].sort((a, b) => a.index - b.index);

      const embeddings: EmbeddingModelV3Embedding[] = sortedEmbeddings.map((data) =>
        normalizeEmbedding(data.embedding),
      );

      const providerMetadata: SharedV3ProviderMetadata = {
        [providerName]: {
          model: config.modelId,
          version: VERSION,
        },
      };

      return {
        embeddings,
        providerMetadata,
        usage: { tokens: tokenUsage.total_tokens },
        warnings: [],
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doEmbed",
        requestBody: { values: values.length },
        url: "sap-ai:orchestration/embeddings",
      });
    }
  }

  /**
   * Creates an SAP AI SDK OrchestrationEmbeddingClient with merged configuration.
   * @param config - The embedding model strategy configuration.
   * @param settingsModelParams - Model parameters from settings.
   * @param perCallModelParams - Per-call model parameters to merge with settings.
   * @returns A configured SAP AI SDK embedding client instance.
   * @internal
   */
  private createClient(
    config: EmbeddingModelStrategyConfig,
    settingsModelParams?: Record<string, unknown>,
    perCallModelParams?: Record<string, unknown>,
  ): OrchestrationEmbeddingClient {
    const mergedParams = deepMerge(settingsModelParams ?? {}, perCallModelParams ?? {});
    const hasParams = Object.keys(mergedParams).length > 0;

    const embeddingConfig: EmbeddingModelConfig = {
      model: {
        name: config.modelId,
        ...(hasParams ? { params: mergedParams } : {}),
      },
    };

    return new this.ClientClass(
      { embeddings: embeddingConfig },
      config.deploymentConfig,
      config.destination,
    );
  }
}
