/**
 * SAP AI Language Model V2 - Vercel AI SDK LanguageModelV2 facade for SAP AI Core Orchestration.
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

import {
  convertFinishReasonV3ToV2,
  convertStreamV3ToV2,
  convertUsageV3ToV2,
  convertWarningsV3ToV2,
} from "./sap-ai-adapters-v3-to-v2.js";
import { SAPAILanguageModel as SAPAILanguageModelV3Internal } from "./sap-ai-language-model.js";
import { SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

/** @internal */
interface SAPAIConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
}

/**
 * SAP AI Language Model V2 implementing Vercel AI SDK LanguageModelV2.
 *
 * Facade delegating to V3 implementation with V2 format transformation.
 * Features: text generation, tool calling, multi-modal input, data masking, content filtering.
 * Supports: Azure OpenAI, Google Vertex AI, AWS Bedrock, AI Core open source models.
 */
export class SAPAILanguageModelV2 implements LanguageModelV2 {
  /** The model identifier. */
  readonly modelId: SAPAIModelId;
  /** The Vercel AI SDK specification version. */
  readonly specificationVersion = "v2" as const;

  /**
   * Gets the provider identifier string.
   * @returns The provider identifier.
   */
  get provider(): string {
    return this.v3Model.provider;
  }

  /**
   * Gets the supported URL patterns for image input.
   * @returns A mapping of MIME type patterns to URL regex patterns.
   */
  get supportedUrls(): Record<string, RegExp[]> {
    return this.v3Model.supportedUrls;
  }

  /** Internal V3 model instance that handles all SAP AI Core logic. */
  private readonly v3Model: SAPAILanguageModelV3Internal;

  /**
   * Creates a new SAP AI Language Model V2 instance.
   * @param modelId - The model identifier (e.g., 'gpt-4', 'claude-3').
   * @param settings - Model configuration settings.
   * @param config - SAP AI Core deployment and destination configuration.
   * @internal
   */
  constructor(modelId: SAPAIModelId, settings: SAPAISettings, config: SAPAIConfig) {
    this.modelId = modelId;
    // Delegate to internal V3 implementation
    this.v3Model = new SAPAILanguageModelV3Internal(modelId, settings, config);
  }

  /**
   * Generates a single completion (non-streaming). Delegates to V3 and transforms result to V2 format.
   * @param options - The Vercel AI SDK generation call options.
   * @returns The generation result with content, usage, and provider metadata.
   */
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
    // Call internal V3 implementation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const v3Result = await this.v3Model.doGenerate(options as any);

    // Transform V3 result to V2 format
    return {
      content: v3Result.content as LanguageModelV2Content[],
      finishReason: convertFinishReasonV3ToV2(v3Result.finishReason),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      providerMetadata: v3Result.providerMetadata as any,
      request: v3Result.request,
      response: v3Result.response
        ? {
            body: v3Result.response.body,
            headers: v3Result.response.headers as SharedV2Headers | undefined,
            id: v3Result.response.id,
            modelId: v3Result.response.modelId,
            timestamp: v3Result.response.timestamp,
          }
        : undefined,
      usage: convertUsageV3ToV2(v3Result.usage),
      warnings: convertWarningsV3ToV2(v3Result.warnings),
    };
  }

  /**
   * Generates a streaming completion. Delegates to V3 and transforms stream to V2 format.
   * @param options - The Vercel AI SDK generation call options.
   * @returns A stream result with readable stream of V2 stream parts.
   */
  async doStream(options: LanguageModelV2CallOptions): Promise<{
    request?: {
      body?: unknown;
    };
    response?: {
      headers?: SharedV2Headers;
    };
    stream: ReadableStream<LanguageModelV2StreamPart>;
  }> {
    // Call internal V3 implementation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const v3Result = await this.v3Model.doStream(options as any);

    // Transform V3 stream to V2 stream
    const v2Stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        try {
          // Convert async generator to stream parts
          for await (const v2Part of convertStreamV3ToV2(v3Result.stream)) {
            controller.enqueue(v2Part);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return {
      request: v3Result.request,
      response: v3Result.response
        ? {
            headers: v3Result.response.headers as SharedV2Headers | undefined,
          }
        : undefined,
      stream: v2Stream,
    };
  }
}
