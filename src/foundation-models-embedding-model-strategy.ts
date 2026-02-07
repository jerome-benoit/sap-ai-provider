/** Foundation Models embedding model strategy using `@sap-ai-sdk/foundation-models`. */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
} from "@ai-sdk/provider";
import type {
  AzureOpenAiEmbeddingClient,
  AzureOpenAiEmbeddingParameters,
} from "@sap-ai-sdk/foundation-models";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelAPIStrategy, EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { deepMerge } from "./deep-merge.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import {
  buildEmbeddingResult,
  buildModelDeployment,
  hasKeys,
  normalizeEmbedding,
  prepareEmbeddingCall,
} from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * @internal
 */
type AzureOpenAiEmbeddingClientClass = typeof AzureOpenAiEmbeddingClient;

/**
 * @internal
 */
export class FoundationModelsEmbeddingModelStrategy implements EmbeddingModelAPIStrategy {
  private readonly ClientClass: AzureOpenAiEmbeddingClientClass;

  constructor(ClientClass: AzureOpenAiEmbeddingClientClass) {
    this.ClientClass = ClientClass;
  }

  async doEmbed(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    options: EmbeddingModelV3CallOptions,
    maxEmbeddingsPerCall: number,
  ): Promise<EmbeddingModelV3Result> {
    const { abortSignal, values } = options;

    const { embeddingOptions, providerName } = await prepareEmbeddingCall(
      { maxEmbeddingsPerCall, modelId: config.modelId, provider: config.provider },
      options,
    );

    try {
      const client = this.createClient(config, settings.modelVersion);
      const request = this.buildRequest(values, settings, embeddingOptions);
      const response = await client.run(request, abortSignal ? { signal: abortSignal } : undefined);

      const embeddingData = response.getEmbeddings();
      const tokenUsage = response._data.usage;
      const embeddings: EmbeddingModelV3Embedding[] = embeddingData.map((embedding) =>
        normalizeEmbedding(embedding),
      );

      return buildEmbeddingResult({
        embeddings,
        modelId: config.modelId,
        providerName,
        totalTokens: tokenUsage.total_tokens,
        version: VERSION,
      });
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doEmbed",
        requestBody: { values: values.length },
        url: "sap-ai:foundation-models/embeddings",
      });
    }
  }

  private buildRequest(
    values: string[],
    settings: SAPAIEmbeddingSettings,
    embeddingOptions: undefined | { modelParams?: Record<string, unknown> },
  ): AzureOpenAiEmbeddingParameters {
    const mergedParams = deepMerge(
      settings.modelParams as Record<string, unknown> | undefined,
      embeddingOptions?.modelParams,
    );

    return {
      input: values,
      ...(hasKeys(mergedParams) ? mergedParams : {}),
    } as AzureOpenAiEmbeddingParameters;
  }

  private createClient(
    config: EmbeddingModelStrategyConfig,
    modelVersion?: string,
  ): InstanceType<AzureOpenAiEmbeddingClientClass> {
    const modelDeployment = buildModelDeployment(config, modelVersion);
    return new this.ClientClass(modelDeployment, config.destination);
  }
}
