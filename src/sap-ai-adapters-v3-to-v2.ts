/** Adapters to convert internal (V3) formats to LanguageModelV2 formats for the V2 facade. */

import type {
  LanguageModelV3FinishReason as InternalFinishReason,
  LanguageModelV3StreamPart as InternalStreamPart,
  LanguageModelV3Usage as InternalUsage,
  SharedV3Warning as InternalWarning,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  SharedV2ProviderMetadata,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";

/**
 * Converts internal finish reason to V2 format.
 * @param internalFinishReason - Internal finish reason object `{ unified, raw? }`.
 * @returns V2 finish reason string.
 * @internal
 */
export function convertFinishReasonToV2(
  internalFinishReason: InternalFinishReason,
): LanguageModelV2FinishReason {
  return internalFinishReason.unified;
}

/**
 * Converts V3 provider metadata to V2 format.
 *
 * Both are `Record<string, Record<string, JSONValue>>` compatible; cast for type safety.
 * @param metadata - V3 provider metadata.
 * @returns V2 provider metadata.
 * @internal
 */
export function convertProviderMetadataToV2(
  metadata: SharedV3ProviderMetadata | undefined,
): SharedV2ProviderMetadata | undefined {
  return metadata as SharedV2ProviderMetadata | undefined;
}

/**
 * Converts internal stream part to V2 format.
 *
 * Handles all V3→V2 semantic differences explicitly:
 * - `file`: removes V3-only `providerMetadata`
 * - `finish`: converts `usage`, `finishReason`, casts `providerMetadata`
 * - `stream-start`: converts `warnings` array
 * - `tool-approval-request`: V3-only, returns `null`
 * - `tool-call`: removes V3-only `dynamic`
 * - `tool-input-start`: removes V3-only `dynamic`, `title`
 * - `tool-result`: maps `dynamic` → `providerExecuted`, removes `preliminary`
 * - `source`: casts `providerMetadata`
 * - `response-metadata`: identical structure, passthrough
 * - `text-*`, `reasoning-*`, `tool-input-delta`, `tool-input-end`: casts `providerMetadata`
 * - `raw`, `error`: identical structure, passthrough
 * @param internalPart - Internal stream part.
 * @returns V2 stream part, or `null` if no V2 equivalent exists.
 * @internal
 */
export function convertStreamPartToV2(
  internalPart: InternalStreamPart,
): LanguageModelV2StreamPart | null {
  switch (internalPart.type) {
    case "error":
      return {
        error: internalPart.error,
        type: "error",
      };

    case "file":
      return {
        data: internalPart.data,
        mediaType: internalPart.mediaType,
        type: "file",
      };

    case "finish":
      return {
        finishReason: convertFinishReasonToV2(internalPart.finishReason),
        type: "finish",
        usage: convertUsageToV2(internalPart.usage),
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "raw":
      return {
        rawValue: internalPart.rawValue,
        type: "raw",
      };

    case "reasoning-delta":
      return {
        delta: internalPart.delta,
        id: internalPart.id,
        type: "reasoning-delta",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "reasoning-end":
      return {
        id: internalPart.id,
        type: "reasoning-end",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "reasoning-start":
      return {
        id: internalPart.id,
        type: "reasoning-start",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "response-metadata":
      return {
        id: internalPart.id,
        modelId: internalPart.modelId,
        timestamp: internalPart.timestamp,
        type: "response-metadata",
      };

    case "source":
      if (internalPart.sourceType === "url") {
        return {
          id: internalPart.id,
          sourceType: "url",
          title: internalPart.title,
          type: "source",
          url: internalPart.url,
          ...(internalPart.providerMetadata !== undefined && {
            providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
          }),
        };
      }
      return {
        filename: internalPart.filename,
        id: internalPart.id,
        mediaType: internalPart.mediaType,
        sourceType: "document",
        title: internalPart.title,
        type: "source",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "stream-start":
      return {
        type: "stream-start",
        warnings: convertWarningsToV2(internalPart.warnings),
      };

    case "text-delta":
      return {
        delta: internalPart.delta,
        id: internalPart.id,
        type: "text-delta",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "text-end":
      return {
        id: internalPart.id,
        type: "text-end",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "text-start":
      return {
        id: internalPart.id,
        type: "text-start",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "tool-approval-request":
      return null;

    case "tool-call":
      return {
        input: internalPart.input,
        toolCallId: internalPart.toolCallId,
        toolName: internalPart.toolName,
        type: "tool-call",
        ...(internalPart.providerExecuted !== undefined && {
          providerExecuted: internalPart.providerExecuted,
        }),
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "tool-input-delta":
      return {
        delta: internalPart.delta,
        id: internalPart.id,
        type: "tool-input-delta",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "tool-input-end":
      return {
        id: internalPart.id,
        type: "tool-input-end",
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "tool-input-start":
      return {
        id: internalPart.id,
        toolName: internalPart.toolName,
        type: "tool-input-start",
        ...(internalPart.providerExecuted !== undefined && {
          providerExecuted: internalPart.providerExecuted,
        }),
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };

    case "tool-result":
      return {
        result: internalPart.result,
        toolCallId: internalPart.toolCallId,
        toolName: internalPart.toolName,
        type: "tool-result",
        ...(internalPart.isError !== undefined && { isError: internalPart.isError }),
        ...(internalPart.dynamic !== undefined && { providerExecuted: internalPart.dynamic }),
        ...(internalPart.providerMetadata !== undefined && {
          providerMetadata: convertProviderMetadataToV2(internalPart.providerMetadata),
        }),
      };
  }
}

/**
 * Converts internal usage (nested format) to V2 usage (flat format).
 * @param internalUsage - Internal usage object with nested `inputTokens`/`outputTokens`.
 * @returns V2 usage object with flat token counts.
 * @internal
 */
export function convertUsageToV2(internalUsage: InternalUsage): LanguageModelV2Usage {
  return {
    cachedInputTokens: internalUsage.inputTokens.cacheRead,
    inputTokens: internalUsage.inputTokens.total,
    outputTokens: internalUsage.outputTokens.total,
    reasoningTokens: internalUsage.outputTokens.reasoning,
    totalTokens:
      internalUsage.inputTokens.total !== undefined &&
      internalUsage.outputTokens.total !== undefined
        ? internalUsage.inputTokens.total + internalUsage.outputTokens.total
        : undefined,
  };
}

/**
 * Converts internal warnings array to V2 warnings array.
 * @param internalWarnings - Internal warning objects.
 * @returns V2 warning objects.
 * @internal
 */
export function convertWarningsToV2(
  internalWarnings: InternalWarning[],
): LanguageModelV2CallWarning[] {
  return internalWarnings.map(convertWarningToV2);
}

/**
 * Converts internal warning to V2 warning format.
 *
 * Maps `unsupported`/`compatibility` warnings to V2 `other` type with descriptive message.
 * @param internalWarning - Internal warning object.
 * @returns V2 warning object.
 * @internal
 */
export function convertWarningToV2(internalWarning: InternalWarning): LanguageModelV2CallWarning {
  if (internalWarning.type === "unsupported") {
    return {
      message: internalWarning.details
        ? `Unsupported feature: ${internalWarning.feature}. ${internalWarning.details}`
        : `Unsupported feature: ${internalWarning.feature}`,
      type: "other",
    };
  }

  if (internalWarning.type === "compatibility") {
    return {
      message: internalWarning.details
        ? `Compatibility mode: ${internalWarning.feature}. ${internalWarning.details}`
        : `Compatibility mode: ${internalWarning.feature}`,
      type: "other",
    };
  }

  return {
    message: internalWarning.message,
    type: "other",
  };
}

/**
 * Transforms internal stream to V2 ReadableStream.
 * @param internalStream - Internal ReadableStream to transform.
 * @returns V2-formatted ReadableStream.
 * @internal
 */
export function createV2StreamFromInternal(
  internalStream: ReadableStream<InternalStreamPart>,
): ReadableStream<LanguageModelV2StreamPart> {
  return internalStream.pipeThrough(
    new TransformStream<InternalStreamPart, LanguageModelV2StreamPart>({
      transform(chunk, controller) {
        const converted = convertStreamPartToV2(chunk);
        if (converted != null) {
          controller.enqueue(converted);
        }
      },
    }),
  );
}
