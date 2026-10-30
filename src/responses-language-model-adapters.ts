/** Adapts the V4 OpenAI delegate without changing the provider's shared V3 contract. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3File,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4File,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolResultOutput,
  SharedV3Warning,
  SharedV4Warning,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";

import { getURLHref } from "./convert-to-sap-messages.js";

type V3Part = Exclude<LanguageModelV3Prompt[number], { role: "system" }>["content"][number];
type V3ToolItem = Extract<LanguageModelV3ToolResultOutput, { type: "content" }>["value"][number];
type V4Part = Exclude<LanguageModelV4Prompt[number], { role: "system" }>["content"][number];
type V4ToolItem = Extract<LanguageModelV4ToolResultOutput, { type: "content" }>["value"][number];

/**
 * Tags V3 prompt files and tool-result media for the V4 delegate.
 * @param options - The normalized V3 invocation, including provider namespaces.
 * @returns V4 options that retain the invocation's data and transport settings.
 */
export function convertResponsesCallToV4(
  options: LanguageModelV3CallOptions,
): LanguageModelV4CallOptions {
  return {
    ...options,
    prompt: options.prompt.map((message) => {
      switch (message.role) {
        case "assistant":
          return { ...message, content: message.content.map(convertPromptPart) };
        case "system":
          return message;
        case "tool":
          return {
            ...message,
            content: message.content.map((part) =>
              part.type === "tool-result" ? convertToolResult(part) : part,
            ),
          };
        case "user":
          return {
            ...message,
            content: message.content.map((part) =>
              part.type === "file" ? convertFile(part) : part,
            ),
          };
      }
    }),
  };
}

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
 * @returns The corresponding V3 event.
 */
export function convertResponsesStreamPartToV3(
  part: LanguageModelV4StreamPart,
): LanguageModelV3StreamPart {
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
function convertContent(part: LanguageModelV4Content): LanguageModelV3Content {
  if (part.type === "custom" || part.type === "reasoning-file") {
    throw new UnsupportedFunctionalityError({
      functionality: `Responses '${part.type}' output has no V3 equivalent.`,
    });
  }
  return part.type === "file" ? convertGeneratedFile(part) : part;
}

/**
 * Tags inline bytes and canonicalizes URL objects for the delegate's serializer.
 * @param part - A V3 prompt file.
 * @returns The tagged V4 file.
 */
function convertFile(part: Extract<V3Part, { type: "file" }>): Extract<V4Part, { type: "file" }> {
  const data = part.data;
  const href = getURLHref(data);
  if (href !== undefined) {
    const url =
      data instanceof URL && data.toString === URL.prototype.toString ? data : new URL(href);
    return { ...part, data: { type: "url", url } };
  }
  // The V3 union leaves only inline data once URL internal slots have been ruled out.
  return { ...part, data: { data: data as string | Uint8Array, type: "data" } };
}

/**
 * Preserves native finish diagnostics when V3 cannot name the unified reason.
 * @param reason - The V4 finish reason.
 * @returns The corresponding V3 finish reason.
 */
function convertFinishReason(
  reason: LanguageModelV4GenerateResult["finishReason"],
): LanguageModelV3FinishReason {
  return { ...reason, unified: reason.unified === "interrupted" ? "other" : reason.unified };
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
 * Converts assistant history to the delegate's prompt contract.
 * @param part - A V3 assistant part.
 * @returns Its V4 equivalent.
 */
function convertPromptPart(
  part: Exclude<
    LanguageModelV3Prompt[number],
    { role: "system" | "tool" | "user" }
  >["content"][number],
): Exclude<LanguageModelV4Prompt[number], { role: "system" | "tool" | "user" }>["content"][number] {
  if (part.type === "file") return convertFile(part);
  if (part.type === "tool-result") return convertToolResult(part);
  return part;
}

/**
 * Retains file and image categories when tagging tool-result media.
 * @param item - A V3 tool-result content item.
 * @returns The matching V4 content item.
 */
function convertToolItem(item: V3ToolItem): V4ToolItem {
  switch (item.type) {
    case "custom":
    case "text":
      return item;
    case "file-data":
    case "image-data":
      return { ...item, data: { data: item.data, type: "data" }, type: "file" };
    case "file-id":
    case "image-file-id":
      return {
        data: {
          reference: typeof item.fileId === "string" ? { openai: item.fileId } : item.fileId,
          type: "reference",
        },
        mediaType: item.type === "image-file-id" ? "image" : "application/octet-stream",
        providerOptions: item.providerOptions,
        type: "file",
      };
    case "file-url":
    case "image-url":
      return {
        data: { type: "url", url: new URL(item.url) },
        mediaType: item.type === "image-url" ? "image" : "application/octet-stream",
        providerOptions: item.providerOptions,
        type: "file",
      };
  }
}

/**
 * Converts nested tool-result media without altering non-media outputs.
 * @param part - A V3 tool result.
 * @returns A V4 tool result with the same call identity and options.
 */
function convertToolResult(
  part: Extract<V3Part, { type: "tool-result" }>,
): Extract<V4Part, { type: "tool-result" }> {
  return part.output.type === "content"
    ? { ...part, output: { ...part.output, value: part.output.value.map(convertToolItem) } }
    : { ...part, output: part.output };
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
