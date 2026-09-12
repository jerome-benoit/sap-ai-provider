/**
 * Stream transformer for converting SAP AI SDK streaming responses
 * into Vercel AI SDK LanguageModelV3StreamPart events.
 */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

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
  sanitizeAsJSONArray,
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
  readonly cancel: () => void;
  readonly convertToAISDKError: (
    error: unknown,
    context: {
      modelId: string;
      modelType: "languageModel";
      operation: string;
      requestBody: unknown;
      url: string;
    },
  ) => unknown;
  readonly extractChunkMetadata: (chunk: SDKStreamChunk) => {
    requestId?: string;
    responseMetadata: LanguageModelV3ResponseMetadata;
  };
  readonly idGenerator: StreamIdGenerator;
  readonly includeRawChunks: boolean;
  readonly modelId: string;
  readonly options: LanguageModelV3CallOptions;
  readonly providerName: string;
  /** SAP-pipeline request id resolved by `extractResponseMetadata`. */
  readonly requestId?: string;
  readonly responseMetadata: LanguageModelV3ResponseMetadata & { id: string };
  readonly sdkStream: AsyncIterable<SDKStreamChunk>;
  readonly streamResponseGetCitations?: () => SDKCitation[] | undefined;
  readonly streamResponseGetFinishReason: () => null | string | undefined;
  readonly streamResponseGetIntermediateFailures?: () => undefined | unknown[];
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
 * Preserves a caller-provided reason while retaining standard abort classification.
 * @param reason - The original cancellation reason.
 * @returns An AbortError carrying the reason as its cause.
 * @internal
 */
export function createAbortError(reason: unknown): Error {
  const error = new Error("The operation was aborted.", { cause: reason });
  error.name = "AbortError";
  return error;
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
    cancel,
    convertToAISDKError,
    extractChunkMetadata,
    idGenerator,
    includeRawChunks,
    modelId,
    options,
    providerName,
    requestId,
    responseMetadata,
    sdkStream,
    streamResponseGetCitations,
    streamResponseGetFinishReason,
    streamResponseGetIntermediateFailures,
    url,
    version,
    warnings,
  } = config;

  let textBlockId: null | string = null;
  const streamState = createInitialStreamState();
  const toolCallsInProgress = new Map<number, ToolCallInProgress>();
  const resolvedResponseMetadata = { ...responseMetadata };
  let resolvedRequestId = requestId;
  let tokenUsage: SDKTokenUsage | undefined;
  let citations: Map<string, SDKCitation> | undefined;

  /**
   * Retains sources from early chunks when later SDK snapshots omit them.
   * @param incoming - Citations in a chunk or final response.
   */
  function collectCitations(incoming: SDKCitation[] | undefined): void {
    if (!incoming?.length) return;
    citations ??= new Map();
    for (const citation of incoming) {
      citations.set(String(citation.ref_id ?? citation.url), citation);
    }
  }

  /**
   * Combines usage snapshots without losing details omitted by later chunks.
   * @param incoming - Usage in the incoming chunk.
   */
  function collectUsage(incoming: null | SDKTokenUsage | undefined): void {
    if (!incoming) return;
    const promptDetails = tokenUsage?.prompt_tokens_details;
    const incomingPromptDetails = incoming.prompt_tokens_details;
    const completionDetails = tokenUsage?.completion_tokens_details;
    const incomingCompletionDetails = incoming.completion_tokens_details;
    const cacheDetails = promptDetails?.cache_creation_token_details;
    const incomingCacheDetails = incomingPromptDetails?.cache_creation_token_details;
    tokenUsage = {
      ...tokenUsage,
      ...incoming,
      ...(promptDetails || incomingPromptDetails
        ? {
            prompt_tokens_details: {
              ...promptDetails,
              ...incomingPromptDetails,
              ...(cacheDetails || incomingCacheDetails
                ? {
                    cache_creation_token_details: { ...cacheDetails, ...incomingCacheDetails },
                  }
                : {}),
            },
          }
        : {}),
      ...(completionDetails || incomingCompletionDetails
        ? {
            completion_tokens_details: { ...completionDetails, ...incomingCompletionDetails },
          }
        : {}),
    };
  }

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

  const iterator = safeIterate(sdkStream, options.abortSignal)[Symbol.asyncIterator]();
  let canceled = false;
  return new ReadableStream<Error | SDKStreamChunk>({
    async cancel() {
      canceled = true;
      // Abort transport before return(): an async iterator can be waiting on the next chunk.
      cancel();
      await iterator.return(undefined);
    },
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (canceled) return;
      if (done) controller.close();
      else controller.enqueue(value);
    },
  }).pipeThrough(
    new TransformStream<Error | SDKStreamChunk, LanguageModelV3StreamPart>({
      flush(controller) {
        if (options.abortSignal?.aborted) {
          handleStreamError(
            createAbortError(options.abortSignal.reason),
            controller,
            convertToAISDKError,
            options,
            modelId,
            url,
          );
          return;
        }

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

        // Use wire usage snapshots; SAP final aggregation can invent zero totals.
        streamState.usage = mapTokenUsage(tokenUsage);

        collectCitations(streamResponseGetCitations?.());
        if (citations) {
          for (const citation of citations.values()) {
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
              ...buildAnthropicCacheMetadata(tokenUsage),
              finishReason: streamState.finishReason.raw ?? "unknown",
              finishReasonMapped: streamState.finishReason,
              ...(streamIntermediateFailures?.length
                ? {
                    intermediateFailures: sanitizeAsJSONArray(streamIntermediateFailures),
                  }
                : {}),
              ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}),
              responseId: resolvedResponseMetadata.id,
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
        if (options.abortSignal?.aborted && !(chunk instanceof Error)) {
          chunk = createAbortError(options.abortSignal.reason);
        }
        if (chunk instanceof Error) {
          handleStreamError(chunk, controller, convertToAISDKError, options, modelId, url);
          return;
        }

        if (includeRawChunks) {
          controller.enqueue({
            rawValue: (chunk as { _data?: unknown })._data ?? chunk,
            type: "raw",
          });
        }

        const metadata = extractChunkMetadata(chunk);
        if (metadata.requestId) resolvedRequestId = metadata.requestId;
        const incomingMetadata = metadata.responseMetadata;
        const metadataChanged =
          (incomingMetadata.id !== undefined &&
            incomingMetadata.id !== resolvedResponseMetadata.id) ||
          (incomingMetadata.modelId !== undefined &&
            incomingMetadata.modelId !== resolvedResponseMetadata.modelId) ||
          (incomingMetadata.timestamp !== undefined &&
            incomingMetadata.timestamp.getTime() !== resolvedResponseMetadata.timestamp?.getTime());
        Object.assign(resolvedResponseMetadata, incomingMetadata);
        collectUsage(chunk.getTokenUsage?.());
        collectCitations(chunk.getCitations?.());

        if (streamState.isFirstChunk || metadataChanged) {
          streamState.isFirstChunk = false;
          controller.enqueue({
            ...resolvedResponseMetadata,
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
        if (typeof deltaContent === "string" && deltaContent.length > 0) {
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
  let didEmitAnyToolCalls = false;

  for (const tc of toolCallsInProgress.values()) {
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
 * @param modelId - Model identifier for error classification.
 * @param url - The request URL for error context.
 * @internal
 */
function handleStreamError(
  error: Error,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  convertToAISDKError: StreamTransformerConfig["convertToAISDKError"],
  options: LanguageModelV3CallOptions,
  modelId: string,
  url: string,
): void {
  const aiError = convertToAISDKError(error, {
    modelId,
    modelType: "languageModel",
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
 * After the first error, the transformer emits an error event and terminates without
 * a successful finish event.
 * @param iterable - The async iterable to wrap.
 * @param abortSignal - Caller cancellation, which the SAP iterator can otherwise swallow.
 * @yields {Error | T} Original values or Error instances for caught exceptions.
 * @internal
 */
async function* safeIterate<T>(
  iterable: AsyncIterable<T>,
  abortSignal: AbortSignal | undefined,
): AsyncGenerator<Error | T, void> {
  try {
    for await (const chunk of iterable) {
      abortSignal?.throwIfAborted();
      yield chunk;
    }
    abortSignal?.throwIfAborted();
  } catch (error) {
    if (abortSignal?.aborted) {
      yield createAbortError(abortSignal.reason);
    } else {
      yield error instanceof Error ? error : new Error(String(error));
    }
  }
}
