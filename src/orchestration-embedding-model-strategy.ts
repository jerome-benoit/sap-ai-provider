/** Orchestration embedding model strategy using `@sap-ai-sdk/orchestration`. */
import type { EmbeddingModelV3Embedding } from "@ai-sdk/provider";
import type {
  EmbeddingModelConfig,
  EmbeddingModuleConfig,
  OrchestrationEmbeddingClient,
  OrchestrationEmbeddingResponse,
} from "@sap-ai-sdk/orchestration";

import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { EmbeddingModelStrategyConfig } from "./sap-ai-strategy.js";

import { BaseEmbeddingModelStrategy } from "./base-embedding-model-strategy.js";
import { deepMerge } from "./deep-merge.js";
import { type EmbeddingProviderOptions, hasKeys, normalizeEmbedding } from "./strategy-utils.js";

/** @internal */
type OrchestrationEmbeddingClientClass = typeof OrchestrationEmbeddingClient;

/**
 * Embedding model strategy for the Orchestration API.
 *
 * Provides support for:
 * - Data masking
 * - Model parameters configuration
 * @internal
 */
export class OrchestrationEmbeddingModelStrategy extends BaseEmbeddingModelStrategy<
  OrchestrationEmbeddingClient,
  OrchestrationEmbeddingResponse
> {
  private readonly ClientClass: OrchestrationEmbeddingClientClass;

  constructor(ClientClass: OrchestrationEmbeddingClientClass) {
    super();
    this.ClientClass = ClientClass;
  }

  protected createClient(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    embeddingOptions: EmbeddingProviderOptions | undefined,
  ): OrchestrationEmbeddingClient {
    const mergedParams = deepMerge(
      (settings.modelParams as Record<string, unknown> | undefined) ?? {},
      embeddingOptions?.modelParams ?? {},
    );

    const embeddingConfig: EmbeddingModelConfig = {
      model: {
        name: config.modelId,
        ...(hasKeys(mergedParams) ? { params: mergedParams } : {}),
        ...(settings.modelVersion ? { version: settings.modelVersion } : {}),
      },
    };

    const moduleConfig: EmbeddingModuleConfig = {
      embeddings: embeddingConfig,
      ...(settings.masking && hasKeys(settings.masking as object)
        ? { masking: settings.masking }
        : {}),
    };

    return new this.ClientClass(moduleConfig, config.deploymentConfig, config.destination);
  }

  protected async executeCall(
    client: OrchestrationEmbeddingClient,
    values: string[],
    embeddingType: "document" | "query" | "text" | undefined,
    abortSignal?: AbortSignal,
  ): Promise<OrchestrationEmbeddingResponse> {
    return client.embed(
      { input: values, type: embeddingType },
      abortSignal ? { signal: abortSignal } : undefined,
    );
  }

  protected extractEmbeddings(
    response: OrchestrationEmbeddingResponse,
  ): EmbeddingModelV3Embedding[] {
    const embeddingData = response.getEmbeddings();
    const sortedEmbeddings = [...embeddingData].sort((a, b) => a.index - b.index);
    return sortedEmbeddings.map((data) => normalizeEmbedding(data.embedding));
  }

  protected extractTokenCount(response: OrchestrationEmbeddingResponse): number {
    const tokenUsage = response.getTokenUsage();
    return tokenUsage.total_tokens;
  }

  protected getUrl(): string {
    return "sap-ai:orchestration/embeddings";
  }
}
