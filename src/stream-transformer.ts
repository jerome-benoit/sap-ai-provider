/**
 * Stream transformer for converting SAP AI SDK streaming responses
 * into Vercel AI SDK LanguageModelV3StreamPart events.
 */
import type {
  JSONArray,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { convertAsyncIteratorToReadableStream } from "@ai-sdk/provider-utils";

import type {
  SDKCitation,
  SDKDeltaToolCall,
  SDKStreamChunk,
  SDKTokenUsage,
} from "./strategy-utils.js";

import {
  buildAnthropicCacheMetadata,
  createAISDKRequestBodySummary,
  mapFinishReason,
  mapTokenUsage,
} from "./strategy-utils.js";

/**
 * @internal
 */
export interface StreamState {
  activeText: boolean;
  finishReason: LanguageModelV3FinishReason;
  isFirstChunk: boolean;
  usage: LanguageModelV3Usage;
}

/**
 * @internal
 */
export interface StreamTransformerConfig {
  readonly convertToAISDKError: (
    error: unknown,
    context: { operation: string; requestBody: unknown; url: string },
  ) => unknown;
  readonly idGenerator: StreamIdGenerator;
  readonly includeRawChunks: boolean;
  readonly modelId: string;
  readonly options: LanguageModelV3CallOptions;
  readonly providerName: string;
  readonly responseHeaders?: Record<string, string>;
  readonly responseId: string;
  readonly sdkStream: AsyncIterable<SDKStreamChunk>;
  readonly streamResponseGetCitations?: () => SDKCitation[] | undefined;
  readonly streamResponseGetFinishReason: () => null | string | undefined;
  readonly streamResponseGetIntermediateFailures?: () => undefined | unknown[];
  readonly streamResponseGetTokenUsage: () => null | SDKTokenUsage | undefined;
  readonly url: string;
  readonly version: string;
  readonly warnings: readonly SharedV3Warning[];
}

/**
 * @internal
 */
export interface ToolCallInProgress {
  arguments: string;
  didEmitCall: boolean;
  didEmitInputStart: boolean;
  id: string | undefined;
  toolName?: string;
}

/**
 * @internal
 */
export class StreamIdGenerator {
  /**
   * @returns A UUID string for identifying the response.
   */
  generateResponseId(): string {
    return crypto.randomUUID();
  }

  /**
   * @returns A UUID string for identifying a text block.
   */
  generateTextBlockId(): string {
    return crypto.randomUUID();
  }

  /**
   * @returns A UUID string for identifying a tool call when the API does not provide one.
   */
  generateToolCallId(): string {
    return crypto.randomUUID();
  }
}

/**
 * Creates the initial stream state for processing streaming responses.
 * @returns The initial stream state object.
 * @internal
 */
export function createInitialStreamState(): StreamState {
  return {
    activeText: false,
    finishReason: {
      raw: undefined,
      unified: "other" as const,
    },
    isFirstChunk: true,
    usage: {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: undefined,
        total: undefined,
      },
      outputTokens: {
        reasoning: undefined,
        text: undefined,
        total: undefined,
      },
    },
  };
}

/**
 * Creates a ReadableStream that transforms SAP AI SDK streaming responses
 * into Vercel AI SDK LanguageModelV3StreamPart events.
 * @param config - The stream transformer configuration containing all dependencies.
 * @returns A ReadableStream of LanguageModelV3StreamPart events.
 * @internal
 */
export function createStreamTransformer(
  config: StreamTransformerConfig,
): ReadableStream<LanguageModelV3StreamPart> {
  const {
    convertToAISDKError,
    idGenerator,
    includeRawChunks,
    modelId,
    options,
    providerName,
    responseHeaders,
    responseId,
    sdkStream,
    streamResponseGetCitations,
    streamResponseGetFinishReason,
    streamResponseGetIntermediateFailures,
    streamResponseGetTokenUsage,
    url,
    version,
    warnings,
  } = config;

  let textBlockId: null | string = null;
  const streamState = createInitialStreamState();
  const toolCallsInProgress = new Map<number, ToolCallInProgress>();

  /**
   * Emits tool-input-start and replays any buffered arguments as a delta.
   * @param tc - The in-progress tool call state.
   * @param controller - The transform stream controller to enqueue events into.
   */
  function emitToolInputStart(
    tc: ToolCallInProgress,
    controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  ): void {
    if (tc.didEmitInputStart || tc.id == null) return;
    tc.didEmitInputStart = true;
    controller.enqueue({
      id: tc.id,
      toolName: tc.toolName ?? "",
      type: "tool-input-start",
    });
    if (tc.arguments.length > 0) {
      controller.enqueue({
        delta: tc.arguments,
        id: tc.id,
        type: "tool-input-delta",
      });
    }
  }

  return convertAsyncIteratorToReadableStream(
    safeIterate(sdkStream)[Symbol.asyncIterator](),
  ).pipeThrough(
    new TransformStream<Error | SDKStreamChunk, LanguageModelV3StreamPart>({
      flush(controller) {
        const didEmitAnyToolCalls = finalizeToolCalls(
          controller,
          toolCallsInProgress,
          idGenerator,
          emitToolInputStart,
        );

        if (streamState.activeText && textBlockId) {
          controller.enqueue({ id: textBlockId, type: "text-end" });
        }

        const finalFinishReason = streamResponseGetFinishReason();
        if (finalFinishReason) {
          streamState.finishReason = mapFinishReason(finalFinishReason);
        } else if (didEmitAnyToolCalls) {
          streamState.finishReason = {
            raw: undefined,
            unified: "tool-calls",
          };
        }

        const finalUsage = streamResponseGetTokenUsage();
        if (finalUsage) {
          const mapped = mapTokenUsage(finalUsage);
          streamState.usage.inputTokens = mapped.inputTokens;
          streamState.usage.outputTokens = mapped.outputTokens;
        }

        const streamCitations = streamResponseGetCitations?.();
        if (streamCitations?.length) {
          for (const citation of streamCitations) {
            controller.enqueue({
              id: String(citation.ref_id ?? citation.url),
              sourceType: "url" as const,
              title: citation.title,
              type: "source",
              url: citation.url,
            });
          }
        }

        const streamIntermediateFailures = streamResponseGetIntermediateFailures?.();

        controller.enqueue({
          finishReason: streamState.finishReason,
          providerMetadata: {
            [providerName]: {
              ...buildAnthropicCacheMetadata(finalUsage),
              finishReason: streamState.finishReason.raw,
              ...(streamIntermediateFailures?.length
                ? {
                    intermediateFailures: streamIntermediateFailures as JSONArray,
                  }
                : {}),
              ...(typeof responseHeaders?.["x-request-id"] === "string"
                ? { requestId: responseHeaders["x-request-id"] }
                : {}),
              responseId,
              version,
            },
          },
          type: "finish",
          usage: streamState.usage,
        });
      },

      start(controller) {
        controller.enqueue({
          type: "stream-start",
          warnings: [...warnings],
        });
      },

      transform(chunk, controller) {
        if (chunk instanceof Error) {
          handleStreamError(chunk, controller, convertToAISDKError, options, url);
          return;
        }

        if (includeRawChunks) {
          controller.enqueue({
            rawValue: (chunk as { _data?: unknown })._data ?? chunk,
            type: "raw",
          });
        }

        if (streamState.isFirstChunk) {
          streamState.isFirstChunk = false;
          controller.enqueue({
            id: responseId,
            modelId,
            timestamp: new Date(),
            type: "response-metadata",
          });
        }

        const deltaToolCalls = chunk.getDeltaToolCalls();
        if (Array.isArray(deltaToolCalls) && deltaToolCalls.length > 0) {
          streamState.finishReason = {
            raw: undefined,
            unified: "tool-calls",
          };
        }

        const deltaContent = chunk.getDeltaContent();
        if (
          typeof deltaContent === "string" &&
          deltaContent.length > 0 &&
          streamState.finishReason.unified !== "tool-calls"
        ) {
          textBlockId = handleTextDelta(
            deltaContent,
            controller,
            streamState,
            textBlockId,
            idGenerator,
          );
        }

        if (Array.isArray(deltaToolCalls) && deltaToolCalls.length > 0) {
          handleToolCallDeltas(deltaToolCalls, controller, toolCallsInProgress, emitToolInputStart);
        }

        const chunkFinishReason = chunk.getFinishReason();
        if (chunkFinishReason) {
          streamState.finishReason = mapFinishReason(chunkFinishReason);

          if (streamState.finishReason.unified === "tool-calls") {
            finalizeToolCalls(controller, toolCallsInProgress, idGenerator, emitToolInputStart);

            if (streamState.activeText && textBlockId) {
              controller.enqueue({ id: textBlockId, type: "text-end" });
              streamState.activeText = false;
            }
          }
        }
      },
    }),
  );
}

/**
 * Finalizes pending tool calls by emitting tool-input-end and tool-call events.
 * @param controller - The transform stream controller.
 * @param toolCallsInProgress - Map of in-progress tool calls.
 * @param idGenerator - ID generator for tool calls without IDs.
 * @param emitToolInputStart - Function to emit tool-input-start events.
 * @returns Whether any tool calls were finalized.
 * @internal
 */
function finalizeToolCalls(
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  toolCallsInProgress: Map<number, ToolCallInProgress>,
  idGenerator: StreamIdGenerator,
  emitToolInputStart: (
    tc: ToolCallInProgress,
    ctrl: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  ) => void,
): boolean {
  const toolCalls = Array.from(toolCallsInProgress.values());
  let didEmitAnyToolCalls = false;

  for (const tc of toolCalls) {
    if (tc.didEmitCall) {
      continue;
    }

    tc.id ??= idGenerator.generateToolCallId();
    emitToolInputStart(tc, controller);

    didEmitAnyToolCalls = true;
    tc.didEmitCall = true;
    controller.enqueue({ id: tc.id, type: "tool-input-end" });
    controller.enqueue({
      input: tc.arguments,
      toolCallId: tc.id,
      toolName: tc.toolName ?? "",
      type: "tool-call",
    });
  }

  return didEmitAnyToolCalls;
}

/**
 * Handles a stream error by converting it and enqueuing an error event.
 * @param error - The error from the stream iteration.
 * @param controller - The transform stream controller.
 * @param convertToAISDKError - Error conversion function.
 * @param options - Language model call options for context.
 * @param url - The request URL for error context.
 * @internal
 */
function handleStreamError(
  error: Error,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  convertToAISDKError: StreamTransformerConfig["convertToAISDKError"],
  options: LanguageModelV3CallOptions,
  url: string,
): void {
  const aiError = convertToAISDKError(error, {
    operation: "doStream",
    requestBody: createAISDKRequestBodySummary(options),
    url,
  });
  controller.enqueue({
    error: aiError instanceof Error ? aiError : new Error(String(aiError)),
    type: "error",
  });
  controller.terminate();
}

/**
 * Handles a text delta by managing text block lifecycle.
 * @param deltaContent - The text delta content.
 * @param controller - The transform stream controller.
 * @param streamState - The current stream state.
 * @param currentTextBlockId - The current text block ID (or null).
 * @param idGenerator - ID generator for new text blocks.
 * @returns The current text block ID (may be newly created).
 * @internal
 */
function handleTextDelta(
  deltaContent: string,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  streamState: StreamState,
  currentTextBlockId: null | string,
  idGenerator: StreamIdGenerator,
): string {
  let textBlockId = currentTextBlockId;
  if (!streamState.activeText) {
    textBlockId = idGenerator.generateTextBlockId();
    controller.enqueue({ id: textBlockId, type: "text-start" });
    streamState.activeText = true;
  }
  if (textBlockId) {
    controller.enqueue({
      delta: deltaContent,
      id: textBlockId,
      type: "text-delta",
    });
    return textBlockId;
  }
  return currentTextBlockId ?? idGenerator.generateTextBlockId();
}

/**
 * Handles tool call delta chunks by assembling tool calls progressively.
 * @param deltaToolCalls - The tool call delta chunks from the stream.
 * @param controller - The transform stream controller.
 * @param toolCallsInProgress - Map of in-progress tool calls by index.
 * @param emitToolInputStart - Function to emit tool-input-start events.
 * @internal
 */
function handleToolCallDeltas(
  deltaToolCalls: SDKDeltaToolCall[],
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  toolCallsInProgress: Map<number, ToolCallInProgress>,
  emitToolInputStart: (
    tc: ToolCallInProgress,
    ctrl: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  ) => void,
): void {
  for (const toolCallChunk of deltaToolCalls) {
    const index = toolCallChunk.index;
    if (typeof index !== "number" || !Number.isFinite(index)) {
      continue;
    }

    if (!toolCallsInProgress.has(index)) {
      toolCallsInProgress.set(index, {
        arguments: "",
        didEmitCall: false,
        didEmitInputStart: false,
        id:
          typeof toolCallChunk.id === "string" && toolCallChunk.id.length > 0
            ? toolCallChunk.id
            : undefined,
        toolName: toolCallChunk.function?.name,
      });
    }

    const tc = toolCallsInProgress.get(index);
    if (!tc) continue;

    if (
      typeof toolCallChunk.id === "string" &&
      toolCallChunk.id.length > 0 &&
      tc.id === undefined
    ) {
      tc.id = toolCallChunk.id;
    }

    const nextToolName = toolCallChunk.function?.name;
    if (typeof nextToolName === "string" && nextToolName.length > 0) {
      tc.toolName = nextToolName;
    }

    if (!tc.didEmitInputStart && tc.toolName != null && tc.id != null) {
      emitToolInputStart(tc, controller);
    }

    const argumentsDelta = toolCallChunk.function?.arguments;
    if (typeof argumentsDelta === "string" && argumentsDelta.length > 0) {
      tc.arguments += argumentsDelta;

      if (tc.didEmitInputStart && tc.id != null) {
        controller.enqueue({
          delta: argumentsDelta,
          id: tc.id,
          type: "tool-input-delta",
        });
      }
    }
  }
}

/**
 * Wraps an async iterable to catch iteration errors and yield them as values.
 *
 * Intentionally single-error: after yielding the first Error, this generator completes.
 * The downstream TransformStream terminates via `controller.error()` on receiving an Error,
 * so no further values would be consumed. This is a cooperative contract — the stream
 * pipeline guarantees no reads after the first error event.
 * @param iterable - The async iterable to wrap.
 * @yields {Error | T} Original values or Error instances for caught exceptions.
 * @internal
 */
async function* safeIterate<T>(iterable: AsyncIterable<T>): AsyncGenerator<Error | T> {
  try {
    yield* iterable;
  } catch (error) {
    yield error instanceof Error ? error : new Error(String(error));
  }
}
