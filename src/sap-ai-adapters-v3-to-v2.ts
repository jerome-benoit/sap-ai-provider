/** Adapters for the semantic differences between the V3 core and V2 facade. */

import type {
  LanguageModelV3StreamPart as InternalStreamPart,
  LanguageModelV3Usage as InternalUsage,
  SharedV3Warning as InternalWarning,
} from "@ai-sdk/provider";
import type {
  LanguageModelV2CallWarning,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  SharedV2ProviderMetadata,
} from "@ai-sdk/provider-v2";

/** Stream events supported by the V2 facade. */
export type ConvertedV2StreamPart =
  | Exclude<LanguageModelV2StreamPart, { type: "stream-start" }>
  | { type: "stream-start"; warnings: ConvertedV2Warning[] };

/** V2 warning representation used when adapting V3 feature diagnostics. */
export type ConvertedV2Warning = Extract<LanguageModelV2CallWarning, { type: "other" }>;

/**
 * Converts V3-only event fields; structurally identical events pass through unchanged.
 * @param internalPart - V3 stream event
 * @returns V2 event, or null for unsupported tool approval requests
 * @internal
 */
export function convertStreamPartToV2(
  internalPart: InternalStreamPart,
): ConvertedV2StreamPart | null {
  // V2 has a narrower JSON metadata type; preserve the core payload without cloning.
  const compatiblePart = internalPart as InternalStreamPart & {
    providerMetadata?: SharedV2ProviderMetadata;
  };
  switch (compatiblePart.type) {
    case "file": {
      const { providerMetadata: _providerMetadata, ...part } = compatiblePart;
      return part;
    }
    case "finish":
      return {
        ...compatiblePart,
        finishReason: compatiblePart.finishReason.unified,
        usage: convertUsageToV2(compatiblePart.usage),
      };
    case "stream-start":
      return { ...compatiblePart, warnings: convertWarningsToV2(compatiblePart.warnings) };
    case "tool-approval-request":
      return null;
    case "tool-call": {
      const { dynamic: _dynamic, ...part } = compatiblePart;
      return part;
    }
    case "tool-input-start": {
      const { dynamic: _dynamic, title: _title, ...part } = compatiblePart;
      return part;
    }
    case "tool-result": {
      const { dynamic: _dynamic, preliminary: _preliminary, ...part } = compatiblePart;
      // Provider execution and dynamic tool classification are independent in V3.
      return { ...part, providerExecuted: true };
    }
    default:
      return compatiblePart;
  }
}

/**
 * Flattens usage without inventing totals when either component is unknown.
 * @param internalUsage - V3 nested usage
 * @returns V2 usage
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
 * Converts warnings to V2's descriptive other-warning representation.
 * @param internalWarnings - V3 warnings
 * @returns V2 warnings
 * @internal
 */
export function convertWarningsToV2(internalWarnings: InternalWarning[]): ConvertedV2Warning[] {
  return internalWarnings.map(convertWarningToV2);
}

/**
 * Retains feature and compatibility details absent from the V2 warning union.
 * @param internalWarning - V3 warning
 * @returns V2 warning
 * @internal
 */
export function convertWarningToV2(internalWarning: InternalWarning): ConvertedV2Warning {
  if (internalWarning.type === "other") return internalWarning;
  const prefix =
    internalWarning.type === "unsupported" ? "Unsupported feature" : "Compatibility mode";
  return {
    message: `${prefix}: ${internalWarning.feature}${internalWarning.details ? `. ${internalWarning.details}` : ""}`,
    type: "other",
  };
}

/**
 * Converts an internal stream, preserving backpressure, cancellation and errors.
 * @param internalStream - V3 stream
 * @returns V2 stream
 * @internal
 */
export function createV2StreamFromInternal(
  internalStream: ReadableStream<InternalStreamPart>,
): ReadableStream<ConvertedV2StreamPart> {
  return internalStream.pipeThrough(
    new TransformStream<InternalStreamPart, ConvertedV2StreamPart>({
      transform(chunk, controller) {
        const converted = convertStreamPartToV2(chunk);
        if (converted !== null) controller.enqueue(converted);
      },
    }),
  );
}
