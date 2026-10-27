/** Normalizes AI SDK 5 prompt media for the shared V3 core. */
import type {
  LanguageModelV2Prompt,
  LanguageModelV2ToolResultOutput,
  LanguageModelV2ToolResultPart,
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider";

import { resolveFullMediaType } from "@ai-sdk/provider-utils";

type V3ToolContentItem = Extract<
  LanguageModelV3ToolResultOutput,
  { type: "content" }
>["value"][number];

/**
 * Converts legacy tool media while preserving other V2 and compatible V3 parts.
 * @param prompt - The V2 prompt or compatible V3 history.
 * @returns Prompt content understood by the V3 strategies.
 * @internal
 */
export function normalizeV2PromptToV3(
  prompt: LanguageModelV2Prompt | LanguageModelV3Prompt,
): LanguageModelV3Prompt {
  return prompt.map((message) => {
    switch (message.role) {
      case "assistant":
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-result" ? normalizeToolResultPart(part) : part,
          ),
        };
      case "tool":
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-result" ? normalizeToolResultPart(part) : part,
          ),
        };
      default:
        return message;
    }
  });
}

/**
 * Normalizes media in a tool output without changing scalar or error outputs.
 * @param output - Legacy or compatible tool output.
 * @returns Tool output with V3 media discriminators.
 */
function normalizeToolOutput(
  output: LanguageModelV2ToolResultOutput | LanguageModelV3ToolResultOutput,
): LanguageModelV3ToolResultOutput {
  if (output.type !== "content") return output;
  return {
    ...output,
    value: output.value.map((item): V3ToolContentItem => {
      if (item.type !== "media") return item;
      const mediaType = resolveFullMediaType({
        part: {
          data: { data: item.data, type: "data" },
          mediaType: item.mediaType.toLowerCase(),
          type: "file",
        },
      });
      return {
        ...item,
        mediaType,
        type: mediaType.startsWith("image/") ? "image-data" : "file-data",
      };
    }),
  };
}

/**
 * Preserves tool-result metadata while adapting its nested media content.
 * @param part - Legacy or compatible tool result.
 * @returns The tool result understood by the V3 core.
 */
function normalizeToolResultPart(
  part: LanguageModelV2ToolResultPart | LanguageModelV3ToolResultPart,
): LanguageModelV3ToolResultPart {
  return { ...part, output: normalizeToolOutput(part.output) };
}
