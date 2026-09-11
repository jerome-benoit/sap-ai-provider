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
 * @param internalFinishReason - The internal V3 finish reason.
 * @returns The equivalent V4 finish reason.
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
 * @param internalResult - The internal V3 generate result.
 * @returns The equivalent V4 generate result.
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
 * @param metadata - The V3 provider metadata.
 * @returns The equivalent V4 provider metadata.
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
  if (internalPart.type !== "file") return internalPart;
  return {
    ...internalPart,
    data: { data: internalPart.data, type: "data" },
  };
}

/**
 * Converts internal usage (nested format) to V4 usage (identical nested shape).
 * @param internalUsage - The internal V3 usage.
 * @returns The equivalent V4 usage.
 */
export function convertUsageToV4(internalUsage: InternalUsage): LanguageModelV4Usage {
  return internalUsage;
}

/**
 * Converts internal warnings to V4 warnings (native passthrough; V4 adds the
 * `deprecated` variant which V3 never produces).
 * @param internalWarnings - The internal V3 warnings.
 * @returns The equivalent V4 warnings.
 */
export function convertWarningsToV4(internalWarnings: InternalWarning[]): SharedV4Warning[] {
  return internalWarnings;
}
/**
 * Transforms an internal stream to a V4 ReadableStream (total conversion).
 * Optional entry warnings are merged into the first `stream-start` part.
 * The current V4 facade supplies no entry warnings.
 * @param internalStream - The internal V3 stream.
 * @param entryWarnings - Additional warnings to prepend to `stream-start`.
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
 * Converts an internal generated content part to V4 format.
 * @param part - The internal V3 content part.
 * @returns The equivalent V4 content part.
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
