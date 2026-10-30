/** Output adapter: convert internal (V3) results to AI SDK 7 (V4) formats. */

import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

import type { FinishReasonWithV4Metadata } from "./adapter-metadata.js";

import { ORIGINAL_V4_FINISH_REASON } from "./adapter-metadata.js";
import { mapReadableStream } from "./map-readable-stream.js";

/**
 * Tags generated file data and restores preserved V4 finish reasons.
 * @param result - The internal V3 generate result.
 * @returns The equivalent V4 generate result.
 */
export function convertGenerateResultToV4(
  result: LanguageModelV3GenerateResult,
): LanguageModelV4GenerateResult {
  return {
    ...result,
    content: result.content.map((part) =>
      part.type === "file" ? { ...part, data: { data: part.data, type: "data" } } : part,
    ),
    finishReason:
      (result.finishReason as FinishReasonWithV4Metadata)[ORIGINAL_V4_FINISH_REASON] ??
      result.finishReason,
  };
}

/**
 * Tags streamed file data and restores preserved V4 finish reasons.
 * @param part - The internal V3 stream part.
 * @returns The equivalent V4 stream part.
 */
export function convertStreamPartToV4(part: LanguageModelV3StreamPart): LanguageModelV4StreamPart {
  if (part.type === "finish") {
    const original = (part.finishReason as FinishReasonWithV4Metadata)[ORIGINAL_V4_FINISH_REASON];
    return original ? { ...part, finishReason: original } : part;
  }
  if (part.type !== "file") return part;
  return { ...part, data: { data: part.data, type: "data" } };
}

/**
 * Transforms an internal stream to a V4 ReadableStream.
 * @param stream - The internal V3 stream.
 * @returns The equivalent V4 stream.
 */
export function createV4StreamFromInternal(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): ReadableStream<LanguageModelV4StreamPart> {
  return mapReadableStream(stream, convertStreamPartToV4);
}
