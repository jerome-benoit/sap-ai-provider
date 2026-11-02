/** Native Responses history preparation without a V3 normalization boundary. */
import type {
  LanguageModelV4FilePart,
  LanguageModelV4Prompt,
  LanguageModelV4TextPart,
  LanguageModelV4ToolResultPart,
  SharedV4ProviderOptions,
  SharedV4ProviderReference,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";

import { getURLHref } from "./convert-to-sap-messages.js";

/**
 * Preserves supported V4 history and rejects variants the delegate silently omits.
 * @param prompt - Native V4 messages.
 * @param providerName - Configured SAP namespace.
 * @returns Native messages with delegate namespaces and normalized tagged media.
 * @internal
 */
export function prepareResponsesPrompt(
  prompt: LanguageModelV4Prompt,
  providerName: string,
): LanguageModelV4Prompt {
  return prompt.map((message) => {
    const providerOptions = toOpenAIProviderOptions(message.providerOptions, providerName);
    switch (message.role) {
      case "assistant":
        return {
          ...message,
          content: message.content.map((part) => {
            if (part.type === "file" || part.type === "reasoning-file") {
              throw new UnsupportedFunctionalityError({
                functionality: `Responses assistant '${part.type}' history is not supported.`,
              });
            }
            if (part.type === "tool-result") return prepareToolResult(part, providerName);
            const mapped = {
              ...part,
              providerOptions: toOpenAIProviderOptions(part.providerOptions, providerName),
            };
            if (mapped.type === "custom") {
              if (mapped.kind !== "openai.compaction") {
                throw new UnsupportedFunctionalityError({
                  functionality: `Responses assistant custom history '${mapped.kind}' is not supported.`,
                });
              }
              if (mapped.providerOptions?.openai?.itemId == null) {
                throw new UnsupportedFunctionalityError({
                  functionality: "Responses compaction history requires an itemId.",
                });
              }
            }
            return mapped;
          }),
          providerOptions,
        };
      case "system":
        return { ...message, providerOptions };
      case "tool":
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-result"
              ? prepareToolResult(part, providerName)
              : {
                  ...part,
                  providerOptions: toOpenAIProviderOptions(part.providerOptions, providerName),
                },
          ),
          providerOptions,
        };
      case "user":
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "file"
              ? prepareFile(part, providerName)
              : {
                  ...part,
                  providerOptions: toOpenAIProviderOptions(part.providerOptions, providerName),
                },
          ),
          providerOptions,
        };
    }
  });
}

/**
 * Maps the configured SAP namespace to the delegate, with SAP options taking precedence.
 * @param options - Provider options on a message, content part, output, or tool.
 * @param providerName - Configured SAP namespace.
 * @returns Options understood by the native delegate.
 * @internal
 */
export function toOpenAIProviderOptions(
  options: SharedV4ProviderOptions | undefined,
  providerName: string,
): SharedV4ProviderOptions | undefined {
  if (providerName === "openai" || !options?.[providerName]) return options;
  return { ...options, openai: { ...options.openai, ...options[providerName] } };
}

/**
 * Normalizes tagged media without copying bytes or downloading file URLs.
 * @param part - User file or nested tool-output file.
 * @param providerName - Configured SAP namespace.
 * @returns A native tagged file or an equivalent text part.
 */
function prepareFile(
  part: LanguageModelV4FilePart,
  providerName: string,
): LanguageModelV4FilePart | LanguageModelV4TextPart {
  const providerOptions = toOpenAIProviderOptions(part.providerOptions, providerName);
  if (part.data.type === "text") {
    return { providerOptions, text: part.data.text, type: "text" };
  }
  let data = part.data;
  if (data.type === "reference" && providerName !== "openai") {
    const references: Readonly<Record<string, string>> = data.reference;
    const reference = references[providerName];
    if (reference !== undefined) {
      const mappedReference: SharedV4ProviderReference = { ...references, openai: reference };
      data = { ...data, reference: mappedReference };
    }
  } else if (data.type === "url") {
    const href = getURLHref(data.url);
    if (href === undefined) {
      throw new UnsupportedFunctionalityError({
        functionality: "Responses file data is not a genuine URL.",
      });
    }
    if (!(data.url instanceof URL) || data.url.toString !== URL.prototype.toString) {
      data = { ...data, url: new URL(href) };
    }
  }
  return {
    ...part,
    data,
    mediaType: part.mediaType.toLowerCase(),
    providerOptions,
  };
}

/**
 * Translates nested media and output options, including MCP approval identifiers.
 * @param part - Tool result in a tool or assistant message.
 * @param providerName - Configured SAP namespace.
 * @returns The tool result with native output namespaces.
 */
function prepareToolResult(
  part: LanguageModelV4ToolResultPart,
  providerName: string,
): LanguageModelV4ToolResultPart {
  const output = part.output;
  const mapped = {
    ...output,
    providerOptions: toOpenAIProviderOptions(
      "providerOptions" in output ? output.providerOptions : undefined,
      providerName,
    ),
  };
  return {
    ...part,
    output:
      mapped.type === "content"
        ? {
            ...mapped,
            value: mapped.value.map((item) =>
              item.type === "file"
                ? prepareFile(item, providerName)
                : {
                    ...item,
                    providerOptions: toOpenAIProviderOptions(item.providerOptions, providerName),
                  },
            ),
          }
        : mapped,
    providerOptions: toOpenAIProviderOptions(part.providerOptions, providerName),
  };
}
