import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { NoSuchModelError, ProviderV3 } from "@ai-sdk/provider";
import { setGlobalLogLevel } from "@sap-cloud-sdk/util";

import { deepMerge } from "./deep-merge.js";
import {
  SAPAIEmbeddingModel,
  SAPAIEmbeddingModelId,
  SAPAIEmbeddingSettings,
} from "./sap-ai-embedding-model.js";
import { SAPAILanguageModel } from "./sap-ai-language-model.js";
import { SAP_AI_PROVIDER_NAME, validateModelParamsSettings } from "./sap-ai-provider-options.js";
import { SAPAIApiType, SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

/** Deployment configuration type used by the SAP AI SDK. */
export type DeploymentConfig = DeploymentIdConfig | ResourceGroupConfig;

/**
 * SAP AI Provider interface for creating and configuring SAP AI Core models.
 * Extends the Vercel AI SDK ProviderV3 interface with SAP-specific functionality.
 */
export interface SAPAIProvider extends ProviderV3 {
  /** Creates a language model instance. */
  (modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;

  /** Creates a language model instance (custom convenience method). */
  chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;

  /** Creates an embedding model instance (custom convenience method). */
  embedding(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel;

  /** Creates an embedding model instance (Vercel AI SDK ProviderV3 standard method). */
  embeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModel;

  /**
   * Image model stub - always throws NoSuchModelError.
   * SAP AI Core does not support image generation.
   */
  imageModel(modelId: string): never;

  /** Creates a language model instance (Vercel AI SDK ProviderV3 standard method). */
  languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel;

  /**
   * Creates a text embedding model instance.
   * @deprecated Use `embeddingModel()` instead.
   */
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
 * Creates a SAP AI Core provider instance for use with the Vercel AI SDK.
 *
 * Uses the official SAP AI SDK (`@sap-ai-sdk/orchestration` and
 * `@sap-ai-sdk/foundation-models`) for API communication. Authentication is automatic via service binding
 * (VCAP_SERVICES on SAP BTP) or AICORE_SERVICE_KEY environment variable.
 * @param options - Provider configuration options.
 * @returns A configured SAP AI provider instance.
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

  const deploymentConfig: DeploymentConfig = options.deploymentId
    ? { deploymentId: options.deploymentId }
    : { resourceGroup };

  // Provider-level API setting (defaults to 'orchestration')
  const providerApi = options.api ?? "orchestration";

  const createModel = (modelId: SAPAIModelId, settings: SAPAISettings = {}) => {
    const mergedSettings: SAPAISettings = {
      ...options.defaultSettings,
      ...settings,
      // Model-level api takes precedence over provider-level
      api: settings.api ?? options.defaultSettings?.api ?? providerApi,
      filtering: settings.filtering ?? options.defaultSettings?.filtering,
      masking: settings.masking ?? options.defaultSettings?.masking,
      modelParams: deepMerge(
        options.defaultSettings?.modelParams ?? {},
        settings.modelParams ?? {},
      ),
      tools: settings.tools ?? options.defaultSettings?.tools,
    };

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
    // Merge embedding settings with provider-level api
    const mergedSettings: SAPAIEmbeddingSettings = {
      ...settings,
      api: settings.api ?? providerApi,
    };

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
