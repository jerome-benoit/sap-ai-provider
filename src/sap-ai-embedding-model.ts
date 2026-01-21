/**
 * SAP AI Embedding Model - Vercel AI SDK EmbeddingModelV3 implementation for SAP AI Core.
 *
 * This is the main implementation containing all business logic for SAP AI Core embedding generation.
 * @module sap-ai-embedding-model
 */

import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { EmbeddingModelConfig, EmbeddingModelParams } from "@sap-ai-sdk/orchestration";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { parseProviderOptions } from "@ai-sdk/provider-utils";
import { OrchestrationEmbeddingClient } from "@sap-ai-sdk/orchestration";

import { deepMerge } from "./deep-merge.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import {
  getProviderName,
  sapAIEmbeddingProviderOptions,
  validateEmbeddingModelParamsSettings,
} from "./sap-ai-provider-options.js";

/** Default maximum embeddings per API call (OpenAI limit). */
const DEFAULT_MAX_EMBEDDINGS_PER_CALL = 2048;

/** Model identifier for SAP AI embedding models (e.g., 'text-embedding-ada-002'). */
export type SAPAIEmbeddingModelId = string;

/**
 * Settings for the SAP AI Embedding Model.
 */
export interface SAPAIEmbeddingSettings {
  /**
   * Maximum number of embeddings per API call.
   * @default 2048
   */
  readonly maxEmbeddingsPerCall?: number;

  /**
   * Additional model parameters passed to the embedding API.
   */
  readonly modelParams?: EmbeddingModelParams;

  /**
   * Embedding task type.
   * @default 'text'
   */
  readonly type?: "document" | "query" | "text";
}

/**
 * Internal configuration for SAP AI Embedding Model.
 * @internal
 */
interface SAPAIEmbeddingModelConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
}

/**
 * SAP AI Core Embedding Model implementing Vercel AI SDK EmbeddingModelV3.
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
   * Validates input count, merges settings, calls SAP AI SDK, and normalizes embeddings.
   * @param options - The Vercel AI SDK V3 embedding call options.
   * @returns The embedding result with vectors, usage data, and warnings.
   */
  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    const { abortSignal, providerOptions, values } = options;

    const providerName = getProviderName(this.config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions,
      schema: sapAIEmbeddingProviderOptions,
    });

    if (values.length > this.maxEmbeddingsPerCall) {
      throw new TooManyEmbeddingValuesForCallError({
        maxEmbeddingsPerCall: this.maxEmbeddingsPerCall,
        modelId: this.modelId,
        provider: this.provider,
        values,
      });
    }

    const embeddingType = sapOptions?.type ?? this.settings.type ?? "text";

    try {
      const client = this.createClient(sapOptions?.modelParams);

      const response = await client.embed(
        { input: values, type: embeddingType },
        abortSignal ? { signal: abortSignal } : undefined,
      );

      const embeddingData = response.getEmbeddings();
      const tokenUsage = response.getTokenUsage();
      const sortedEmbeddings = [...embeddingData].sort((a, b) => a.index - b.index);

      const embeddings: EmbeddingModelV3Embedding[] = sortedEmbeddings.map((data) =>
        this.normalizeEmbedding(data.embedding),
      );

      const providerMetadata: SharedV3ProviderMetadata = {
        [providerName]: {
          model: this.modelId,
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
   * @param perCallModelParams - Per-call model parameters to merge with instance settings.
   * @returns A configured SAP AI SDK embedding client instance.
   * @internal
   */
  private createClient(perCallModelParams?: Record<string, unknown>): OrchestrationEmbeddingClient {
    const mergedParams = deepMerge(this.settings.modelParams ?? {}, perCallModelParams ?? {});
    const hasParams = Object.keys(mergedParams).length > 0;

    const embeddingConfig: EmbeddingModelConfig = {
      model: {
        name: this.modelId,
        ...(hasParams ? { params: mergedParams } : {}),
      },
    };

    return new OrchestrationEmbeddingClient(
      { embeddings: embeddingConfig },
      this.config.deploymentConfig,
      this.config.destination,
    );
  }

  /**
   * Converts SAP AI SDK embedding (number[] or base64) to Vercel AI SDK format.
   * @param embedding - The embedding as number array or base64 string.
   * @returns The normalized embedding as a number array.
   * @internal
   */
  private normalizeEmbedding(embedding: number[] | string): EmbeddingModelV3Embedding {
    if (Array.isArray(embedding)) {
      return embedding;
    }
    // Base64-encoded float32 values
    const buffer = Buffer.from(embedding, "base64");
    const float32Array = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.length / Float32Array.BYTES_PER_ELEMENT,
    );
    return Array.from(float32Array);
  }
}
