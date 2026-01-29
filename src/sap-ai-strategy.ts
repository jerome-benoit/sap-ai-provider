/**
 * Strategy Pattern Infrastructure for SAP AI Core API Support.
 *
 * Provides lazy-loaded, cached strategies for both Orchestration and Foundation Models APIs.
 * Strategies are stateless - tenant-specific configuration is passed per-call for security.
 */
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

/**
 * Strategy interface for embedding model operations.
 *
 * Implementations are stateless - they hold only SDK client class references.
 * All tenant-specific configuration flows through method parameters.
 * @internal
 */
export interface EmbeddingModelAPIStrategy {
  /**
   * Generates embeddings for the given input values.
   * @param config - Tenant-specific deployment and destination configuration.
   * @param settings - Effective embedding settings after merge and validation.
   * @param options - Vercel AI SDK V3 embedding call options.
   * @param maxEmbeddingsPerCall - Maximum number of embeddings allowed per call.
   * @returns The embedding result with vectors, usage data, and warnings.
   */
  doEmbed(
    config: EmbeddingModelStrategyConfig,
    settings: SAPAIEmbeddingSettings,
    options: EmbeddingModelV3CallOptions,
    maxEmbeddingsPerCall: number,
  ): Promise<EmbeddingModelV3Result>;
}

/**
 * Configuration passed to embedding model strategy methods.
 * Contains tenant-specific info that MUST NOT be cached in strategy instances.
 * @internal
 */
export interface EmbeddingModelStrategyConfig {
  /** Deployment configuration (ID-based or resource group-based). */
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  /** Optional destination configuration for SAP Cloud SDK connectivity. */
  readonly destination?: HttpDestinationOrFetchOptions;
  /** The model identifier (e.g., 'text-embedding-ada-002'). */
  readonly modelId: string;
  /** The provider identifier string. */
  readonly provider: string;
}

/**
 * Strategy interface for language model operations.
 *
 * Implementations are stateless - they hold only SDK client class references.
 * All tenant-specific configuration flows through method parameters.
 * @internal
 */
export interface LanguageModelAPIStrategy {
  /**
   * Generates a single completion (non-streaming).
   * @param config - Tenant-specific deployment and destination configuration.
   * @param settings - Effective model settings after merge and validation.
   * @param options - Vercel AI SDK V3 generation call options.
   * @returns The generation result with content, usage, warnings, and provider metadata.
   */
  doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult>;

  /**
   * Generates a streaming completion.
   * @param config - Tenant-specific deployment and destination configuration.
   * @param settings - Effective model settings after merge and validation.
   * @param options - Vercel AI SDK V3 generation call options.
   * @returns A stream result with async iterable stream parts.
   */
  doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult>;
}

/**
 * Configuration passed to language model strategy methods.
 * Contains tenant-specific info that MUST NOT be cached in strategy instances.
 * @internal
 */
export interface LanguageModelStrategyConfig {
  /** Deployment configuration (ID-based or resource group-based). */
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  /** Optional destination configuration for SAP Cloud SDK connectivity. */
  readonly destination?: HttpDestinationOrFetchOptions;
  /** The model identifier (e.g., 'gpt-4o', 'claude-3-5-sonnet'). */
  readonly modelId: string;
  /** The provider identifier string. */
  readonly provider: string;
}

/**
 * Module-level cache for language model strategy Promises.
 *
 * CRITICAL: Cache the Promise synchronously before any await to prevent race conditions.
 * SECURITY: Cache key is API type only - strategies are stateless, config passed per-call.
 * @internal
 */
const languageModelStrategyCache = new Map<SAPAIApiType, Promise<LanguageModelAPIStrategy>>();

/**
 * Module-level cache for embedding model strategy Promises.
 * @internal
 */
const embeddingModelStrategyCache = new Map<SAPAIApiType, Promise<EmbeddingModelAPIStrategy>>();

/**
 * Clears all strategy caches. Used for testing purposes only.
 * @internal
 */
export function clearStrategyCaches(): void {
  languageModelStrategyCache.clear();
  embeddingModelStrategyCache.clear();
}

/**
 * Gets the current size of the embedding model strategy cache.
 * Used for testing purposes only.
 * @returns The number of cached embedding model strategies.
 * @internal
 */
export function getEmbeddingModelStrategyCacheSize(): number {
  return embeddingModelStrategyCache.size;
}

/**
 * Gets the current size of the language model strategy cache.
 * Used for testing purposes only.
 * @returns The number of cached language model strategies.
 * @internal
 */
export function getLanguageModelStrategyCacheSize(): number {
  return languageModelStrategyCache.size;
}

/**
 * Gets or creates a cached embedding model strategy for the given API type.
 *
 * Uses Promise-based caching to prevent race conditions with concurrent requests.
 * Strategies are stateless - tenant configuration is passed per-call.
 * @param api - The API type to get a strategy for.
 * @returns A Promise resolving to the embedding model strategy.
 * @internal
 */
export function getOrCreateEmbeddingModelStrategy(
  api: SAPAIApiType,
): Promise<EmbeddingModelAPIStrategy> {
  // Check cache first
  const cached = embeddingModelStrategyCache.get(api);
  if (cached) {
    return cached;
  }

  // CRITICAL: Cache the Promise SYNCHRONOUSLY before any await
  const strategyPromise = createEmbeddingModelStrategy(api);
  embeddingModelStrategyCache.set(api, strategyPromise);

  // Handle import failures - remove from cache to allow retry
  strategyPromise.catch(() => {
    embeddingModelStrategyCache.delete(api);
  });

  return strategyPromise;
}

/**
 * Gets or creates a cached language model strategy for the given API type.
 *
 * Uses Promise-based caching to prevent race conditions with concurrent requests.
 * Strategies are stateless - tenant configuration is passed per-call.
 * @param api - The API type to get a strategy for.
 * @returns A Promise resolving to the language model strategy.
 * @internal
 */
export function getOrCreateLanguageModelStrategy(
  api: SAPAIApiType,
): Promise<LanguageModelAPIStrategy> {
  // Check cache first
  const cached = languageModelStrategyCache.get(api);
  if (cached) {
    return cached;
  }

  // CRITICAL: Cache the Promise SYNCHRONOUSLY before any await
  // This prevents race conditions where concurrent requests both create strategies
  const strategyPromise = createLanguageModelStrategy(api);
  languageModelStrategyCache.set(api, strategyPromise);

  // Handle import failures - remove from cache to allow retry
  strategyPromise.catch(() => {
    languageModelStrategyCache.delete(api);
  });

  return strategyPromise;
}

/**
 * Creates an embedding model strategy for the given API type.
 *
 * Performs lazy loading of the appropriate SDK package.
 * @param api - The API type to create a strategy for.
 * @returns A Promise resolving to the embedding model strategy.
 * @internal
 */
async function createEmbeddingModelStrategy(api: SAPAIApiType): Promise<EmbeddingModelAPIStrategy> {
  if (api === "foundation-models") {
    const { AzureOpenAiEmbeddingClient } = await import("@sap-ai-sdk/foundation-models");
    const { FoundationModelsEmbeddingModelStrategy } =
      await import("./foundation-models-embedding-model-strategy.js");
    return new FoundationModelsEmbeddingModelStrategy(AzureOpenAiEmbeddingClient);
  }

  // Default: Orchestration API
  const { OrchestrationEmbeddingClient } = await import("@sap-ai-sdk/orchestration");
  const { OrchestrationEmbeddingModelStrategy } =
    await import("./orchestration-embedding-model-strategy.js");
  return new OrchestrationEmbeddingModelStrategy(OrchestrationEmbeddingClient);
}

/**
 * Creates a language model strategy for the given API type.
 *
 * Performs lazy loading of the appropriate SDK package.
 * @param api - The API type to create a strategy for.
 * @returns A Promise resolving to the language model strategy.
 * @internal
 */
async function createLanguageModelStrategy(api: SAPAIApiType): Promise<LanguageModelAPIStrategy> {
  if (api === "foundation-models") {
    const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
    const { FoundationModelsLanguageModelStrategy } =
      await import("./foundation-models-language-model-strategy.js");
    return new FoundationModelsLanguageModelStrategy(AzureOpenAiChatClient);
  }

  // Default: Orchestration API
  const { OrchestrationClient } = await import("@sap-ai-sdk/orchestration");
  const { OrchestrationLanguageModelStrategy } =
    await import("./orchestration-language-model-strategy.js");
  return new OrchestrationLanguageModelStrategy(OrchestrationClient);
}
