/** Foundation Models embedding model strategy using `@sap-ai-sdk/foundation-models`. */
import type { EmbeddingModelV3Embedding } from "@ai-sdk/provider";
import type {
  AzureOpenAiEmbeddingClient,
  AzureOpenAiEmbeddingParameters,
  AzureOpenAiEmbeddingResponse,
} from "@sap-ai-sdk/foundation-models";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";
import type { EmbeddingProviderOptions } from "./strategy-utils.js";

import { BaseEmbeddingModelStrategy } from "./base-embedding-model-strategy.js";
import { deepMerge } from "./deep-merge.js";
import { buildModelDeployment, hasKeys, normalizeEmbedding } from "./strategy-utils.js";

/**
 * @internal
 */
type AzureOpenAiEmbeddingClientClass = typeof AzureOpenAiEmbeddingClient;

/**
 * Language model strategy for the Foundation Models API.
 *
 * Extends `BaseEmbeddingModelStrategy` to provide Foundation Models-specific implementations
 * for the Template Method pattern.
 * @internal
 */
export class FoundationModelsEmbeddingModelStrategy extends BaseEmbeddingModelStrategy<
  AzureOpenAiEmbeddingClient,
  AzureOpenAiEmbeddingResponse
> {
  private readonly ClientClass: AzureOpenAiEmbeddingClientClass;
  private embeddingOptions: EmbeddingProviderOptions | undefined;
  private modelId = "";
  private settings: SAPAIEmbeddingSettings | undefined;

  constructor(ClientClass: AzureOpenAiEmbeddingClientClass) {
    super();
    this.ClientClass = ClientClass;
  }

  protected createClient(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    embeddingOptions: EmbeddingProviderOptions | undefined,
  ): AzureOpenAiEmbeddingClient {
    this.modelId = config.modelId;
    this.settings = settings;
    this.embeddingOptions = embeddingOptions;
    return new this.ClientClass(
      buildModelDeployment(config, settings.modelVersion),
      config.destination,
    );
  }

  protected async executeCall(
    client: AzureOpenAiEmbeddingClient,
    values: string[],
    embeddingType: unknown,
    abortSignal: AbortSignal | undefined,
  ): Promise<AzureOpenAiEmbeddingResponse> {
    const request = this.buildRequest(values, this.settings, this.embeddingOptions);
    return client.run(request, abortSignal ? { signal: abortSignal } : undefined);
  }

  protected extractEmbeddings(response: AzureOpenAiEmbeddingResponse): EmbeddingModelV3Embedding[] {
    const embeddingData = response.getEmbeddings();
    return embeddingData.map((embedding) => normalizeEmbedding(embedding));
  }

  protected extractTokenCount(response: AzureOpenAiEmbeddingResponse): number {
    return response._data.usage.total_tokens;
  }

  protected getModelId(): string {
    return this.modelId;
  }

  protected getUrl(): string {
    return "sap-ai:foundation-models/embeddings";
  }

  private buildRequest(
    values: string[],
    settings: SAPAIEmbeddingSettings | undefined,
    embeddingOptions: EmbeddingProviderOptions | undefined,
  ): AzureOpenAiEmbeddingParameters {
    const mergedParams = deepMerge(
      settings?.modelParams as Record<string, unknown> | undefined,
      embeddingOptions?.modelParams,
    );

    return {
      input: values,
      ...(hasKeys(mergedParams) ? mergedParams : {}),
    } as AzureOpenAiEmbeddingParameters;
  }
}
