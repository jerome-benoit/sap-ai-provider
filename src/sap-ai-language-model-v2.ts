/**
 * SAP AI Language Model V2 - Vercel AI SDK LanguageModelV2 implementation for SAP AI Core.
 *
 * This module provides the language model implementation that connects to SAP AI Core
 * services (Orchestration, Foundation Models Chat Completions, or OpenAI Responses) for text generation.
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/generate-text | Vercel AI SDK generateText()}
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text | Vercel AI SDK streamText()}
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV3CallOptions as StrategyLanguageModelCallOptions,
} from "@ai-sdk/provider";
import type {
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2ResponseMetadata,
  LanguageModelV2Usage,
  SharedV2Headers,
  SharedV2ProviderMetadata,
} from "@ai-sdk/provider-v2";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider-v3";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { ConvertedV2StreamPart, ConvertedV2Warning } from "./sap-ai-adapters-v3-to-v2.js";
import type { SAPAIApiType, SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import { normalizeV2PromptToV3 } from "./sap-ai-adapters-v2-to-v3.js";
import {
  convertUsageToV2,
  convertWarningsToV2,
  createV2StreamFromInternal,
  createV2ToolApprovalError,
} from "./sap-ai-adapters-v3-to-v2.js";
import { SAPAILanguageModel as SAPAILanguageModelInternal } from "./sap-ai-language-model.js";

// AI SDK 6.0 shipped V2 tools with the V3 provider-tool discriminator.
type CompatibleV2CallOptions = Omit<LanguageModelV2CallOptions, "tools"> & {
  tools?: LanguageModelV2CallOptions["tools"] | LanguageModelV3CallOptions["tools"];
};

/** @internal */
interface SAPAILanguageModelV2Config {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
  readonly requestConfig?: CustomRequestConfig;
}

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV2.
 *
 * This class provides chat completion and streaming capabilities through SAP AI Core,
 * supporting the Orchestration API (with content filtering, grounding, masking,
 * and translation), Foundation Models Chat Completions, and native OpenAI Responses
 * through SAP AI Core.
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * {@link createSAPAIProvider} factory function:
 * @example
 * ```typescript
 * import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
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
export class SAPAILanguageModelV2 implements LanguageModelV2 {
  readonly modelId: SAPAIModelId;
  readonly specificationVersion = "v2" as const;

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
  constructor(modelId: SAPAIModelId, settings: SAPAISettings, config: SAPAILanguageModelV2Config) {
    this.modelId = modelId;
    this.internalModel = new SAPAILanguageModelInternal(modelId, settings, config);
  }

  async doGenerate(options: CompatibleV2CallOptions): Promise<{
    content: LanguageModelV2Content[];
    finishReason: LanguageModelV2FinishReason;
    providerMetadata?: SharedV2ProviderMetadata;
    request?: {
      body?: unknown;
    };
    response?: LanguageModelV2ResponseMetadata & {
      body?: unknown;
      headers?: SharedV2Headers;
    };
    usage: LanguageModelV2Usage;
    warnings: ConvertedV2Warning[];
  }> {
    const result = await this.internalModel.doGenerate(normalizeCallOptions(options));
    if (result.content.some((part) => part.type === "tool-approval-request")) {
      throw createV2ToolApprovalError();
    }

    // Return result in V2 format
    return {
      content: result.content as LanguageModelV2Content[],
      finishReason: result.finishReason.unified,
      providerMetadata: result.providerMetadata as SharedV2ProviderMetadata | undefined,
      request: result.request,
      response: result.response,
      usage: convertUsageToV2(result.usage),
      warnings: convertWarningsToV2(result.warnings),
    };
  }

  async doStream(options: CompatibleV2CallOptions): Promise<{
    request?: {
      body?: unknown;
    };
    response?: {
      headers?: SharedV2Headers;
    };
    stream: ReadableStream<ConvertedV2StreamPart>;
  }> {
    const result = await this.internalModel.doStream(normalizeCallOptions(options));

    return {
      request: result.request,
      response: result.response
        ? {
            headers: result.response.headers,
          }
        : undefined,
      stream: createV2StreamFromInternal(result.stream),
    };
  }
}

/**
 * Adapts the V2 prompt while retaining existing tool compatibility behavior.
 * @param options - V2 call options.
 * @returns Call options for the shared V3 core.
 */
function normalizeCallOptions(options: CompatibleV2CallOptions): LanguageModelV3CallOptions {
  const normalized: StrategyLanguageModelCallOptions = {
    ...options,
    prompt: normalizeV2PromptToV3(options.prompt),
    // Legacy provider-defined tools keep their unsupported warning/skip behavior.
    tools: options.tools as LanguageModelV3CallOptions["tools"],
  };
  // Prompt normalization preserves JSON values; only the core's mutable JSON type is narrower.
  return normalized as LanguageModelV3CallOptions;
}
