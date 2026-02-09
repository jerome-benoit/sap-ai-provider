import type {
  AssistantChatMessage,
  ChatMessage,
  SystemChatMessage,
  ToolChatMessage,
  UserChatMessage,
} from "@sap-ai-sdk/orchestration";

import {
  InvalidPromptError,
  LanguageModelV3Prompt,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider";
import { Buffer } from "node:buffer";

/**
 * Options for converting Vercel AI SDK prompts to SAP AI SDK messages.
 * @see {@link convertToSAPMessages}
 */
export interface ConvertToSAPMessagesOptions {
  /**
   * Whether to escape Jinja2 template delimiters (`{{`, `{%`, `{#`) in message content.
   * This prevents SAP orchestration from interpreting user content as template syntax.
   * @default true
   */
  readonly escapeTemplatePlaceholders?: boolean;
  /**
   * Whether to include assistant reasoning parts (wrapped in `<think>` tags).
   * @default false
   */
  readonly includeReasoning?: boolean;
}

/**
 * @internal
 */
const ZERO_WIDTH_SPACE = "\u200B";

/**
 * @internal
 */
const JINJA2_DELIMITERS_PATTERN = /\{(?=[{%#])/g;

/**
 * @internal
 */
const JINJA2_DELIMITERS_ESCAPED_PATTERN = new RegExp(`\\{${ZERO_WIDTH_SPACE}([{%#])`, "g");

/**
 * @internal
 */
interface UserContentItem {
  readonly image_url?: {
    readonly url: string;
  };
  readonly text?: string;
  readonly type: "image_url" | "text";
}

/**
 * Converts Vercel AI SDK prompt to SAP AI SDK ChatMessage array.
 *
 * Handles all Vercel AI SDK message types:
 * - `system` → `SystemChatMessage`
 * - `user` (text/images) → `UserChatMessage`
 * - `assistant` (text/tool-calls) → `AssistantChatMessage`
 * - `tool` (tool results) → `ToolChatMessage`
 * @param prompt - The Vercel AI SDK LanguageModelV3Prompt to convert.
 * @param options - Conversion options.
 * @param options.escapeTemplatePlaceholders - Whether to escape Jinja2 template delimiters (default: true).
 * @param options.includeReasoning - Whether to include assistant reasoning parts (default: false).
 * @returns SAP AI SDK ChatMessage array ready for orchestration requests.
 * @throws {UnsupportedFunctionalityError} When encountering unsupported content types or file formats.
 * @throws {InvalidPromptError} When encountering unsupported message roles.
 */
export function convertToSAPMessages(
  prompt: LanguageModelV3Prompt,
  options: ConvertToSAPMessagesOptions = {},
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const includeReasoning = options.includeReasoning ?? false;
  const escapeTemplatePlaceholders = options.escapeTemplatePlaceholders ?? true;

  const maybeEscape = (text: string): string =>
    escapeTemplatePlaceholders ? escapeOrchestrationPlaceholders(text) : text;

  for (const message of prompt) {
    switch (message.role) {
      case "assistant": {
        let text = "";
        const toolCalls: {
          function: { arguments: string; name: string };
          id: string;
          type: "function";
        }[] = [];

        for (const part of message.content) {
          switch (part.type) {
            case "reasoning": {
              if (includeReasoning && part.text) {
                text += `<think>${maybeEscape(part.text)}</think>`;
              }
              break;
            }
            case "text": {
              text += maybeEscape(part.text);
              break;
            }
            case "tool-call": {
              // Normalize tool call input to JSON string (Vercel AI SDK provides strings or objects)
              let argumentsJson: string;
              if (typeof part.input === "string") {
                argumentsJson = part.input;
              } else {
                argumentsJson = JSON.stringify(part.input);
              }

              // Escape tool call arguments if needed (they may contain placeholder syntax)
              toolCalls.push({
                function: {
                  arguments: maybeEscape(argumentsJson),
                  name: part.toolName,
                },
                id: part.toolCallId,
                type: "function",
              });
              break;
            }
          }
        }

        const assistantMessage: AssistantChatMessage = {
          content: text || "",
          role: "assistant",
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        messages.push(assistantMessage);
        break;
      }

      case "system": {
        const systemMessage: SystemChatMessage = {
          content: maybeEscape(message.content),
          role: "system",
        };
        messages.push(systemMessage);
        break;
      }

      case "tool": {
        for (const part of message.content) {
          if (part.type === "tool-result") {
            const serializedOutput = JSON.stringify(part.output);
            const toolMessage: ToolChatMessage = {
              content: maybeEscape(serializedOutput),
              role: "tool",
              tool_call_id: part.toolCallId,
            };
            messages.push(toolMessage);
          }
        }
        break;
      }

      case "user": {
        const contentParts: UserContentItem[] = [];

        for (const part of message.content) {
          switch (part.type) {
            case "file": {
              if (!part.mediaType.startsWith("image/")) {
                throw new UnsupportedFunctionalityError({
                  functionality: "Only image files are supported",
                });
              }

              const supportedFormats = [
                "image/png",
                "image/jpeg",
                "image/jpg",
                "image/gif",
                "image/webp",
              ];
              if (!supportedFormats.includes(part.mediaType.toLowerCase())) {
                console.warn(
                  `Image format ${part.mediaType} may not be supported by all models. ` +
                    `Recommended formats: PNG, JPEG, GIF, WebP`,
                );
              }

              let imageUrl: string;
              if (part.data instanceof URL) {
                imageUrl = part.data.toString();
              } else if (typeof part.data === "string") {
                imageUrl = `data:${part.mediaType};base64,${part.data}`;
              } else if (part.data instanceof Uint8Array) {
                const base64Data = Buffer.from(part.data).toString("base64");
                imageUrl = `data:${part.mediaType};base64,${base64Data}`;
              } else if (Buffer.isBuffer(part.data)) {
                const base64Data = Buffer.from(part.data).toString("base64");
                imageUrl = `data:${part.mediaType};base64,${base64Data}`;
              } else {
                const maybeBufferLike = part.data as unknown;

                if (
                  maybeBufferLike !== null &&
                  typeof maybeBufferLike === "object" &&
                  "toString" in (maybeBufferLike as Record<string, unknown>)
                ) {
                  const base64Data = (
                    maybeBufferLike as {
                      toString: (encoding?: string) => string;
                    }
                  ).toString("base64");
                  imageUrl = `data:${part.mediaType};base64,${base64Data}`;
                } else {
                  throw new UnsupportedFunctionalityError({
                    functionality:
                      "Unsupported file data type for image. Expected URL, base64 string, or Uint8Array.",
                  });
                }
              }

              contentParts.push({
                image_url: {
                  url: imageUrl,
                },
                type: "image_url",
              });
              break;
            }
            case "text": {
              contentParts.push({
                text: maybeEscape(part.text),
                type: "text",
              });
              break;
            }
            default: {
              throw new UnsupportedFunctionalityError({
                functionality: `Content type ${(part as { type: string }).type}`,
              });
            }
          }
        }

        const firstPart = contentParts[0];
        const userMessage: UserChatMessage =
          contentParts.length === 1 && firstPart?.type === "text"
            ? {
                content: firstPart.text ?? "",
                role: "user",
              }
            : {
                content: contentParts as UserChatMessage["content"],
                role: "user",
              };

        messages.push(userMessage);
        break;
      }

      default: {
        const _exhaustiveCheck: never = message;
        throw new InvalidPromptError({
          message: `Unsupported role: ${(_exhaustiveCheck as { role: string }).role}`,
          prompt: JSON.stringify(message),
        });
      }
    }
  }

  return messages;
}

/**
 * Escapes Jinja2 template delimiters by inserting zero-width spaces.
 *
 * Converts `{{`, `{%`, `{#` to `{\u200B{`, `{\u200B%`, `{\u200B#` respectively.
 * This prevents SAP orchestration from interpreting user content as template syntax.
 * @param text - The text to escape.
 * @returns The escaped text with zero-width spaces inserted.
 * @see {@link unescapeOrchestrationPlaceholders} for the reverse operation.
 */
export function escapeOrchestrationPlaceholders(text: string): string {
  if (!text) return text;
  return text.replaceAll(JINJA2_DELIMITERS_PATTERN, `{${ZERO_WIDTH_SPACE}`);
}

/**
 * Reverses escaping by removing zero-width spaces from template delimiters.
 *
 * Useful for processing model responses that may contain escaped delimiters.
 * @param text - The text to unescape.
 * @returns The unescaped text with zero-width spaces removed.
 * @see {@link escapeOrchestrationPlaceholders} for the escaping operation.
 */
export function unescapeOrchestrationPlaceholders(text: string): string {
  if (!text) return text;
  return text.replaceAll(JINJA2_DELIMITERS_ESCAPED_PATTERN, "{$1");
}
