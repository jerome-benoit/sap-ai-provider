import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { NoSuchModelError, ProviderV3 } from "@ai-sdk/provider";
import { setGlobalLogLevel } from "@sap-cloud-sdk/util";

import { SAPAIEmbeddingModel, SAPAIEmbeddingModelId } from "./sap-ai-embedding-model.js";
import { SAPAILanguageModel } from "./sap-ai-language-model.js";
import { SAP_AI_PROVIDER_NAME, validateModelParamsSettings } from "./sap-ai-provider-options.js";
import {
  SAPAIApiType,
  SAPAIEmbeddingSettings,
  SAPAIModelId,
  SAPAISettings,
} from "./sap-ai-settings.js";
import { mergeSettingsWithApi } from "./sap-ai-validation.js";

/** @internal */
export type DeploymentConfig = DeploymentIdConfig | ResourceGroupConfig;

/** SAP AI Provider interface extending Vercel AI SDK ProviderV3. */
export interface SAPAIProvider extends ProviderV3 {
  (modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;
  chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;
  embedding(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel;
  embeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModel;
  /** Always throws - SAP AI Core does not support image generation. */
  imageModel(modelId: string): never;
  languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;
  /** @deprecated Use `embeddingModel()` instead. */
  textEmbeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModel;
}

/**
 * Configuration settings for the SAP AI Provider.
 * See {@link createSAPAIProvider} for authentication details.
 */
export interface SAPAIProviderSettings {
  /**
   * SAP AI Core API to use for all models created by this provider.
   * Can be overridden at model creation time or per-call via providerOptions.
   * - `'orchestration'` (default): SAP AI Core Orchestration API - supports filtering, grounding, masking, translation
   * - `'foundation-models'`: SAP AI Core Foundation Models API - supports dataSources, logprobs, seed, etc.
   * @default 'orchestration'
   */
  readonly api?: SAPAIApiType;

  /** Default model settings applied to every model instance. Per-call settings override these. */
  readonly defaultSettings?: SAPAISettings;

  /** SAP AI Core deployment ID. If not provided, the SDK resolves deployment automatically. */
  readonly deploymentId?: string;

  /** Custom destination configuration for SAP AI Core. */
  readonly destination?: HttpDestinationOrFetchOptions;

  /**
   * Log level for SAP Cloud SDK loggers.
   * Controls verbosity of internal SAP SDK logging (e.g., authentication, service binding).
   * Note: SAP_CLOUD_SDK_LOG_LEVEL environment variable takes precedence if set.
   * @default 'warn'
   */
  readonly logLevel?: "debug" | "error" | "info" | "warn";

  /**
   * Provider name used as key for `providerOptions` and `providerMetadata`.
   * @default 'sap-ai'
   */
  readonly name?: string;

  /**
   * SAP AI Core resource group for resource isolation and access control.
   * @default 'default'
   */
  readonly resourceGroup?: string;

  /** Whether to emit warnings for ambiguous configurations (e.g. both deploymentId and resourceGroup). */
  readonly warnOnAmbiguousConfig?: boolean;
}

/**
 * Creates an SAP AI Provider instance for use with the Vercel AI SDK.
 *
 * Uses the official SAP AI SDK (`@sap-ai-sdk/orchestration` and
 * `@sap-ai-sdk/foundation-models`) for API communication. Authentication is automatic via service binding
 * (VCAP_SERVICES on SAP BTP) or AICORE_SERVICE_KEY environment variable.
 * @param options - Provider configuration options.
 * @param options.api - Default API type: `'orchestration'` (default) or `'foundation-models'`.
 * @param options.defaultSettings - Default model settings applied to every model instance.
 * @param options.deploymentId - SAP AI Core deployment ID for automatic deployment resolution.
 * @param options.destination - Custom SAP Cloud SDK destination configuration.
 * @param options.logLevel - Log level for SAP Cloud SDK loggers (`'debug'`, `'info'`, `'warn'`, `'error'`).
 * @param options.name - Provider name used as key in `providerOptions` (default: `'sap-ai'`).
 * @param options.resourceGroup - SAP AI Core resource group (default: `'default'`).
 * @param options.warnOnAmbiguousConfig - Whether to warn when both deploymentId and resourceGroup are set.
 * @returns A configured SAP AI provider instance that can be used as a callable or via methods.
 * @example
 * // Basic usage with defaults
 * const provider = createSAPAIProvider();
 * const model = provider('gpt-4.1');
 * @example
 * // With custom configuration
 * const provider = createSAPAIProvider({
 *   api: 'foundation-models',
 *   resourceGroup: 'production',
 *   defaultSettings: { modelParams: { temperature: 0.7 } },
 * });
 * @example
 * // Using provider methods
 * const chatModel = provider.chat('gpt-4.1');
 * const embeddingModel = provider.embedding('text-embedding-3-small');
 * @see {@link SAPAIProviderSettings} for all configuration options.
 * @see {@link SAPAIProvider} for the provider interface.
 */
export function createSAPAIProvider(options: SAPAIProviderSettings = {}): SAPAIProvider {
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

  if (!process.env.SAP_CLOUD_SDK_LOG_LEVEL) {
    const logLevel = options.logLevel ?? "warn";
    setGlobalLogLevel(logLevel);
  }

  const providerApi = options.api ?? "orchestration";

  const deploymentConfig: DeploymentConfig = options.deploymentId
    ? { deploymentId: options.deploymentId }
    : { resourceGroup };

  const createModel = (modelId: SAPAIModelId, settings: SAPAISettings = {}) => {
    const mergedSettings = mergeSettingsWithApi<SAPAISettings>(
      options.defaultSettings as Record<string, unknown> | undefined,
      settings,
      providerApi,
    );

    return new SAPAILanguageModel(modelId, mergedSettings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.chat`,
      providerApi,
    });
  };

  const createEmbeddingModel = (
    modelId: SAPAIEmbeddingModelId,
    settings: SAPAIEmbeddingSettings = {},
  ): SAPAIEmbeddingModel => {
    const mergedSettings = mergeSettingsWithApi<SAPAIEmbeddingSettings>(
      options.defaultSettings as Record<string, unknown> | undefined,
      settings,
      providerApi,
    );

    return new SAPAIEmbeddingModel(modelId, mergedSettings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.embedding`,
      providerApi,
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

  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({
      message: `SAP AI Core does not support image generation. Model '${modelId}' is not available.`,
      modelId,
      modelType: "imageModel",
    });
  };

  return provider as SAPAIProvider;
}

/** Default SAP AI provider instance with automatic authentication via SAP AI SDK. */
export const sapai = createSAPAIProvider();
