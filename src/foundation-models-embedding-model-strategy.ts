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
 * Request context passed from createClient to executeCall.
 * FM = Foundation Models API.
 * @internal
 */
interface FMEmbeddingRequestContext {
  embeddingOptions: EmbeddingProviderOptions | undefined;
  settings: SAPAIEmbeddingSettings;
}

/** @internal */
type FoundationModelsEmbeddingClientClass = typeof AzureOpenAiEmbeddingClient;

/**
 * Embedding model strategy for the Foundation Models API.
 *
 * Provides direct access to Azure OpenAI embedding models.
 * @internal
 */
export class FoundationModelsEmbeddingModelStrategy extends BaseEmbeddingModelStrategy<
  AzureOpenAiEmbeddingClient,
  AzureOpenAiEmbeddingResponse
> {
  private readonly ClientClass: FoundationModelsEmbeddingClientClass;
  private requestContext: FMEmbeddingRequestContext | undefined;

  constructor(ClientClass: FoundationModelsEmbeddingClientClass) {
    super();
    this.ClientClass = ClientClass;
  }

  protected createClient(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    embeddingOptions: EmbeddingProviderOptions | undefined,
  ): AzureOpenAiEmbeddingClient {
    this.requestContext = { embeddingOptions, settings };
    return new this.ClientClass(
      buildModelDeployment(config, settings.modelVersion),
      config.destination,
    );
  }

  protected async executeCall(
    client: AzureOpenAiEmbeddingClient,
    values: string[],
    _embeddingType: unknown,
    abortSignal: AbortSignal | undefined,
  ): Promise<AzureOpenAiEmbeddingResponse> {
    const request = this.buildRequest(values, this.requestContext);
    return client.run(request, abortSignal ? { signal: abortSignal } : undefined);
  }

  protected extractEmbeddings(response: AzureOpenAiEmbeddingResponse): EmbeddingModelV3Embedding[] {
    // SDK types include `& Record<string, any>` which requires explicit extraction
    const embeddingData = response._data.data;
    const sortedEmbeddings = embeddingData.slice().sort((a, b) => a.index - b.index);
    return sortedEmbeddings.map((item) => normalizeEmbedding(item.embedding as number[]));
  }

  protected extractTokenCount(response: AzureOpenAiEmbeddingResponse): number {
    return response._data.usage.total_tokens;
  }

  protected getUrl(): string {
    return "sap-ai:foundation-models/embeddings";
  }

  private buildRequest(
    values: string[],
    context: FMEmbeddingRequestContext | undefined,
  ): AzureOpenAiEmbeddingParameters {
    const mergedParams = deepMerge(
      (context?.settings.modelParams as Record<string, unknown> | undefined) ?? {},
      context?.embeddingOptions?.modelParams ?? {},
    );

    return {
      input: values,
      ...(hasKeys(mergedParams) ? mergedParams : {}),
    } as AzureOpenAiEmbeddingParameters;
  }
}
