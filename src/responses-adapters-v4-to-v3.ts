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

/**
 * Unwraps V4 generated files and maps warnings and finish reasons to V3.
 * @param result - The OpenAI V4 generation result.
 * @returns A result suitable for the shared V3 core.
 */
export function convertResponsesResultToV3(
  result: LanguageModelV4GenerateResult,
): LanguageModelV3GenerateResult {
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
 * @returns The corresponding V3 event, or null for a keepalive.
 */
export function convertResponsesStreamPartToV3(
  part: LanguageModelV4StreamPart,
): LanguageModelV3StreamPart | null {
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
    case "ping":
      return null;
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
function convertContent(part: LanguageModelV4Content): LanguageModelV3Content {
  if (part.type === "custom" || part.type === "reasoning-file") {
    throw new UnsupportedFunctionalityError({
      functionality: `Responses '${part.type}' output has no V3 equivalent.`,
    });
  }
  return part.type === "file" ? convertGeneratedFile(part) : part;
}

/**
 * Maps interrupted output to the closest legacy finish reason.
 * @param reason - The V4 finish reason.
 * @returns The corresponding V3 finish reason.
 */
function convertFinishReason(
  reason: LanguageModelV4GenerateResult["finishReason"],
): LanguageModelV3FinishReason {
  if (reason.unified !== "interrupted") return reason as LanguageModelV3FinishReason;
  return { ...reason, unified: "other" };
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
