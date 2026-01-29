import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
/**
 * SAP AI Language Model - Vercel AI SDK LanguageModelV3 implementation for SAP AI Core.
 *
 * This is a thin wrapper that delegates to API-specific strategies (Orchestration or Foundation Models).
 * Strategy selection happens at invocation time using the late-binding pattern.
 */
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
  type LanguageModelStrategyConfig,
} from "./sap-ai-strategy.js";
import { resolveApi, validateSettings } from "./sap-ai-validation.js";

/**
 * Internal configuration for SAP AI Language Model.
 * @internal
 */
interface SAPAILanguageModelConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  /** Provider-level API setting for fallback during API resolution. */
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV3.
 *
 * Features: text generation, tool calling, multi-modal input, data masking, content filtering.
 * Supports: Azure OpenAI, Google Vertex AI, AWS Bedrock, AI Core open source models.
 *
 * This class is a thin wrapper that delegates to API-specific strategies:
 * - Orchestration API: filtering, grounding, masking, translation, SAP-format tools
 * - Foundation Models API: dataSources (Azure On Your Data), logprobs, seed, etc.
 */
export class SAPAILanguageModel implements LanguageModelV3 {
  /** The model identifier. */
  readonly modelId: SAPAIModelId;
  /** The Vercel AI SDK specification version. */
  readonly specificationVersion = "v3";

  /** Whether the model supports image URLs in prompts. */
  readonly supportsImageUrls: boolean = true;
  /** Whether the model supports generating multiple completions. */
  readonly supportsMultipleCompletions: boolean = true;
  /** Whether the model supports parallel tool calls. */
  readonly supportsParallelToolCalls: boolean = true;
  /** Whether the model supports streaming responses. */
  readonly supportsStreaming: boolean = true;
  /** Whether the model supports structured JSON outputs. */
  readonly supportsStructuredOutputs: boolean = true;
  /** Whether the model supports tool/function calling. */
  readonly supportsToolCalls: boolean = true;

  /**
   * Gets the provider identifier string.
   * @returns The provider identifier.
   */
  get provider(): string {
    return this.config.provider;
  }

  /**
   * Gets the supported URL patterns for image input.
   * @returns A mapping of MIME type patterns to URL regex patterns.
   */
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
   * Creates a new SAP AI Language Model instance.
   *
   * This is the main implementation that handles all SAP AI Core orchestration logic.
   * @param modelId - The model identifier (e.g., 'gpt-4o', 'claude-3-5-sonnet', 'gemini-2.0-flash').
   * @param settings - Model configuration settings (temperature, max tokens, filtering, etc.).
   * @param config - SAP AI Core deployment and destination configuration.
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

  /**
   * Generates a single completion (non-streaming).
   *
   * Implements late-binding: resolves API at invocation time, validates settings,
   * gets the appropriate strategy, and delegates the call.
   * Supports request cancellation via AbortSignal at the HTTP transport layer.
   * @param options - The Vercel AI SDK V3 generation call options.
   * @returns The generation result with content, usage, warnings, and provider metadata.
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
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
        ? { api: sapOptions.api, escapeTemplatePlaceholders: sapOptions.escapeTemplatePlaceholders }
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

    return strategy.doGenerate(strategyConfig, this.settings, options);
  }

  /**
   * Generates a streaming completion.
   *
   * Implements late-binding: resolves API at invocation time, validates settings,
   * gets the appropriate strategy, and delegates the call.
   * Supports request cancellation via AbortSignal at the HTTP transport layer.
   * @param options - The Vercel AI SDK V3 generation call options.
   * @returns A stream result with async iterable stream parts.
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
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
        ? { api: sapOptions.api, escapeTemplatePlaceholders: sapOptions.escapeTemplatePlaceholders }
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

    return strategy.doStream(strategyConfig, this.settings, options);
  }

  /**
   * Checks if a URL is supported for image input (HTTPS or data:image/*).
   * @param url - The URL to check.
   * @returns True if the URL is supported for image input.
   */
  supportsUrl(url: URL): boolean {
    if (url.protocol === "https:") return true;
    if (url.protocol === "data:") {
      return /^data:image\//i.test(url.href);
    }
    return false;
  }
}
