/**
 * SAP AI Language Model - Vercel AI SDK LanguageModelV3 implementation for SAP AI Core.
 *
 * This module provides the language model implementation that connects to SAP AI Core
 * services (Orchestration API or Foundation Models API) for chat completions and streaming.
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/generate-text | Vercel AI SDK generateText()}
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text | Vercel AI SDK streamText()}
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { SAPAIApiType, SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import {
  getProviderName,
  sapAILanguageModelProviderOptions,
  validateModelParamsSettings,
} from "./sap-ai-provider-options.js";
import {
  getOrCreateLanguageModelStrategy,
  type LanguageModelAPIStrategy,
  type LanguageModelStrategyConfig,
} from "./sap-ai-strategy.js";
import { resolveApi, validateSettings } from "./sap-ai-validation.js";

/** @internal */
interface SAPAILanguageModelConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV3.
 *
 * This class provides chat completion and streaming capabilities through SAP AI Core,
 * supporting both the Orchestration API (with content filtering, grounding, masking,
 * and translation) and Foundation Models API (direct Azure OpenAI access).
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * {@link createSAPAIProvider} factory function:
 * @example
 * ```typescript
 * import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
 * import { generateText, streamText } from "ai";
 *
 * const provider = createSAPAIProvider();
 * const model = provider("gpt-4.1");
 *
 * // Non-streaming
 * const { text } = await generateText({
 *   model,
 *   prompt: "Hello!",
 * });
 *
 * // Streaming
 * const result = streamText({
 *   model,
 *   prompt: "Tell me a story",
 * });
 *
 * for await (const chunk of result.textStream) {
 *   process.stdout.write(chunk);
 * }
 * ```
 * @see {@link https://sdk.vercel.ai/docs/ai-sdk-core/generating-text | Vercel AI SDK Text Generation}
 * @see {@link createSAPAIProvider} - Factory function to create provider instances
 */
export class SAPAILanguageModel implements LanguageModelV3 {
  readonly modelId: SAPAIModelId;
  readonly specificationVersion = "v3";
  readonly supportsImageUrls: boolean = true;
  readonly supportsMultipleCompletions: boolean = true;
  readonly supportsParallelToolCalls: boolean = true;
  readonly supportsStreaming: boolean = true;
  readonly supportsStructuredOutputs: boolean = true;
  readonly supportsToolCalls: boolean = true;

  get provider(): string {
    return this.config.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {
      "image/*": [/^https:\/\/.+$/i, /^data:image\/.*$/],
    };
  }

  /** @internal */
  private readonly config: SAPAILanguageModelConfig;

  /** @internal */
  private readonly settings: SAPAISettings;

  /**
   * @param modelId - Model identifier.
   * @param settings - Model settings.
   * @param config - Model configuration.
   * @internal
   */
  constructor(modelId: SAPAIModelId, settings: SAPAISettings, config: SAPAILanguageModelConfig) {
    if (settings.modelParams) {
      validateModelParamsSettings(settings.modelParams);
    }
    this.settings = settings;
    this.config = config;
    this.modelId = modelId;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { strategy, strategyConfig } = await this.prepareInvocation(options);
    return strategy.doGenerate(strategyConfig, this.settings, options);
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { strategy, strategyConfig } = await this.prepareInvocation(options);
    return strategy.doStream(strategyConfig, this.settings, options);
  }

  supportsUrl(url: URL): boolean {
    if (url.protocol === "https:") return true;
    if (url.protocol === "data:") {
      return /^data:image\//i.test(url.href);
    }
    return false;
  }

  /**
   * Prepares common invocation context for doGenerate and doStream.
   * @param options - AI SDK call options.
   * @returns Strategy and configuration for the invocation.
   * @internal
   */
  private async prepareInvocation(options: LanguageModelV3CallOptions): Promise<{
    strategy: LanguageModelAPIStrategy;
    strategyConfig: LanguageModelStrategyConfig;
  }> {
    const providerName = getProviderName(this.config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const effectiveApi = resolveApi(this.config.providerApi, this.settings.api, sapOptions?.api);

    validateSettings({
      api: effectiveApi,
      invocationSettings: sapOptions
        ? {
            api: sapOptions.api,
            escapeTemplatePlaceholders: sapOptions.escapeTemplatePlaceholders,
            orchestrationConfigRef: sapOptions.orchestrationConfigRef,
            placeholderValues: sapOptions.placeholderValues,
            promptTemplateRef: sapOptions.promptTemplateRef,
          }
        : undefined,
      modelApi: this.settings.api,
      modelSettings: this.settings,
    });

    const strategy = await getOrCreateLanguageModelStrategy(effectiveApi);

    const strategyConfig: LanguageModelStrategyConfig = {
      deploymentConfig: this.config.deploymentConfig,
      destination: this.config.destination,
      modelId: this.modelId,
      provider: this.config.provider,
    };

    return { strategy, strategyConfig };
  }
}
