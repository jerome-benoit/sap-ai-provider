import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { NoSuchModelError, ProviderV3 } from "@ai-sdk/provider";

import {
  SAPAIEmbeddingModel,
  SAPAIEmbeddingModelId,
  SAPAIEmbeddingSettings,
} from "./sap-ai-embedding-model.js";
import { SAPAILanguageModel } from "./sap-ai-language-model.js";
import { SAP_AI_PROVIDER_NAME, validateModelParamsSettings } from "./sap-ai-provider-options.js";
import { SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

/**
 * Deployment configuration type used by SAP AI SDK.
 */
export type DeploymentConfig = DeploymentIdConfig | ResourceGroupConfig;

/**
 * SAP AI Provider interface.
 *
 * This is the main interface for creating and configuring SAP AI Core models.
 * It extends the standard AI SDK ProviderV3 interface with SAP-specific functionality.
 * @example
 * ```typescript
 * const provider = createSAPAIProvider({
 *   resourceGroup: 'default'
 * });
 *
 * // Create a model instance
 * const model = provider('gpt-4o', {
 *   modelParams: {
 *     temperature: 0.7,
 *     maxTokens: 1000
 *   }
 * });
 *
 * // Or use the explicit chat method
 * const chatModel = provider.chat('gpt-4o');
 * ```
 */
export interface SAPAIProvider extends ProviderV3 {
  /**
   * Create a language model instance.
   * @param modelId - The SAP AI Core model identifier (e.g., 'gpt-4o', 'anthropic--claude-3.5-sonnet')
   * @param settings - Optional model configuration settings
   * @returns Configured SAP AI chat language model instance
   */
  (modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;

  /**
   * Explicit method for creating chat models.
   *
   * This method is equivalent to calling the provider function directly,
   * but provides a more explicit API for chat-based interactions.
   * @param modelId - The SAP AI Core model identifier
   * @param settings - Optional model configuration settings
   * @returns Configured SAP AI chat language model instance
   */
  chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;

  /**
   * Create an embedding model instance.
   * @param modelId - The embedding model identifier (e.g., 'text-embedding-ada-002', 'text-embedding-3-small')
   * @param settings - Optional embedding model settings
   * @returns Configured SAP AI embedding model instance
   * @example
   * ```typescript
   * import { embed } from 'ai';
   *
   * const { embedding } = await embed({
   *   model: provider.embedding('text-embedding-ada-002'),
   *   value: 'Hello, world!'
   * });
   * ```
   */
  embedding(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel;

  /**
   * Create an embedding model instance.
   *
   * Standard ProviderV3 method for creating embedding models.
   * Equivalent to calling `embedding()`.
   * @param modelId - The embedding model identifier
   * @param settings - Optional embedding model settings
   * @returns Configured SAP AI embedding model instance
   */
  embeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModel;

  /**
   * Image model stub for ProviderV3 interface compliance.
   *
   * SAP AI Core Orchestration Service does not currently support image generation.
   * This method always throws a `NoSuchModelError` to indicate that image generation
   * is not available through this provider.
   * @param modelId - The image model identifier (not used)
   * @throws {NoSuchModelError} Always throws - image generation is not supported
   * @example
   * ```typescript
   * // This will always throw NoSuchModelError
   * provider.imageModel('dall-e-3'); // throws NoSuchModelError
   * ```
   */
  imageModel(modelId: string): never;

  /**
   * Create a language model instance.
   *
   * Standard ProviderV3 method for creating language models.
   * Equivalent to calling the provider function directly or using `chat()`.
   * @param modelId - The SAP AI Core model identifier
   * @param settings - Optional model configuration settings
   * @returns Configured SAP AI language model instance
   */
  languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;

  /**
   * Create a text embedding model instance.
   *
   * Alias for `embedding()` method, provided for compatibility with AI SDK conventions.
   * @param modelId - The embedding model identifier
   * @param settings - Optional embedding model settings
   * @returns Configured SAP AI embedding model instance
   * @deprecated Use `embeddingModel()` instead.
   */
  textEmbeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModel;
}

/**
 * Configuration settings for the SAP AI Provider.
 *
 * This interface defines all available options for configuring the SAP AI Core connection
 * using the official SAP AI SDK. See {@link createSAPAIProvider} for authentication details.
 * @example
 * ```typescript
 * // Using default configuration (auto-detects service binding or env var)
 * const provider = createSAPAIProvider();
 *
 * // With specific resource group
 * const provider = createSAPAIProvider({
 *   resourceGroup: 'production'
 * });
 *
 * // With custom provider name (for providerOptions and providerMetadata keys)
 * const provider = createSAPAIProvider({
 *   name: 'sap-ai-core',
 *   resourceGroup: 'default'
 * });
 *
 * // With custom destination
 * const provider = createSAPAIProvider({
 *   destination: {
 *     url: 'https://my-ai-core-instance.cfapps.eu10.hana.ondemand.com'
 *   }
 * });
 * ```
 */
export interface SAPAIProviderSettings {
  /**
   * Default model settings applied to every model instance created by this provider.
   * Per-call settings provided to the model will override these.
   */
  readonly defaultSettings?: SAPAISettings;

  /**
   * SAP AI Core deployment ID.
   *
   * A specific deployment ID to use for orchestration requests.
   * If not provided, the SDK will resolve the deployment automatically.
   * @example
   * ```typescript
   * deploymentId: 'd65d81e7c077e583'
   * ```
   */
  readonly deploymentId?: string;

  /**
   * Custom destination configuration for SAP AI Core.
   *
   * Override the default destination detection. Useful for:
   * - Custom proxy configurations
   * - Non-standard SAP AI Core setups
   * - Testing environments
   * @example
   * ```typescript
   * destination: {
   *   url: 'https://api.ai.prod.eu-central-1.aws.ml.hana.ondemand.com'
   * }
   * ```
   */
  readonly destination?: HttpDestinationOrFetchOptions;

  /**
   * Custom provider name.
   *
   * This name is used as the key for `providerOptions` and `providerMetadata` in AI SDK calls.
   * Useful when you want to use a different identifier than the default 'sap-ai'.
   * @default 'sap-ai'
   * @example
   * ```typescript
   * // Use custom name for providerOptions
   * const provider = createSAPAIProvider({ name: 'sap-ai-core' });
   *
   * // Then in AI SDK calls:
   * await generateText({
   *   model: provider('gpt-4o'),
   *   prompt: 'Hello',
   *   providerOptions: {
   *     'sap-ai-core': { includeReasoning: true }  // Uses custom name
   *   }
   * });
   * ```
   */
  readonly name?: string;

  /**
   * SAP AI Core resource group.
   *
   * Logical grouping of AI resources in SAP AI Core.
   * Used for resource isolation and access control.
   * Different resource groups can have different permissions and quotas.
   * @default 'default'
   * @example
   * ```typescript
   * resourceGroup: 'default'     // Default resource group
   * resourceGroup: 'production'  // Production environment
   * resourceGroup: 'development' // Development environment
   * ```
   */
  readonly resourceGroup?: string;

  /**
   * Whether to emit warnings for ambiguous configurations.
   *
   * When enabled (default), the provider will warn when mutually-exclusive
   * settings are provided (e.g. both `deploymentId` and `resourceGroup`).
   */
  readonly warnOnAmbiguousConfig?: boolean;
}

/**
 * Creates a SAP AI Core provider instance for use with the AI SDK.
 *
 * This is the main entry point for integrating SAP AI Core with the AI SDK.
 * It uses the official SAP AI SDK (@sap-ai-sdk/orchestration) under the hood,
 * which handles authentication and API communication automatically.
 *
 * **Authentication:**
 * The SAP AI SDK automatically handles authentication:
 * 1. On SAP BTP: Uses service binding (VCAP_SERVICES)
 * 2. Locally: Uses AICORE_SERVICE_KEY environment variable
 *
 * **Key Features:**
 * - Automatic authentication via SAP AI SDK
 * - Support for all SAP AI Core orchestration models
 * - Streaming and non-streaming responses
 * - Tool calling support
 * - Data masking (DPI)
 * - Content filtering
 * @param options - Configuration options for the provider
 * @returns A configured SAP AI provider
 * @example
 * **Basic Usage**
 * ```typescript
 * import { createSAPAIProvider } from '@mymediset/sap-ai-provider';
 * import { generateText } from 'ai';
 *
 * const provider = createSAPAIProvider();
 *
 * const result = await generateText({
 *   model: provider('gpt-4o'),
 *   prompt: 'Hello, world!'
 * });
 * ```
 * @example
 * **With Resource Group**
 * ```typescript
 * const provider = createSAPAIProvider({
 *   resourceGroup: 'production'
 * });
 *
 * const model = provider('anthropic--claude-3.5-sonnet', {
 *   modelParams: {
 *     temperature: 0.3,
 *     maxTokens: 2000
 *   }
 * });
 * ```
 * @example
 * **With Default Settings**
 * ```typescript
 * const provider = createSAPAIProvider({
 *   defaultSettings: {
 *     modelParams: {
 *       temperature: 0.7
 *     }
 *   }
 * });
 * ```
 */
export function createSAPAIProvider(options: SAPAIProviderSettings = {}): SAPAIProvider {
  // Validate defaultSettings.modelParams at provider creation time
  if (options.defaultSettings?.modelParams) {
    validateModelParamsSettings(options.defaultSettings.modelParams);
  }

  const providerName = options.name ?? SAP_AI_PROVIDER_NAME;

  const resourceGroup = options.resourceGroup ?? "default";

  const warnOnAmbiguousConfig = options.warnOnAmbiguousConfig ?? true;

  if (warnOnAmbiguousConfig && options.deploymentId && options.resourceGroup) {
    console.warn(
      "createSAPAIProvider: both 'deploymentId' and 'resourceGroup' were provided; using 'deploymentId' and ignoring 'resourceGroup'.",
    );
  }

  const deploymentConfig: DeploymentConfig = options.deploymentId
    ? { deploymentId: options.deploymentId }
    : { resourceGroup };

  const createModel = (modelId: SAPAIModelId, settings: SAPAISettings = {}) => {
    /**
     * Settings merge strategy:
     *
     * | Setting Type | Merge Behavior | Example |
     * |-------------|----------------|---------|
     * | `modelParams` | Deep merge (primitives combined) | `temperature: 0.7` (default) + `maxTokens: 2000` (call) = both apply |
     * | Complex objects (`masking`, `filtering`) | Override (last wins) | Call-time `masking` completely replaces default |
     * | `tools` | Override (last wins) | Call-time tools replace default tools array |
     *
     * This design prevents unexpected behavior from merging complex configurations.
     * @example
     * ```typescript
     * // modelParams: merged
     * provider('gpt-4o', { modelParams: { maxTokens: 2000 } });
     * // Result: { temperature: 0.7 (from default), maxTokens: 2000 }
     *
     * // masking: replaced
     * provider('gpt-4o', { masking: { entities: ['PHONE'] } });
     * // Result: Only PHONE, default PERSON/EMAIL are gone
     * ```
     */
    const mergedSettings: SAPAISettings = {
      ...options.defaultSettings,
      ...settings,
      filtering: settings.filtering ?? options.defaultSettings?.filtering,
      // Complex objects: override, do not merge

      masking: settings.masking ?? options.defaultSettings?.masking,
      modelParams: {
        ...(options.defaultSettings?.modelParams ?? {}),
        ...(settings.modelParams ?? {}),
      },
      tools: settings.tools ?? options.defaultSettings?.tools,
    };

    return new SAPAILanguageModel(modelId, mergedSettings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.chat`,
    });
  };

  const createEmbeddingModel = (
    modelId: SAPAIEmbeddingModelId,
    settings: SAPAIEmbeddingSettings = {},
  ): SAPAIEmbeddingModel => {
    return new SAPAIEmbeddingModel(modelId, settings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.embedding`,
    });
  };

  const provider = function (modelId: SAPAIModelId, settings?: SAPAISettings) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (new.target) {
      throw new Error("The SAP AI provider function cannot be called with the new keyword.");
    }

    return createModel(modelId, settings);
  };

  provider.specificationVersion = "v3";
  provider.chat = createModel;
  provider.languageModel = createModel;
  provider.embedding = createEmbeddingModel;
  provider.textEmbeddingModel = createEmbeddingModel;
  provider.embeddingModel = createEmbeddingModel;

  /**
   * Stub for image model - SAP AI Core does not support image generation.
   * @param modelId - The image model identifier (not used)
   * @throws {NoSuchModelError} Always throws
   */
  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({
      message: `SAP AI Core Orchestration Service does not support image generation. Model '${modelId}' is not available.`,
      modelId,
      modelType: "imageModel",
    });
  };

  return provider as SAPAIProvider;
}

/**
 * Default SAP AI provider instance.
 *
 * Uses default configuration with automatic authentication.
 * See {@link createSAPAIProvider} for authentication details.
 * @example
 * ```typescript
 * import { sapai } from '@mymediset/sap-ai-provider';
 * import { generateText } from 'ai';
 *
 * const result = await generateText({
 *   model: sapai('gpt-4o'),
 *   prompt: 'Hello!'
 * });
 * ```
 */
export const sapai = createSAPAIProvider();
