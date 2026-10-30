/** Output adapter: convert OpenAI Responses V4 results to the shared V3 contract. */
import type {
  LanguageModelV3Content,
  LanguageModelV3File,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV4Content,
  LanguageModelV4File,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  SharedV3Warning,
  SharedV4Warning,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";

import { ORIGINAL_V4_FINISH_REASON } from "./adapter-metadata.js";

/** V3-compatible content retaining V4 text citations for the V4 facade. */
type ResponsesV3Content =
  | Exclude<LanguageModelV3Content, { type: "text" }>
  | (Extract<LanguageModelV3Content, { type: "text" }> &
      Pick<Extract<LanguageModelV4Content, { type: "text" }>, "citations">);

/** Internal result extensions survive V3-shaped spreads without widening public V3 APIs. */
type ResponsesV3GenerateResult = Omit<LanguageModelV3GenerateResult, "content"> &
  Pick<LanguageModelV4GenerateResult, "structuredOutputText"> & {
    content: ResponsesV3Content[];
  };

/** Only existing V3 event kinds carry these preserved V4 fields. */
type ResponsesV3StreamPart =
  | Exclude<LanguageModelV3StreamPart, { type: "text-end" | "tool-input-start" }>
  | (Extract<LanguageModelV3StreamPart, { type: "text-end" }> &
      Pick<Extract<LanguageModelV4StreamPart, { type: "text-end" }>, "citations">)
  | (Extract<LanguageModelV3StreamPart, { type: "tool-input-start" }> &
      Pick<Extract<LanguageModelV4StreamPart, { type: "tool-input-start" }>, "inputEncoding">);

/**
 * Unwraps V4 generated files and maps warnings and finish reasons to V3.
 * @param result - The OpenAI V4 generation result.
 * @returns A result suitable for the shared V3 core.
 */
export function convertResponsesResultToV3(
  result: LanguageModelV4GenerateResult,
): ResponsesV3GenerateResult {
  return {
    ...result,
    content: result.content.map(convertContent),
    finishReason: convertFinishReason(result.finishReason),
    warnings: result.warnings.map(convertWarning),
  };
}

/**
 * Converts one delegate event inside the existing demand-driven stream wrapper.
 * @param part - The OpenAI V4 event.
 * @returns The corresponding V3 event.
 */
export function convertResponsesStreamPartToV3(
  part: LanguageModelV4StreamPart,
): ResponsesV3StreamPart {
  switch (part.type) {
    case "custom":
    case "reasoning-file":
      throw new UnsupportedFunctionalityError({
        functionality: `Responses '${part.type}' output has no V3 equivalent.`,
      });
    case "file":
      return convertGeneratedFile(part);
    case "finish":
      return { ...part, finishReason: convertFinishReason(part.finishReason) };
    case "stream-start":
      return { ...part, warnings: part.warnings.map(convertWarning) };
    default:
      return part;
  }
}

/**
 * Rejects V4-only output instead of leaking invalid content through V2/V3 APIs.
 * @param part - Generated V4 content.
 * @returns Content representable by the shared V3 core.
 */
function convertContent(part: LanguageModelV4Content): ResponsesV3Content {
  if (part.type === "custom" || part.type === "reasoning-file") {
    throw new UnsupportedFunctionalityError({
      functionality: `Responses '${part.type}' output has no V3 equivalent.`,
    });
  }
  return part.type === "file" ? convertGeneratedFile(part) : part;
}

/**
 * Preserves native finish diagnostics when V3 cannot name the unified reason.
 * @param reason - The V4 finish reason.
 * @returns The corresponding V3 finish reason.
 */
function convertFinishReason(
  reason: LanguageModelV4GenerateResult["finishReason"],
): LanguageModelV3FinishReason {
  if (reason.unified !== "interrupted") return reason as LanguageModelV3FinishReason;
  const converted: LanguageModelV3FinishReason = { ...reason, unified: "other" };
  return Object.defineProperty(converted, ORIGINAL_V4_FINISH_REASON, { value: reason });
}

/**
 * Unwraps generated inline data without fetching URL-backed output.
 * @param part - A generated V4 file.
 * @returns Its inline V3 equivalent.
 */
function convertGeneratedFile(part: LanguageModelV4File): LanguageModelV3File {
  if (part.data.type !== "data") {
    throw new UnsupportedFunctionalityError({
      functionality: "Responses generated file URLs have no V3 equivalent and are not fetched.",
    });
  }
  return { ...part, data: part.data.data };
}

/**
 * Retains deprecation diagnostics in the V3 warning union.
 * @param warning - A delegate warning.
 * @returns A V3-compatible warning.
 */
function convertWarning(warning: SharedV4Warning): SharedV3Warning {
  return warning.type === "deprecated"
    ? { message: `${warning.setting}: ${warning.message}`, type: "other" }
    : warning;
}
