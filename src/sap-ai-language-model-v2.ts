/**
 * SAP AI Language Model V2 implementation.
 *
 * This module provides a LanguageModelV2 facade that wraps the internal
 * LanguageModelV3 implementation and transforms the output to V2 format.
 *
 * This approach allows us to:
 * - Reuse all SAP AI Core business logic from the V3 implementation
 * - Present a V2 API to users (compatible with AI SDK 5.x)
 * - Keep the upstream V3 code unchanged for easy git merges
 * @module sap-ai-language-model-v2
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
} from "./sap-ai-adapters-v3-to-v2";
import { SAPAILanguageModel as SAPAILanguageModelV3Internal } from "./sap-ai-language-model";
import { SAPAIModelId, SAPAISettings } from "./sap-ai-settings";

/**
 * Internal configuration for the SAP AI Language Model.
 * @internal
 */
interface SAPAIConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
}

/**
 * SAP AI Language Model V2 implementation.
 *
 * This class implements the AI SDK's `LanguageModelV2` interface (for AI SDK 5.x),
 * providing a bridge between AI SDK 5.x and SAP AI Core's Orchestration API
 * using the official SAP AI SDK (@sap-ai-sdk/orchestration).
 *
 * **Architecture:**
 * This is a thin facade that delegates to the internal V3 implementation
 * (SAPAILanguageModel) and transforms the output to V2 format.
 *
 * **Features:**
 * - Text generation (streaming and non-streaming)
 * - Tool calling (function calling)
 * - Multi-modal input (text + images)
 * - Data masking (SAP DPI)
 * - Content filtering
 *
 * **Model Support:**
 * - Azure OpenAI models (gpt-4o, gpt-4o-mini, o1, o3, etc.)
 * - Google Vertex AI models (gemini-2.0-flash, gemini-2.5-pro, etc.)
 * - AWS Bedrock models (anthropic--claude-*, amazon--nova-*, etc.)
 * - AI Core open source models (mistralai--, cohere--, etc.)
 * @see {@link https://sdk.vercel.ai/docs/ai-sdk-core/language-model-v2 Vercel AI SDK LanguageModelV2}
 * @see {@link https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/orchestration SAP AI Core Orchestration}
 * @example
 * ```typescript
 * // Create via provider
 * const provider = createSAPAIProvider();
 * const model = provider('gpt-4o');
 *
 * // Use with AI SDK 5.x
 * const result = await generateText({
 *   model,
 *   prompt: 'Hello, world!'
 * });
 * ```
 */
export class SAPAILanguageModelV2 implements LanguageModelV2 {
  readonly modelId: SAPAIModelId;
  readonly specificationVersion = "v2" as const;

  /**
   * Returns the provider identifier.
   * @returns The provider name
   */
  get provider(): string {
    return this.v3Model.provider;
  }

  /**
   * Returns supported URL patterns for different content types.
   * @returns Record of content types to regex patterns
   */
  get supportedUrls(): Record<string, RegExp[]> {
    return this.v3Model.supportedUrls;
  }

  /** Internal V3 model instance that handles all SAP AI Core logic */
  private readonly v3Model: SAPAILanguageModelV3Internal;

  /**
   * Creates a new SAP AI Language Model V2 instance.
   * @internal
   * @param modelId - The model identifier
   * @param settings - Model-specific configuration settings
   * @param config - Internal configuration (deployment config, destination, etc.)
   * @throws {z.ZodError} If modelParams contains invalid values
   */
  constructor(modelId: SAPAIModelId, settings: SAPAISettings, config: SAPAIConfig) {
    this.modelId = modelId;
    // Delegate to internal V3 implementation
    this.v3Model = new SAPAILanguageModelV3Internal(modelId, settings, config);
  }

  /**
   * Generates a single completion (non-streaming).
   *
   * This method implements the `LanguageModelV2.doGenerate` interface,
   * delegating to the internal V3 implementation and transforming the result
   * to V2 format.
   *
   * **Features:**
   * - Tool calling support
   * - Multi-modal input (text + images)
   * - Data masking (if configured)
   * - Content filtering (if configured)
   * - Abort signal support (via Promise.race)
   *
   * **Note on Abort Signal:**
   * The abort signal implementation uses Promise.race to reject the promise when
   * aborted. However, this does not cancel the underlying HTTP request to SAP AI Core -
   * the request continues executing on the server. This is a current limitation of the
   * SAP AI SDK's API. See https://github.com/SAP/ai-sdk-js/issues/1429
   * @param options - Generation options including prompt, tools, and settings
   * @returns Promise resolving to the generation result with content, usage, and metadata
   * @see {@link convertFinishReasonV3ToV2} for finish reason transformation
   * @see {@link convertUsageV3ToV2} for usage statistics transformation
   * @see {@link convertWarningsV3ToV2} for warnings transformation
   * @since 1.0.0
   * @example
   * ```typescript
   * const result = await model.doGenerate({
   *   prompt: [
   *     { role: 'user', content: [{ type: 'text', text: 'Hello!' }] }
   *   ]
   * });
   *
   * console.log(result.content);      // Generated content
   * console.log(result.usage);        // Token usage (V2 format)
   * console.log(result.finishReason); // 'stop' (V2 string format)
   * ```
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
   * Generates a streaming completion.
   *
   * Implements `LanguageModelV2.doStream`, delegating to the internal V3 implementation
   * and transforming the stream to V2 format.
   *
   * **Stream Events:**
   * - `stream-start` - Initialization with warnings
   * - `response-metadata` - Model, timestamp, response ID
   * - `text-start` - Text block begins (with unique ID)
   * - `text-delta` - Incremental text chunks
   * - `text-end` - Text block completes
   * - `tool-input-start/delta/end` - Tool input lifecycle
   * - `tool-call` - Complete tool call
   * - `finish` - Stream completes with usage (V2 format) and finish reason (V2 string)
   * - `error` - Error occurred
   *
   * **Response ID:**
   * Client-generated UUID in `response-metadata.id` and `providerMetadata['sap-ai'].responseId`.
   * TODO: Use backend's `x-request-id` when `OrchestrationStreamResponse` exposes `rawResponse`.
   * @see https://github.com/SAP/ai-sdk-js/issues/1429 - Enhancement request for rawResponse access
   *
   * **Abort Signal:**
   * Same limitation as `doGenerate` - see its documentation for details.
   * @see {@link https://sdk.vercel.ai/docs/ai-sdk-core/streaming Vercel AI SDK Streaming}
   * @see {@link convertStreamV3ToV2} for stream transformation logic
   * @see {@link convertStreamPartV3ToV2} for individual stream part conversion
   * @param options - Streaming options including prompt, tools, and settings
   * @returns Promise resolving to stream and request metadata
   * @example
   * ```typescript
   * const { stream } = await model.doStream({
   *   prompt: [
   *     { role: 'user', content: [{ type: 'text', text: 'Write a story' }] }
   *   ]
   * });
   *
   * for await (const part of stream) {
   *   if (part.type === 'text-delta') {
   *     process.stdout.write(part.delta);
   *   }
   * }
   * ```
   * @since 1.0.0
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
