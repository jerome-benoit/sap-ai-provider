/** Base class for embedding model strategies using the Template Method pattern. */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelAPIStrategy, EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { deepMerge } from "./deep-merge.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import {
  buildEmbeddingResult,
  type EmbeddingProviderOptions,
  type EmbeddingType,
  prepareEmbeddingCall,
  type ResponseMetadata,
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

    try {
      const { embeddingOptions, providerName } = await prepareEmbeddingCall(
        { maxEmbeddingsPerCall, modelId: config.modelId, provider: config.provider },
        options,
      );

      const embeddingType = embeddingOptions?.type ?? settings.type ?? "text";

      const warnings: SharedV3Warning[] = [];
      this.resolveWarnings(settings, warnings);

      const client = this.createClient(config, settings, embeddingOptions);

      const response = await this.executeCall(client, values, embeddingType, abortSignal);

      const embeddings = this.extractEmbeddings(response);
      const totalTokens = this.extractTokenCount(response);
      const { headers: responseHeaders, requestId } = this.extractResponseMetadata(response);

      return buildEmbeddingResult({
        embeddings,
        modelId: config.modelId,
        providerName,
        requestId,
        responseHeaders,
        totalTokens,
        version: VERSION,
        warnings,
      });
    } catch (error) {
      if (error instanceof TooManyEmbeddingValuesForCallError) {
        throw error;
      }
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
   * Extracts response metadata (request id and HTTP headers) from the SDK response.
   *
   * Default returns both fields as `undefined`. Subclasses override to lift the
   * underlying `HttpResponse` via `extractResponseMetadata` from `strategy-utils`,
   * passing the SDK-specific field name (`rawResponse` for foundation-models,
   * `response` for orchestration).
   * @param _response - SDK response.
   * @returns Combined `{ headers, requestId }` metadata.
   * @internal
   */
  protected extractResponseMetadata(_response: TResponse): ResponseMetadata {
    return { headers: undefined, requestId: undefined };
  }

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

  protected mergeModelParams(
    settings: SAPAIEmbeddingSettings,
    embeddingOptions: EmbeddingProviderOptions | undefined,
  ): Record<string, unknown> {
    return deepMerge(
      (settings.modelParams as Record<string, unknown> | undefined) ?? {},
      embeddingOptions?.modelParams ?? {},
    );
  }

  /**
   * Pushes API-specific deprecation or migration warnings into the shared
   * sink. Default no-op; subclasses override to surface settings-level
   * warnings (e.g. orchestration's masking_providers deprecation).
   * @param _settings - Embedding model settings.
   * @param _warnings - Shared warnings sink for the current call.
   * @internal
   */
  protected resolveWarnings(_settings: SAPAIEmbeddingSettings, _warnings: SharedV3Warning[]): void {
    return;
  }
}
