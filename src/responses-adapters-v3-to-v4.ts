/** Input adapter: convert shared V3 calls to the OpenAI Responses V4 delegate contract. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3ToolResultOutput,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { getTopLevelMediaType } from "@ai-sdk/provider-utils";

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
  if (part.type === "file") {
    throw new UnsupportedFunctionalityError({
      functionality: "Responses assistant file history is not supported.",
    });
  }
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
    case "image-data": {
      const delegateIsImage = getTopLevelMediaType(item.mediaType) === "image";
      if (delegateIsImage !== (item.type === "image-data")) {
        throw new UnsupportedFunctionalityError({
          functionality:
            "Responses tool-result media whose legacy category disagrees with its media type.",
        });
      }
      return { ...item, data: { data: item.data, type: "data" }, type: "file" };
    }
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
