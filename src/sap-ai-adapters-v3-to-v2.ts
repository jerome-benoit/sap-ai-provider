/**
 * Adapters to convert internal Vercel AI SDK formats to LanguageModelV2 formats.
 *
 * This module provides transformation functions that convert internal response formats
 * (used by the SAP AI Core implementation) to V2 formats (exposed as the public API).
 * @module sap-ai-adapters-v3-to-v2
 * @internal
 */

import type {
  // Internal types - aliased to hide implementation details
  LanguageModelV3FinishReason as InternalFinishReason,
  LanguageModelV3StreamPart as InternalStreamPart,
  LanguageModelV3Usage as InternalUsage,
  SharedV3Warning as InternalWarning,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";

/**
 * Converts an internal finish reason to V2 format.
 *
 * Internal format: `{ unified: string, raw?: string }`
 * V2 format: `string` (one of: 'stop', 'length', 'content-filter', 'tool-calls', 'error', 'other', 'unknown')
 * @param internalFinishReason - The internal finish reason object
 * @returns The V2 finish reason string
 * @internal
 */
export function convertFinishReasonToV2(
  internalFinishReason: InternalFinishReason,
): LanguageModelV2FinishReason {
  return internalFinishReason.unified;
}

/**
 * Converts an internal stream part to V2 format.
 *
 * Internal stream events have more granular structure:
 * - `text-start`, `text-delta`, `text-end` (with block IDs)
 * - `tool-input-start`, `tool-input-delta`, `tool-input-end`
 * - `finish` event with structured usage
 * - `stream-start` event with warnings
 *
 * V2 has the same event structure, so most events pass through unchanged.
 * The key transformations are:
 * - `finish` event: convert usage format
 * - `stream-start` event: convert warnings
 * @param internalPart - The internal stream part
 * @returns The V2 stream part
 * @internal
 */
export function convertStreamPartToV2(internalPart: InternalStreamPart): LanguageModelV2StreamPart {
  switch (internalPart.type) {
    case "finish":
      return {
        finishReason: convertFinishReasonToV2(internalPart.finishReason),
        // Cast providerMetadata as compatible between formats
        // The type difference is only in index signature strictness
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        providerMetadata: internalPart.providerMetadata as any,
        type: "finish",
        usage: convertUsageToV2(internalPart.usage),
      };

    case "stream-start":
      return {
        type: "stream-start",
        warnings: convertWarningsToV2(internalPart.warnings),
      };

    // All other event types are compatible between internal and V2 formats
    default:
      return internalPart as LanguageModelV2StreamPart;
  }
}

/**
 * Transforms an internal stream to a V2 stream.
 *
 * This async generator function reads from an internal ReadableStream and yields
 * V2-formatted stream parts, converting usage and finish reason formats on the fly.
 * @param internalStream - The internal ReadableStream
 * @yields {LanguageModelV2StreamPart} V2-formatted stream parts
 * @returns An async generator yielding V2 stream parts
 * @internal
 */
export async function* convertStreamToV2(
  internalStream: ReadableStream<InternalStreamPart>,
): AsyncGenerator<LanguageModelV2StreamPart> {
  const reader = internalStream.getReader();

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      yield convertStreamPartToV2(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Converts internal usage information to V2 format.
 *
 * Internal format (nested):
 * ```
 * {
 *   inputTokens: { total, cacheRead, cacheWrite, noCache },
 *   outputTokens: { total, reasoning, text }
 * }
 * ```
 *
 * V2 format (flat):
 * ```
 * {
 *   inputTokens: number,
 *   outputTokens: number,
 *   totalTokens?: number,
 *   reasoningTokens?: number,
 *   cachedInputTokens?: number
 * }
 * ```
 * @param internalUsage - The internal usage object
 * @returns The V2 usage object
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
 * Converts an array of internal warnings to V2 warnings.
 * @param internalWarnings - Array of internal warning objects
 * @returns Array of V2 warning objects
 * @internal
 */
export function convertWarningsToV2(
  internalWarnings: InternalWarning[],
): LanguageModelV2CallWarning[] {
  return internalWarnings.map(convertWarningToV2);
}

/**
 * Converts an internal warning to V2 warning format.
 *
 * Internal warnings have a `feature` field for unsupported features.
 * V2 warnings use different types: 'unsupported-setting', 'unsupported-tool', or 'other'.
 *
 * Since we don't have detailed context about which setting/tool is unsupported,
 * we map internal unsupported warnings to V2 'other' type with a descriptive message.
 * @param internalWarning - The internal warning object
 * @returns The V2 warning object
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

  // Internal 'other' type maps directly to V2 'other' type
  return {
    message: internalWarning.message,
    type: "other",
  };
}
