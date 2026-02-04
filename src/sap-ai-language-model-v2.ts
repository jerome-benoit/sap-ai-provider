/**
 * SAP AI Language Model V2 - Vercel AI SDK LanguageModelV2 implementation for SAP AI Core.
 *
 * This module provides the language model implementation that connects to SAP AI Core
 * services (Orchestration API or Foundation Models API) for text generation.
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/generate-text | Vercel AI SDK generateText()}
 * @see {@link https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text | Vercel AI SDK streamText()}
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2ResponseMetadata,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  SharedV2Headers,
  SharedV2ProviderMetadata,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import type { SAPAIApiType, SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import {
  convertFinishReasonToV2,
  convertStreamToV2,
  convertUsageToV2,
  convertWarningsToV2,
} from "./sap-ai-adapters-v3-to-v2.js";
import { SAPAILanguageModel as SAPAILanguageModelInternal } from "./sap-ai-language-model.js";

/** @internal */
interface SAPAILanguageModelV2Config {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
}

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV2.
 *
 * This class provides chat completion and streaming capabilities through SAP AI Core,
 * supporting both the Orchestration API (with content filtering, grounding, masking,
 * and translation) and Foundation Models API (direct Azure OpenAI access).
 *
 * Users typically don't instantiate this class directly. Instead, use the
 * {@link createSAPAIProvider} factory function:
 * @example
 * ```typescript
 * import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
 * import { generateText, streamText } from "ai";
 *
 * const provider = createSAPAIProvider();
 * const model = provider("gpt-4o");
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

  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
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
    warnings: LanguageModelV2CallWarning[];
  }> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const result = await this.internalModel.doGenerate(options as any);

    // Return result in V2 format
    return {
      content: result.content as LanguageModelV2Content[],
      finishReason: convertFinishReasonToV2(result.finishReason),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      providerMetadata: result.providerMetadata as any,
      request: result.request,
      response: result.response
        ? {
            body: result.response.body,
            headers: result.response.headers as SharedV2Headers | undefined,
            id: result.response.id,
            modelId: result.response.modelId,
            timestamp: result.response.timestamp,
          }
        : undefined,
      usage: convertUsageToV2(result.usage),
      warnings: convertWarningsToV2(result.warnings),
    };
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<{
    request?: {
      body?: unknown;
    };
    response?: {
      headers?: SharedV2Headers;
    };
    stream: ReadableStream<LanguageModelV2StreamPart>;
  }> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const result = await this.internalModel.doStream(options as any);

    // Transform stream to V2 format
    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        try {
          for await (const part of convertStreamToV2(result.stream)) {
            controller.enqueue(part);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return {
      request: result.request,
      response: result.response
        ? {
            headers: result.response.headers as SharedV2Headers | undefined,
          }
        : undefined,
      stream,
    };
  }
}
