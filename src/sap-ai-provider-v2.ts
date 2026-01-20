import type { ImageModelV2, ProviderV2 } from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { NoSuchModelError } from "@ai-sdk/provider";
import { setGlobalLogLevel } from "@sap-cloud-sdk/util";

import type { SAPAIEmbeddingModelId, SAPAIEmbeddingSettings } from "./sap-ai-embedding-model.js";

import { deepMerge } from "./deep-merge.js";
import { SAPAIEmbeddingModelV2 } from "./sap-ai-embedding-model-v2.js";
import { SAPAILanguageModelV2 } from "./sap-ai-language-model-v2.js";
import { SAP_AI_PROVIDER_NAME, validateModelParamsSettings } from "./sap-ai-provider-options.js";
import { SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

/** Deployment configuration type used by the SAP AI SDK. */
export type DeploymentConfig = DeploymentIdConfig | ResourceGroupConfig;

/**
 * Configuration settings for the SAP AI Provider.
 * See {@link createSAPAIProvider} for authentication details.
 */
export interface SAPAIProviderSettings {
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
 * SAP AI Provider V2 interface for creating and configuring SAP AI Core models.
 * Extends the Vercel AI SDK ProviderV2 interface with SAP-specific functionality.
 */
export interface SAPAIProviderV2 extends ProviderV2 {
  /** Creates a language model instance. */
  (modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV2;

  /** Creates a language model instance (custom convenience method). */
  chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV2;

  /**
   * Image model stub - always throws NoSuchModelError.
   * SAP AI Core Orchestration Service does not support image generation.
   */
  imageModel(modelId: string): ImageModelV2;

  /** Creates a language model instance (Vercel AI SDK ProviderV2 standard method). */
  languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV2;

  /** Creates a text embedding model instance (Vercel AI SDK ProviderV2 standard method). */
  textEmbeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModelV2;
}

/**
 * Creates a SAP AI Core provider instance for use with the Vercel AI SDK (V2 compatibility).
 *
 * Uses the official SAP AI SDK (@sap-ai-sdk/orchestration) for authentication
 * and API communication. Authentication is automatic via service binding
 * (VCAP_SERVICES on SAP BTP) or AICORE_SERVICE_KEY environment variable.
 * @param options - Provider configuration options.
 * @returns A configured SAP AI provider instance.
 */
export function createSAPAIProvider(options: SAPAIProviderSettings = {}): SAPAIProviderV2 {
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

  const createModel = (modelId: SAPAIModelId, settings: SAPAISettings = {}) => {
    const mergedSettings: SAPAISettings = {
      ...options.defaultSettings,
      ...settings,
      filtering: settings.filtering ?? options.defaultSettings?.filtering,
      masking: settings.masking ?? options.defaultSettings?.masking,
      modelParams: deepMerge(
        options.defaultSettings?.modelParams ?? {},
        settings.modelParams ?? {},
      ),
      tools: settings.tools ?? options.defaultSettings?.tools,
    };

    return new SAPAILanguageModelV2(modelId, mergedSettings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.chat`,
    });
  };

  const createEmbeddingModel = (
    modelId: SAPAIEmbeddingModelId,
    settings: SAPAIEmbeddingSettings = {},
  ): SAPAIEmbeddingModelV2 => {
    return new SAPAIEmbeddingModelV2(modelId, settings, {
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

  provider.chat = createModel;
  provider.languageModel = createModel;
  provider.textEmbeddingModel = createEmbeddingModel;

  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({
      message: `SAP AI Core Orchestration Service does not support image generation. Model '${modelId}' is not available.`,
      modelId,
      modelType: "imageModel",
    });
  };

  return provider as SAPAIProviderV2;
}

/** Default SAP AI provider instance with automatic authentication via SAP AI SDK. */
export const sapai = createSAPAIProvider();
