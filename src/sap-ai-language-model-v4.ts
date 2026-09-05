/**
 * SAP AI Language Model V4 - Vercel AI SDK LanguageModelV4 implementation for SAP AI Core.
 *
 * This module provides the language model implementation that connects to SAP AI Core
 * services (Orchestration API or Foundation Models API) for chat completions and streaming.
 * It wraps the internal V3 model: V4 prompts are normalized on entry and V3
 * results are converted on exit.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { SAPAIApiType, SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import {
  convertGenerateResultToV4,
  createV4StreamFromInternal,
} from "./sap-ai-adapters-v3-to-v4.js";
import { normalizeV4PromptToV3 } from "./sap-ai-adapters-v4-to-v3.js";
import { SAPAILanguageModel as SAPAILanguageModelInternal } from "./sap-ai-language-model.js";

type InternalLanguageModelCallOptions = LanguageModelV3CallOptions & {
  readonly reasoning?: Exclude<
    LanguageModelV4CallOptions["reasoning"],
    "provider-default" | undefined
  >;
};

/** @internal */
interface SAPAILanguageModelV4Config {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
  readonly requestConfig?: CustomRequestConfig;
}

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV4.
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * V4 provider factory.
 */
export class SAPAILanguageModelV4 implements LanguageModelV4 {
  readonly modelId: SAPAIModelId;
  readonly specificationVersion = "v4" as const;

  get provider(): string {
    return this.internalModel.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return this.internalModel.supportedUrls;
  }

  /** @internal */
  private readonly internalModel: SAPAILanguageModelInternal;

  /**
   * @param modelId - Model identifier.
   * @param settings - Model settings.
   * @param config - Model configuration.
   * @internal
   */
  constructor(modelId: SAPAIModelId, settings: SAPAISettings, config: SAPAILanguageModelV4Config) {
    this.modelId = modelId;
    this.internalModel = new SAPAILanguageModelInternal(modelId, settings, config);
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const result = await this.internalModel.doGenerate(normalizeCallOptions(options));
    const converted = convertGenerateResultToV4(result);
    return {
      ...converted,
      providerMetadata: result.providerMetadata,
      request: result.request,
      response: result.response,
      warnings: converted.warnings,
    };
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const result = await this.internalModel.doStream(normalizeCallOptions(options));
    return {
      request: result.request,
      response: result.response,
      stream: createV4StreamFromInternal(result.stream),
    };
  }
}

/**
 * Normalizes V4 call options to the internal V3-compatible shape.
 * @param options - V4 model call options.
 * @returns Internal call options with V4 reasoning available to the SAP strategies.
 */
function normalizeCallOptions(
  options: LanguageModelV4CallOptions,
): InternalLanguageModelCallOptions {
  const { prompt, reasoning, ...rest } = options;
  return {
    ...rest,
    ...(reasoning !== undefined && reasoning !== "provider-default" ? { reasoning } : {}),
    prompt: normalizeV4PromptToV3(prompt),
  };
}
