/** Base class for embedding model strategies using the Template Method pattern. */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
} from "@ai-sdk/provider";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelAPIStrategy, EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToAISDKError } from "./sap-ai-error.js";
import {
  buildEmbeddingResult,
  type EmbeddingProviderOptions,
  type EmbeddingType,
  prepareEmbeddingCall,
} from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * Abstract base class for embedding model strategies using the Template Method pattern.
 * @template TClient - The SDK client type (e.g., AzureOpenAiEmbeddingClient, OrchestrationEmbeddingClient).
 * @template TResponse - The API response type from the SDK client.
 * @internal
 */
export abstract class BaseEmbeddingModelStrategy<
  TClient,
  TResponse,
> implements EmbeddingModelAPIStrategy {
  /**
   * Template method implementing the shared embedding algorithm.
   * @param config - Strategy configuration.
   * @param settings - Embedding model settings.
   * @param options - AI SDK call options.
   * @param maxEmbeddingsPerCall - Maximum embeddings per call.
   * @returns Complete embedding result for AI SDK.
   * @internal
   */
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

    const embeddingType =
      embeddingOptions?.type ?? (settings.type as EmbeddingType | undefined) ?? "text";

    try {
      const client = this.createClient(config, settings, embeddingOptions);

      const response = await this.executeCall(client, values, embeddingType, abortSignal);

      const embeddings = this.extractEmbeddings(response);
      const totalTokens = this.extractTokenCount(response);

      return buildEmbeddingResult({
        embeddings,
        modelId: config.modelId,
        providerName,
        totalTokens,
        version: VERSION,
      });
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doEmbed",
        requestBody: { values: values.length },
        url: this.getUrl(),
      });
    }
  }

  /**
   * Creates the appropriate SDK client for this API.
   * @param config - Strategy configuration.
   * @param settings - Embedding model settings.
   * @param embeddingOptions - Parsed provider options from the call.
   * @returns SDK client instance.
   * @internal
   */
  protected abstract createClient(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    embeddingOptions: EmbeddingProviderOptions | undefined,
  ): TClient;

  /**
   * Executes the embedding API call.
   * @param client - SDK client instance.
   * @param values - Input strings to embed.
   * @param embeddingType - Type of embedding (text, query, document).
   * @param abortSignal - Optional abort signal.
   * @returns SDK response containing embeddings.
   * @internal
   */
  protected abstract executeCall(
    client: TClient,
    values: string[],
    embeddingType: EmbeddingType,
    abortSignal: AbortSignal | undefined,
  ): Promise<TResponse>;

  /**
   * Extracts embeddings from the SDK response.
   * @param response - SDK response containing embedding data.
   * @returns Array of normalized embedding vectors.
   * @internal
   */
  protected abstract extractEmbeddings(response: TResponse): EmbeddingModelV3Embedding[];

  /**
   * Extracts total token count from the SDK response.
   * @param response - SDK response containing usage data.
   * @returns Total token count used for the embedding request.
   * @internal
   */
  protected abstract extractTokenCount(response: TResponse): number;

  /**
   * Returns the URL identifier for this API (used in error messages).
   * @returns URL string identifier.
   * @internal
   */
  protected abstract getUrl(): string;
}
