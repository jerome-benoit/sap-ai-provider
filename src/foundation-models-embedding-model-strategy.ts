/** Foundation Models embedding model strategy using `@sap-ai-sdk/foundation-models`. */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import type {
  AzureOpenAiEmbeddingClient,
  AzureOpenAiEmbeddingParameters,
} from "@sap-ai-sdk/foundation-models";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelAPIStrategy, EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { deepMerge } from "./deep-merge.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import { getProviderName, sapAIEmbeddingProviderOptions } from "./sap-ai-provider-options.js";
import { buildModelDeployment, normalizeEmbedding } from "./strategy-utils.js";
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

    try {
      const client = this.createClient(config, settings.modelVersion);
      const request = this.buildRequest(values, settings, sapOptions);
      const response = await client.run(request, abortSignal ? { signal: abortSignal } : undefined);

      const embeddingData = response.getEmbeddings();
      const tokenUsage = response._data.usage;
      const embeddings: EmbeddingModelV3Embedding[] = embeddingData.map((embedding) =>
        normalizeEmbedding(embedding),
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
        url: "sap-ai:foundation-models/embeddings",
      });
    }
  }

  private buildRequest(
    values: string[],
    settings: SAPAIEmbeddingSettings,
    sapOptions: undefined | { modelParams?: Record<string, unknown> },
  ): AzureOpenAiEmbeddingParameters {
    const mergedParams = deepMerge(
      settings.modelParams as Record<string, unknown> | undefined,
      sapOptions?.modelParams,
    );

    return {
      input: values,
      ...(Object.keys(mergedParams).length > 0 ? mergedParams : {}),
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
