/** Output adapter: convert internal (V3) results to AI SDK 7 (V4) formats. */

import type {
  LanguageModelV3FinishReason as InternalFinishReason,
  LanguageModelV3GenerateResult as InternalGenerateResult,
  LanguageModelV3StreamPart as InternalStreamPart,
  LanguageModelV3Usage as InternalUsage,
  SharedV3Warning as InternalWarning,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
  SharedV3ProviderMetadata,
  SharedV4ProviderMetadata,
  SharedV4Warning,
} from "@ai-sdk/provider";

/**
 * Converts an internal finish reason to V4 format (identical shape).
 * @param internalFinishReason
 */
export function convertFinishReasonToV4(
  internalFinishReason: InternalFinishReason,
): LanguageModelV4FinishReason {
  return internalFinishReason;
}

/**
 * Converts an internal generate result to V4 format: content mapped part by
 * part (V3 file content becomes tagged V4 file data), usage by identity,
 * warnings by native passthrough.
 * @param internalResult
 */
export function convertGenerateResultToV4(
  internalResult: InternalGenerateResult,
): LanguageModelV4GenerateResult {
  return {
    ...internalResult,
    content: internalResult.content.map((part) => convertContentToV4(part)),
    finishReason: convertFinishReasonToV4(internalResult.finishReason),
    usage: convertUsageToV4(internalResult.usage),
    warnings: convertWarningsToV4(internalResult.warnings),
  };
}

/**
 * Converts V3 provider metadata to V4 format (identical record shape).
 * @param metadata
 */
export function convertProviderMetadataToV4(
  metadata: SharedV3ProviderMetadata | undefined,
): SharedV4ProviderMetadata | undefined {
  return metadata;
}

/**
 * Converts an internal stream part to V4 format. Every V3 part has a native
 * V4 equivalent (including `tool-approval-request`), so conversion is total.
 * @param internalPart - The internal V3 stream part.
 * @returns The equivalent V4 stream part.
 */
export function convertStreamPartToV4(internalPart: InternalStreamPart): LanguageModelV4StreamPart {
  switch (internalPart.type) {
    case "error":
      return { error: internalPart.error, type: "error" };
    case "file":
      return withProviderMetadata(
        {
          data: { data: internalPart.data, type: "data" as const },
          mediaType: internalPart.mediaType,
          type: "file" as const,
        },
        internalPart.providerMetadata,
      );
    case "finish":
      return withProviderMetadata(
        {
          finishReason: convertFinishReasonToV4(internalPart.finishReason),
          type: "finish" as const,
          usage: convertUsageToV4(internalPart.usage),
        },
        internalPart.providerMetadata,
      );
    case "raw":
      return { rawValue: internalPart.rawValue, type: "raw" };
    case "reasoning-delta":
      return withProviderMetadata(
        { delta: internalPart.delta, id: internalPart.id, type: "reasoning-delta" as const },
        internalPart.providerMetadata,
      );
    case "reasoning-end":
      return withProviderMetadata(
        { id: internalPart.id, type: "reasoning-end" as const },
        internalPart.providerMetadata,
      );
    case "reasoning-start":
      return withProviderMetadata(
        { id: internalPart.id, type: "reasoning-start" as const },
        internalPart.providerMetadata,
      );
    case "response-metadata":
      return {
        id: internalPart.id,
        modelId: internalPart.modelId,
        timestamp: internalPart.timestamp,
        type: "response-metadata",
      };
    case "source":
      if (internalPart.sourceType === "url") {
        return withProviderMetadata(
          {
            id: internalPart.id,
            sourceType: "url" as const,
            title: internalPart.title,
            type: "source" as const,
            url: internalPart.url,
          },
          internalPart.providerMetadata,
        );
      }
      return withProviderMetadata(
        {
          filename: internalPart.filename,
          id: internalPart.id,
          mediaType: internalPart.mediaType,
          sourceType: "document" as const,
          title: internalPart.title,
          type: "source" as const,
        },
        internalPart.providerMetadata,
      );
    case "stream-start":
      return { type: "stream-start", warnings: convertWarningsToV4(internalPart.warnings) };
    case "text-delta":
      return withProviderMetadata(
        { delta: internalPart.delta, id: internalPart.id, type: "text-delta" as const },
        internalPart.providerMetadata,
      );
    case "text-end":
      return withProviderMetadata(
        { id: internalPart.id, type: "text-end" as const },
        internalPart.providerMetadata,
      );
    case "text-start":
      return withProviderMetadata(
        { id: internalPart.id, type: "text-start" as const },
        internalPart.providerMetadata,
      );
    case "tool-approval-request":
      return withProviderMetadata(
        {
          approvalId: internalPart.approvalId,
          toolCallId: internalPart.toolCallId,
          type: "tool-approval-request" as const,
        },
        internalPart.providerMetadata,
      );
    case "tool-call":
      return withProviderMetadata(
        {
          dynamic: internalPart.dynamic,
          input: internalPart.input,
          toolCallId: internalPart.toolCallId,
          toolName: internalPart.toolName,
          type: "tool-call" as const,
          ...(internalPart.providerExecuted !== undefined && {
            providerExecuted: internalPart.providerExecuted,
          }),
        },
        internalPart.providerMetadata,
      );
    case "tool-input-delta":
      return withProviderMetadata(
        { delta: internalPart.delta, id: internalPart.id, type: "tool-input-delta" as const },
        internalPart.providerMetadata,
      );
    case "tool-input-end":
      return withProviderMetadata(
        { id: internalPart.id, type: "tool-input-end" as const },
        internalPart.providerMetadata,
      );
    case "tool-input-start":
      return withProviderMetadata(
        {
          dynamic: internalPart.dynamic,
          id: internalPart.id,
          title: internalPart.title,
          toolName: internalPart.toolName,
          type: "tool-input-start" as const,
          ...(internalPart.providerExecuted !== undefined && {
            providerExecuted: internalPart.providerExecuted,
          }),
        },
        internalPart.providerMetadata,
      );
    case "tool-result":
      return withProviderMetadata(
        {
          dynamic: internalPart.dynamic,
          isError: internalPart.isError,
          preliminary: internalPart.preliminary,
          result: internalPart.result,
          toolCallId: internalPart.toolCallId,
          toolName: internalPart.toolName,
          type: "tool-result" as const,
        },
        internalPart.providerMetadata,
      );
    default: {
      const _exhaustiveCheck: never = internalPart;
      return _exhaustiveCheck;
    }
  }
}

/**
 * Converts internal usage (nested format) to V4 usage (identical nested shape).
 * @param internalUsage
 */
export function convertUsageToV4(internalUsage: InternalUsage): LanguageModelV4Usage {
  return internalUsage;
}

/**
 * Converts internal warnings to V4 warnings (native passthrough; V4 adds the
 * `deprecated` variant which V3 never produces).
 * @param internalWarnings
 */
export function convertWarningsToV4(internalWarnings: InternalWarning[]): SharedV4Warning[] {
  return internalWarnings;
}
/**
 * Transforms an internal stream to a V4 ReadableStream (total conversion).
 * Entry warnings (e.g. dropped V4-only options) are merged into the leading
 * `stream-start` part, which the internal stream always emits first.
 * @param internalStream - The internal V3 stream.
 * @param entryWarnings - Warnings collected during prompt normalization.
 * @returns The equivalent V4 stream.
 */
export function createV4StreamFromInternal(
  internalStream: ReadableStream<InternalStreamPart>,
  entryWarnings: SharedV4Warning[] = [],
): ReadableStream<LanguageModelV4StreamPart> {
  let merged = entryWarnings.length === 0;
  return internalStream.pipeThrough(
    new TransformStream<InternalStreamPart, LanguageModelV4StreamPart>({
      transform(internalPart, controller) {
        const converted = convertStreamPartToV4(internalPart);
        if (!merged && converted.type === "stream-start") {
          merged = true;
          controller.enqueue({ ...converted, warnings: [...entryWarnings, ...converted.warnings] });
          return;
        }
        controller.enqueue(converted);
      },
    }),
  );
}

/**
 *
 * @param part
 */
function convertContentToV4(
  part: InternalGenerateResult["content"][number],
): LanguageModelV4GenerateResult["content"][number] {
  if (part.type !== "file") return part;
  return {
    ...part,
    data: { data: part.data, type: "data" },
  };
}

/**
 * Conditionally attaches converted provider metadata to a V4 stream part object.
 * @param obj
 * @param metadata
 */
function withProviderMetadata<T extends object>(
  obj: T,
  metadata: SharedV3ProviderMetadata | undefined,
): T & { providerMetadata?: SharedV4ProviderMetadata } {
  const converted = convertProviderMetadataToV4(metadata);
  return converted === undefined ? obj : { ...obj, providerMetadata: converted };
}
