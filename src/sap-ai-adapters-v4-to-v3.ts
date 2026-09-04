/** Entry adapter: normalize AI SDK 7 (V4) prompts to the internal V3 format. */

import type {
  LanguageModelV3FilePart,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { resolveFullMediaType } from "@ai-sdk/provider-utils";

import { base64FromBytes, getURLHref } from "./convert-to-sap-messages.js";

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
 * - Bare and wildcard media types are resolved from detectable inline bytes.
 *   Remote `image` and `image/*` URLs are preserved as `image/*`; other
 *   incomplete URL media types are rejected.
 * - `reasoning-file` and `custom` parts are rejected explicitly.
 * - Tool-result outputs are mapped to the V3 output union; nested `content[]`
 *   file items use the legacy `file-data`/`file-url` shapes.
 * - Everything else (text, reasoning, tool calls, approval responses,
 *   provider options) passes through untouched.
 * @param prompt - The V4 prompt received from AI SDK 7.
 * @returns The equivalent V3 prompt for the internal core.
 * @throws {UnsupportedFunctionalityError} For V4-only shapes with no V3 equivalent.
 */
export function normalizeV4PromptToV3(prompt: LanguageModelV4Prompt): LanguageModelV3Prompt {
  return prompt.map((message) => {
    switch (message.role) {
      case "assistant":
        return {
          content: message.content.flatMap((part) => normalizeAssistantPart(part)),
          providerOptions: message.providerOptions,
          role: "assistant",
        };
      case "system":
        return {
          content: message.content,
          providerOptions: message.providerOptions,
          role: "system",
        };
      case "tool":
        return {
          content: message.content.map((part) =>
            part.type === "tool-result" ? normalizeToolResultPart(part) : part,
          ),
          providerOptions: message.providerOptions,
          role: "tool",
        };
      case "user":
        return {
          content: message.content.flatMap((part) => normalizeUserPart(part)),
          providerOptions: message.providerOptions,
          role: "user",
        };
    }
  });
}

/**
 * Normalizes a V4 assistant part to V3 content parts.
 * @param part - The V4 assistant content part.
 * @returns The equivalent V3 content parts.
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
 * Normalizes a V4 tool-output content item to the V3 legacy shape.
 * @param item - The V4 content item.
 * @returns The equivalent V3 content item.
 */
function normalizeContentItem(item: V4ContentItem): V3ToolContentItem {
  if (item.type === "text" || item.type === "custom") return item;
  switch (item.data.type) {
    case "data": {
      const normalizedItem = normalizeMediaType(item);
      return {
        data: typeof item.data.data === "string" ? item.data.data : base64FromBytes(item.data.data),
        ...(item.filename ? { filename: item.filename } : {}),
        mediaType: resolveFullMediaType({ part: normalizedItem }),
        providerOptions: item.providerOptions,
        type: "file-data",
      };
    }
    case "text":
      return { providerOptions: item.providerOptions, text: item.data.text, type: "text" };
    case "url": {
      // Legacy V3 file-url carries no media type; the subtype stays in the URL itself.
      const url = getURLHref(item.data.url);
      if (url === undefined) {
        throw new UnsupportedFunctionalityError({
          functionality: "V4 tool-result URL data is not a genuine URL.",
        });
      }
      return {
        providerOptions: item.providerOptions,
        type: "file-url",
        url,
      };
    }
    case "reference":
      throw new UnsupportedFunctionalityError({ functionality: REFERENCE_ERROR });
  }
}

/**
 * Normalizes a file part's media type at the V4 boundary.
 * @param part - The V4 file part.
 * @returns The original part when already normalized, otherwise a shallow copy.
 */
function normalizeMediaType<T extends { mediaType: string }>(part: T): T {
  const mediaType = part.mediaType.toLowerCase();
  return mediaType === part.mediaType ? part : { ...part, mediaType };
}

/**
 * Normalizes a V4 tool output to its V3 equivalent.
 * @param output - The V4 tool output.
 * @returns The equivalent V3 tool output.
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
 * Normalizes a V4 tool-result part to its V3 equivalent.
 * @param part - The V4 tool-result part.
 * @returns The equivalent V3 tool-result part.
 */
function normalizeToolResultPart(
  part: Extract<V4ToolPart, { type: "tool-result" }>,
): LanguageModelV3ToolResultPart {
  return { ...part, output: normalizeToolOutput(part.output) };
}

/**
 * Normalizes a V4 user part to V3 content parts.
 * @param part - The V4 user content part.
 * @returns The equivalent V3 content parts.
 */
function normalizeUserPart(part: V4UserPart): V3UserPart[] {
  if (part.type === "text") return [part];
  switch (part.data.type) {
    case "data": {
      const normalizedPart = normalizeMediaType(part);
      return [
        {
          ...normalizedPart,
          data: part.data.data,
          mediaType: resolveFullMediaType({ part: normalizedPart }),
        },
      ];
    }
    case "text":
      return [{ providerOptions: part.providerOptions, text: part.data.text, type: "text" }];
    case "url": {
      const normalizedPart = normalizeMediaType(part);
      return [
        {
          ...normalizedPart,
          data: part.data.url,
          mediaType:
            normalizedPart.mediaType === "image" || normalizedPart.mediaType === "image/*"
              ? "image/*"
              : resolveFullMediaType({ part: normalizedPart }),
        },
      ];
    }
    case "reference":
      throw new UnsupportedFunctionalityError({ functionality: REFERENCE_ERROR });
  }
}
