/**
 * SAP AI Language Model - Vercel AI SDK LanguageModelV3 implementation for SAP AI Core.
 *
 * This module provides the language model implementation that connects to SAP AI Core
 * services (Orchestration, Foundation Models Chat Completions, or OpenAI Responses)
 * for text generation and streaming.
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/generate-text | Vercel AI SDK generateText()}
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text | Vercel AI SDK streamText()}
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider-v3";

import type { LanguageModelInvocationConfig } from "./language-model-invocation.js";
import type { SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import { prepareLanguageModelInvocation } from "./language-model-invocation.js";
import { validateModelParamsSettings } from "./sap-ai-provider-options.js";

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV3.
 *
 * This class provides text generation and streaming through SAP AI Core using
 * Orchestration (with content filtering, grounding, masking, and translation),
 * Foundation Models Chat Completions, or native OpenAI Responses.
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

  get provider(): string {
    return this.config.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {
      "image/*": [/^https:\/\/.+$/i, /^data:image\/.*$/],
    };
  }

  /** @internal */
  private readonly config: LanguageModelInvocationConfig;

  /** @internal */
  private readonly settings: SAPAISettings;

  /**
   * @param modelId - Model identifier.
   * @param settings - Model settings.
   * @param config - Model configuration.
   * @internal
   */
  constructor(
    modelId: SAPAIModelId,
    settings: SAPAISettings,
    config: LanguageModelInvocationConfig,
  ) {
    if (settings.modelParams) {
      validateModelParamsSettings(settings.modelParams);
    }
    this.settings = settings;
    this.config = config;
    this.modelId = modelId;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { selected, strategyConfig } = await prepareLanguageModelInvocation(
      this.modelId,
      this.settings,
      this.config,
      options.providerOptions,
    );
    const result = selected.strategy.doGenerate(strategyConfig, this.settings, options);
    // Bridge readonly strategy JSON to the mutable V3 contract without copying.
    return result as Promise<LanguageModelV3GenerateResult>;
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { selected, strategyConfig } = await prepareLanguageModelInvocation(
      this.modelId,
      this.settings,
      this.config,
      options.providerOptions,
    );
    const result = selected.strategy.doStream(strategyConfig, this.settings, options);
    // Preserve the stream itself while exposing AI SDK 6's mutable JSON contract.
    return result as Promise<LanguageModelV3StreamResult>;
  }

  supportsUrl(url: URL): boolean {
    if (url.protocol === "https:") return true;
    if (url.protocol === "data:") {
      return /^data:image\//i.test(url.href);
    }
    return false;
  }
}
