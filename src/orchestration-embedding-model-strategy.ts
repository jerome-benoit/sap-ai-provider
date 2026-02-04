/** Orchestration embedding model strategy using `@sap-ai-sdk/orchestration`. */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import type {
  EmbeddingModelConfig,
  EmbeddingModuleConfig,
  MaskingModule,
  OrchestrationEmbeddingClient,
} from "@sap-ai-sdk/orchestration";

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
 * @internal
 */
type OrchestrationEmbeddingClientClass = typeof OrchestrationEmbeddingClient;

/**
 * @internal
 */
export class OrchestrationEmbeddingModelStrategy implements EmbeddingModelAPIStrategy {
  private readonly ClientClass: OrchestrationEmbeddingClientClass;

  constructor(ClientClass: OrchestrationEmbeddingClientClass) {
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

    const embeddingType = sapOptions?.type ?? settings.type ?? "text";

    try {
      const client = this.createClient(
        config,
        settings.modelParams as Record<string, unknown> | undefined,
        sapOptions?.modelParams,
        settings.modelVersion,
        settings.masking,
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

  private createClient(
    config: EmbeddingModelStrategyConfig,
    settingsModelParams?: Record<string, unknown>,
    perCallModelParams?: Record<string, unknown>,
    modelVersion?: string,
    masking?: MaskingModule,
  ): OrchestrationEmbeddingClient {
    const mergedParams = deepMerge(settingsModelParams ?? {}, perCallModelParams ?? {});
    const hasParams = Object.keys(mergedParams).length > 0;

    const embeddingConfig: EmbeddingModelConfig = {
      model: {
        name: config.modelId,
        ...(hasParams ? { params: mergedParams } : {}),
        ...(modelVersion ? { version: modelVersion } : {}),
      },
    };

    const moduleConfig: EmbeddingModuleConfig = {
      embeddings: embeddingConfig,
      ...(masking && Object.keys(masking as object).length > 0 ? { masking } : {}),
    };

    return new this.ClientClass(moduleConfig, config.deploymentConfig, config.destination);
  }
}
