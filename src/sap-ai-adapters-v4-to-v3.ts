/** Entry adapter: normalize AI SDK 7 (V4) prompts to the internal V3 format. */

import type {
  LanguageModelV3FilePart,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV4Prompt,
  SharedV4Warning,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";

import { base64FromBytes } from "./convert-to-sap-messages.js";

type V3AssistantContent = Extract<LanguageModelV3Prompt[number], { role: "assistant" }>["content"];
type V3ToolContentItem = Extract<
  LanguageModelV3ToolResultOutput,
  { type: "content" }
>["value"][number];
type V3UserPart = LanguageModelV3FilePart | LanguageModelV3TextPart;
type V4AssistantPart = Extract<V4Message, { role: "assistant" }>["content"][number];
type V4ContentItem = Extract<V4ToolOutput, { type: "content" }>["value"][number];
type V4Message = LanguageModelV4Prompt[number];

type V4ToolOutput = Extract<V4ToolPart, { type: "tool-result" }>["output"];
type V4ToolPart = Extract<V4Message, { role: "tool" }>["content"][number];
type V4UserPart = Extract<V4Message, { role: "user" }>["content"][number];

const REFERENCE_ERROR =
  "V4 provider reference file data has no V3 equivalent and is not fetched. Resolve the reference before calling the model.";

/**
 * Normalizes an AI SDK 7 (spec V4) prompt to the internal V3 prompt format.
 *
 * - Tagged file data is unwrapped: `data` to raw bytes/string, `url` to the
 *   `URL` object, `text` to a V3 text part. `reference` values are rejected
 *   explicitly (never fetched).
 * - `reasoning-file` and `custom` parts are rejected explicitly.
 * - Tool-result outputs are mapped to the V3 output union; nested `content[]`
 *   file items use the legacy `file-data`/`file-url` shapes.
 * - Everything else (text, reasoning, tool calls, approval responses,
 *   provider options) passes through untouched.
 * @param prompt - The V4 prompt received from AI SDK 7.
 * @param warnings - Optional sink for compatibility warnings.
 * @returns The equivalent V3 prompt for the internal core.
 * @throws {UnsupportedFunctionalityError} For V4-only shapes with no V3 equivalent.
 */
export function normalizeV4PromptToV3(
  prompt: LanguageModelV4Prompt,
  warnings?: SharedV4Warning[],
): LanguageModelV3Prompt {
  return prompt.map((message) => {
    switch (message.role) {
      case "assistant":
        return {
          content: message.content.flatMap((part) => normalizeAssistantPart(part)),
          role: "assistant",
        };
      case "system":
        return { content: message.content, role: "system" };
      case "tool":
        return {
          content: message.content.map((part) =>
            part.type === "tool-result" ? normalizeToolResultPart(part) : part,
          ),
          role: "tool",
        };
      case "user":
        return {
          content: message.content.flatMap((part) => normalizeUserPart(part, warnings)),
          role: "user",
        };
    }
  });
}

/**
 *
 * @param part
 */
function normalizeAssistantPart(part: V4AssistantPart): V3AssistantContent {
  switch (part.type) {
    case "custom":
    case "reasoning-file":
      throw new UnsupportedFunctionalityError({
        functionality: `Assistant content type '${part.type}' has no V3 equivalent.`,
      });
    case "file":
      return normalizeUserPart(part);
    case "tool-result":
      return [normalizeToolResultPart(part)];
    default:
      return [part];
  }
}

/**
 *
 * @param item
 */
function normalizeContentItem(item: V4ContentItem): V3ToolContentItem {
  if (item.type === "text") return item;
  if (item.type !== "file") {
    throw new UnsupportedFunctionalityError({
      functionality: `Tool content item type '${item.type}' has no V3 equivalent.`,
    });
  }
  switch (item.data.type) {
    case "data":
      return {
        data:
          typeof item.data.data === "string"
            ? item.data.data
            : base64FromBytes(new Uint8Array(item.data.data)),
        ...(item.filename ? { filename: item.filename } : {}),
        mediaType: item.mediaType,
        type: "file-data",
      };
    case "text":
      return { text: item.data.text, type: "text" };
    case "url":
      // Legacy V3 file-url carries no media type; the subtype stays in the URL itself.
      return { type: "file-url", url: item.data.url.toString() };
    case "reference":
      throw new UnsupportedFunctionalityError({ functionality: REFERENCE_ERROR });
  }
}

/**
 *
 * @param output
 */
function normalizeToolOutput(output: V4ToolOutput): LanguageModelV3ToolResultOutput {
  switch (output.type) {
    case "content":
      return {
        ...output,
        value: output.value.map((item) => normalizeContentItem(item)),
      };
    case "error-json":
    case "error-text":
    case "execution-denied":
    case "json":
    case "text":
      return output;
  }
}

/**
 *
 * @param part
 */
function normalizeToolResultPart(
  part: Extract<V4ToolPart, { type: "tool-result" }>,
): LanguageModelV3ToolResultPart {
  return { ...part, output: normalizeToolOutput(part.output) };
}
/**
 *
 * @param part
 * @param warnings
 */
function normalizeUserPart(part: V4UserPart, warnings?: SharedV4Warning[]): V3UserPart[] {
  if (part.type === "text") return [part];
  warnOnBareMediaType(part.mediaType, warnings);
  switch (part.data.type) {
    case "data":
      return [{ ...part, data: part.data.data }];
    case "text":
      return [{ text: part.data.text, type: "text" }];
    case "url":
      return [{ ...part, data: part.data.url }];
    case "reference":
      throw new UnsupportedFunctionalityError({ functionality: REFERENCE_ERROR });
  }
}

/**
 *
 * @param mediaType
 * @param warnings
 */
function warnOnBareMediaType(mediaType: string, warnings?: SharedV4Warning[]): void {
  if (!warnings || mediaType.includes("/")) return;
  const feature = "bare top-level media type";
  if (!warnings.some((w) => "feature" in w && w.feature === feature)) {
    warnings.push({
      details: `Media type '${mediaType}' has no subtype; it is passed through as-is for the API to interpret.`,
      feature,
      type: "compatibility",
    });
  }
}
