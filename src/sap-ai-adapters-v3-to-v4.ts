/** Output adapter: convert internal (V3) results to AI SDK 7 (V4) formats. */

import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

/**
 * Tags generated file data for V4; all other result fields are compatible.
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
  };
}

/**
 * Tags streamed file data for V4; every other V3 part is already compatible.
 * @param part - The internal V3 stream part.
 * @returns The equivalent V4 stream part.
 */
export function convertStreamPartToV4(part: LanguageModelV3StreamPart): LanguageModelV4StreamPart {
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
  return stream.pipeThrough(
    new TransformStream<LanguageModelV3StreamPart, LanguageModelV4StreamPart>({
      transform(part, controller) {
        controller.enqueue(convertStreamPartToV4(part));
      },
    }),
  );
}
