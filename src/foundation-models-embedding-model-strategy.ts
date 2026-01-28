/**
 * Foundation Models Embedding Model Strategy - Implementation using `@sap-ai-sdk/foundation-models`.
 *
 * This strategy is stateless - it holds only a reference to the AzureOpenAiEmbeddingClient class.
 * All tenant-specific configuration flows through method parameters for security.
 */
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

import type { FoundationModelsEmbeddingParams, SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelAPIStrategy, EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToAISDKError } from "./sap-ai-error.js";
import { getProviderName, sapAIEmbeddingProviderOptions } from "./sap-ai-provider-options.js";
import { buildModelDeployment, normalizeEmbedding } from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * Type for the AzureOpenAiEmbeddingClient class constructor.
 * @internal
 */
type AzureOpenAiEmbeddingClientClass = typeof AzureOpenAiEmbeddingClient;

/**
 * Foundation Models Embedding Model Strategy.
 *
 * Implements embedding operations using the SAP AI SDK Foundation Models API.
 * This class is stateless - it only holds a reference to the AzureOpenAiEmbeddingClient class.
 * @internal
 */
export class FoundationModelsEmbeddingModelStrategy implements EmbeddingModelAPIStrategy {
  private readonly ClientClass: AzureOpenAiEmbeddingClientClass;

  /**
   * Creates a new FoundationModelsEmbeddingModelStrategy.
   * @param ClientClass - The AzureOpenAiEmbeddingClient class from `@sap-ai-sdk/foundation-models`.
   */
  constructor(ClientClass: AzureOpenAiEmbeddingClientClass) {
    this.ClientClass = ClientClass;
  }

  /**
   * Generates embeddings for the given input values.
   *
   * Validates input count, builds request, calls SAP AI SDK, and normalizes embeddings.
   * @param config - The strategy configuration containing model and deployment info.
   * @param settings - The embedding model settings.
   * @param options - The call options including values to embed and abort signal.
   * @param maxEmbeddingsPerCall - Maximum number of embeddings allowed per call.
   * @returns The embedding result with vectors, usage, and metadata.
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

    try {
      const client = this.createClient(config);
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

  /**
   * Builds the embedding request parameters.
   * @param values - The input strings to embed.
   * @param settings - The embedding model settings.
   * @param settings.modelParams - Model-specific parameters from settings.
   * @param sapOptions - Provider options from the call.
   * @returns The Azure OpenAI embedding parameters.
   * @internal
   */
  private buildRequest(
    values: string[],
    settings: SAPAIEmbeddingSettings,
    sapOptions: undefined | { modelParams?: Record<string, unknown> },
  ): AzureOpenAiEmbeddingParameters {
    const request: AzureOpenAiEmbeddingParameters = {
      input: values,
    };

    const modelParams = settings.modelParams as FoundationModelsEmbeddingParams | undefined;
    if (modelParams) {
      if (modelParams.user !== undefined) {
        request.user = modelParams.user;
      }
      if (modelParams.encoding_format !== undefined) {
        request.encoding_format = modelParams.encoding_format;
      }
      if (modelParams.dimensions !== undefined) {
        request.dimensions = modelParams.dimensions;
      }
    }

    if (sapOptions?.modelParams) {
      const callParams = sapOptions.modelParams;
      if (callParams.user !== undefined) {
        request.user = callParams.user as string;
      }
      if (callParams.input_type !== undefined) {
        request.input_type = callParams.input_type as string;
      }
      if (callParams.encoding_format !== undefined) {
        request.encoding_format = callParams.encoding_format as string;
      }
      if (callParams.dimensions !== undefined) {
        request.dimensions = callParams.dimensions as number;
      }
    }

    return request;
  }

  /**
   * Creates an SAP AI SDK AzureOpenAiEmbeddingClient with the given configuration.
   * @param config - The strategy configuration containing deployment info.
   * @returns A new AzureOpenAiEmbeddingClient instance.
   * @internal
   */
  private createClient(
    config: EmbeddingModelStrategyConfig,
  ): InstanceType<AzureOpenAiEmbeddingClientClass> {
    const modelDeployment = buildModelDeployment(config);
    return new this.ClientClass(modelDeployment, config.destination);
  }
}
