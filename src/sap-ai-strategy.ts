/** Strategy pattern infrastructure for SAP AI Core API support. */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type {
  SAPAIApiType,
  SAPAIEmbeddingSettings,
  SAPAIModelSettings,
} from "./sap-ai-settings.js";

/** @internal */
export interface EmbeddingModelAPIStrategy {
  doEmbed(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    options: EmbeddingModelV3CallOptions,
    maxEmbeddingsPerCall: number,
  ): Promise<EmbeddingModelV3Result>;
}

/** @internal */
export interface EmbeddingModelStrategyConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly modelId: string;
  readonly provider: string;
}

/** @internal */
export interface LanguageModelAPIStrategy {
  doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult>;

  doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult>;
}

/** @internal */
export interface LanguageModelStrategyConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly modelId: string;
  readonly provider: string;
}

/** @internal */
const languageModelStrategyCache = new Map<SAPAIApiType, Promise<LanguageModelAPIStrategy>>();

/** @internal */
const embeddingModelStrategyCache = new Map<SAPAIApiType, Promise<EmbeddingModelAPIStrategy>>();

/** @internal */
export function clearStrategyCaches(): void {
  languageModelStrategyCache.clear();
  embeddingModelStrategyCache.clear();
}

/**
 * @returns Embedding model strategy cache size.
 * @internal
 */
export function getEmbeddingModelStrategyCacheSize(): number {
  return embeddingModelStrategyCache.size;
}

/**
 * @returns Language model strategy cache size.
 * @internal
 */
export function getLanguageModelStrategyCacheSize(): number {
  return languageModelStrategyCache.size;
}

/**
 * @param api - SAP AI API type.
 * @returns Embedding model strategy.
 * @internal
 */
export function getOrCreateEmbeddingModelStrategy(
  api: SAPAIApiType,
): Promise<EmbeddingModelAPIStrategy> {
  const cached = embeddingModelStrategyCache.get(api);
  if (cached) {
    return cached;
  }

  // Cache the Promise synchronously before any await to prevent race conditions
  const strategyPromise = createEmbeddingModelStrategy(api);
  embeddingModelStrategyCache.set(api, strategyPromise);

  strategyPromise.catch(() => {
    embeddingModelStrategyCache.delete(api);
  });

  return strategyPromise;
}

/**
 * @param api - SAP AI API type.
 * @returns Language model strategy.
 * @internal
 */
export function getOrCreateLanguageModelStrategy(
  api: SAPAIApiType,
): Promise<LanguageModelAPIStrategy> {
  const cached = languageModelStrategyCache.get(api);
  if (cached) {
    return cached;
  }

  // Cache the Promise synchronously before any await to prevent race conditions
  const strategyPromise = createLanguageModelStrategy(api);
  languageModelStrategyCache.set(api, strategyPromise);

  strategyPromise.catch(() => {
    languageModelStrategyCache.delete(api);
  });

  return strategyPromise;
}

/**
 * @param api - SAP AI API type.
 * @returns Embedding model strategy.
 */
async function createEmbeddingModelStrategy(api: SAPAIApiType): Promise<EmbeddingModelAPIStrategy> {
  if (api === "foundation-models") {
    const { AzureOpenAiEmbeddingClient } = await import("@sap-ai-sdk/foundation-models");
    const { FoundationModelsEmbeddingModelStrategy } =
      await import("./foundation-models-embedding-model-strategy.js");
    return new FoundationModelsEmbeddingModelStrategy(AzureOpenAiEmbeddingClient);
  }

  const { OrchestrationEmbeddingClient } = await import("@sap-ai-sdk/orchestration");
  const { OrchestrationEmbeddingModelStrategy } =
    await import("./orchestration-embedding-model-strategy.js");
  return new OrchestrationEmbeddingModelStrategy(OrchestrationEmbeddingClient);
}

/**
 * @param api - SAP AI API type.
 * @returns Language model strategy.
 */
async function createLanguageModelStrategy(api: SAPAIApiType): Promise<LanguageModelAPIStrategy> {
  if (api === "foundation-models") {
    const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
    const { FoundationModelsLanguageModelStrategy } =
      await import("./foundation-models-language-model-strategy.js");
    return new FoundationModelsLanguageModelStrategy(AzureOpenAiChatClient);
  }

  const { OrchestrationClient } = await import("@sap-ai-sdk/orchestration");
  const { OrchestrationLanguageModelStrategy } =
    await import("./orchestration-language-model-strategy.js");
  return new OrchestrationLanguageModelStrategy(OrchestrationClient);
}
