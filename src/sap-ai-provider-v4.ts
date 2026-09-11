/**
 * SAP AI Provider V4 - Vercel AI SDK ProviderV4 implementation for SAP AI Core.
 *
 * Factory for LanguageModelV4 / EmbeddingModelV4 instances. Shared
 * configuration plumbing (validation, settings merge, deployment config)
 * is reused from the V3 provider modules.
 */

import type { ImageModelV4, ProviderV4 } from "@ai-sdk/provider";

import { NoSuchModelError } from "@ai-sdk/provider";
import { setGlobalLogLevel } from "@sap-cloud-sdk/util";

import type { SAPAIEmbeddingModelId } from "./sap-ai-embedding-model.js";
import type { DeploymentConfig, SAPAIProviderSettings } from "./sap-ai-provider.js";
import type { SAPAIEmbeddingSettings } from "./sap-ai-settings.js";
import type { SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import { SAPAIEmbeddingModelV4 } from "./sap-ai-embedding-model-v4.js";
import { SAPAILanguageModelV4 } from "./sap-ai-language-model-v4.js";
import {
  SAP_AI_PROVIDER_NAME,
  validateEmbeddingModelParamsSettings,
  validateModelParamsSettings,
} from "./sap-ai-provider-options.js";
import { mergeSettingsWithApi } from "./sap-ai-validation.js";

export type { DeploymentConfig, SAPAIProviderSettings } from "./sap-ai-provider.js";

/** SAP AI Provider interface extending Vercel AI SDK ProviderV4. */
export interface SAPAIProviderV4 extends ProviderV4 {
  (modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV4;
  chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV4;
  embedding(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModelV4;
  embeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModelV4;
  /** Always throws - SAP AI Core does not support image generation. */
  imageModel(modelId: string): ImageModelV4;
  languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV4;
  textEmbeddingModel(
    modelId: SAPAIEmbeddingModelId,
    settings?: SAPAIEmbeddingSettings,
  ): SAPAIEmbeddingModelV4;
}

/**
 * Creates an SAP AI Provider V4 instance for use with AI SDK 7.
 *
 * Uses the official SAP AI SDK (`@sap-ai-sdk/orchestration` and
 * `@sap-ai-sdk/foundation-models`) for API communication. Authentication is automatic via service binding
 * (VCAP_SERVICES on SAP BTP) or AICORE_SERVICE_KEY environment variable.
 * @param options - Provider configuration options (same as the V3 provider).
 * @returns A configured SAP AI provider instance that can be used as a callable or via methods.
 * @throws {Error} When provider function is called with the `new` keyword.
 * @throws {NoSuchModelError} When `imageModel()` is called (image generation not supported).
 */
export function createSAPAIProviderV4(options: SAPAIProviderSettings = {}): SAPAIProviderV4 {
  if (options.defaultSettings?.modelParams) {
    validateModelParamsSettings(options.defaultSettings.modelParams);
  }

  const providerName = options.name ?? SAP_AI_PROVIDER_NAME;
  const resourceGroup = options.resourceGroup ?? "default";
  const warnOnAmbiguousConfig = options.warnOnAmbiguousConfig ?? true;

  if (warnOnAmbiguousConfig && options.deploymentId && options.resourceGroup) {
    console.warn(
      "createSAPAIProviderV4: both 'deploymentId' and 'resourceGroup' were provided; using 'deploymentId' and ignoring 'resourceGroup'.",
    );
  }

  if (typeof process === "undefined" || !process.env.SAP_CLOUD_SDK_LOG_LEVEL) {
    const logLevel = options.logLevel ?? "warn";
    setGlobalLogLevel(logLevel);
  }

  const deploymentConfig: DeploymentConfig = options.deploymentId
    ? { deploymentId: options.deploymentId }
    : { resourceGroup };

  const providerApi = options.api ?? "orchestration";

  const createModel = (modelId: SAPAIModelId, settings: SAPAISettings = {}) => {
    if (settings.modelParams) {
      validateModelParamsSettings(settings.modelParams);
    }

    const mergedSettings = mergeSettingsWithApi(
      options.defaultSettings as Record<string, unknown> | undefined,
      settings,
      providerApi,
    );

    return new SAPAILanguageModelV4(modelId, mergedSettings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.chat`,
      providerApi,
      requestConfig: options.requestConfig,
    });
  };

  const createEmbeddingModel = (
    modelId: SAPAIEmbeddingModelId,
    settings: SAPAIEmbeddingSettings = {},
  ): SAPAIEmbeddingModelV4 => {
    if (settings.modelParams) {
      validateEmbeddingModelParamsSettings(settings.modelParams);
    }

    const mergedSettings = mergeSettingsWithApi(
      options.defaultSettings as Record<string, unknown> | undefined,
      settings,
      providerApi,
    );

    return new SAPAIEmbeddingModelV4(modelId, mergedSettings, {
      deploymentConfig,
      destination: options.destination,
      provider: `${providerName}.embedding`,
      providerApi,
      requestConfig: options.requestConfig,
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
  provider.embedding = createEmbeddingModel;
  provider.embeddingModel = createEmbeddingModel;
  provider.textEmbeddingModel = createEmbeddingModel;

  provider.imageModel = (modelId: string) => {
    throw new NoSuchModelError({
      message: `SAP AI Core does not support image generation. Model '${modelId}' is not available.`,
      modelId,
      modelType: "imageModel",
    });
  };
  provider.specificationVersion = "v4" as const;
  return provider;
}

/** Default SAP AI provider V4 instance with automatic authentication via SAP AI SDK. */
export const sapaiV4 = createSAPAIProviderV4();
