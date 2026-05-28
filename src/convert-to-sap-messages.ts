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
  type SharedV3Warning,
  UnsupportedFunctionalityError,
} from "@ai-sdk/provider";
import { Buffer } from "node:buffer";

import type { CacheControl, ParsePartProviderOptions } from "./sap-ai-provider-options.js";

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
  /**
   * Optional callback that reads per-part `providerOptions['sap-ai']` (e.g. Anthropic
   * `cacheControl`) and forwards the result onto the SAP message item. Strategies that
   * do not honour part-level directives (Foundation Models) leave this undefined.
   * @default undefined
   */
  readonly parsePartProviderOptions?: ParsePartProviderOptions;
  /**
   * Optional sink for validation warnings raised by `parsePartProviderOptions`.
   * Each invalid `cacheControl` directive (or other future per-part option)
   * surfaces here so the strategy layer can forward the warning to the AI SDK
   * call result rather than dropping it silently.
   */
  readonly warnings?: SharedV3Warning[];
}

/**
 * @internal
 */
const ZERO_WIDTH_SPACE = "\u200B";

/**
 * Safely serializes a value to JSON string, handling edge cases that would cause JSON.stringify to throw.
 *
 * Handles:
 * - Circular references (objects that reference themselves)
 * - BigInt values (converted to string representation)
 * - Undefined values and symbols (handled by JSON.stringify's default behavior)
 * @param value - The value to serialize.
 * @returns JSON string representation, or a fallback string representation if serialization fails.
 * @internal
 */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) =>
      typeof val === "bigint" ? val.toString() : (val as unknown),
    );
  } catch {
    return String(value);
  }
}

/**
 * @param text - Pre-escaped text payload.
 * @param cacheControl - Optional Anthropic prompt-cache directive.
 * @returns SAP `TextContent` block, with `cache_control` attached when the directive is set.
 */
function wrapAsTextContent(
  text: string,
  cacheControl: CacheControl | undefined,
): { cache_control?: CacheControl; text: string; type: "text" } {
  return cacheControl
    ? { cache_control: cacheControl, text, type: "text" }
    : { text, type: "text" };
}

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
  readonly cache_control?: { ttl?: "1h" | "5m"; type: "ephemeral" };
  readonly file?: {
    readonly file_data: string;
    readonly filename?: string;
  };
  readonly image_url?: {
    readonly url: string;
  };
  readonly text?: string;
  readonly type: "file" | "image_url" | "text";
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
 * @param options.parsePartProviderOptions - Optional callback to read per-part `providerOptions['sap-ai']`. Strategies opt in to honour part-level directives such as Anthropic `cacheControl`.
 * @param options.warnings - Optional sink the parser pushes Zod validation issues into.
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

  const parser = options.parsePartProviderOptions;
  const parsePart = parser
    ? (providerOptions: unknown) => parser(providerOptions, options.warnings)
    : () => undefined;

  for (const message of prompt) {
    switch (message.role) {
      case "assistant": {
        let text = "";
        const textParts: {
          cacheControl?: { ttl?: "1h" | "5m"; type: "ephemeral" };
          text: string;
        }[] = [];
        let anyCacheControl = false;
        const toolCalls: {
          function: { arguments: string; name: string };
          id: string;
          type: "function";
        }[] = [];

        for (const part of message.content) {
          switch (part.type) {
            case "reasoning": {
              if (includeReasoning && part.text) {
                const escaped = `<think>${maybeEscape(part.text)}</think>`;
                text += escaped;
                textParts.push({ text: escaped });
              }
              break;
            }
            case "text": {
              const escaped = maybeEscape(part.text);
              if (!escaped) break;
              const partOpts = parsePart(part.providerOptions);
              const cacheControl = partOpts?.cacheControl;
              text += escaped;
              textParts.push(cacheControl ? { cacheControl, text: escaped } : { text: escaped });
              if (cacheControl) anyCacheControl = true;
              break;
            }
            case "tool-call": {
              const partOpts = parsePart(part.providerOptions);
              if (partOpts?.cacheControl && options.warnings) {
                const feature = "cacheControl on assistant tool-call";
                if (
                  !options.warnings.some((w) => (w as { feature?: string }).feature === feature)
                ) {
                  options.warnings.push({
                    details:
                      "SAP orchestration does not expose cache_control on the assistant tool-call envelope.",
                    feature,
                    type: "unsupported",
                  });
                }
              }
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

        if (text || toolCalls.length > 0) {
          const assistantMessage: AssistantChatMessage = {
            content: anyCacheControl
              ? textParts.map((p) => wrapAsTextContent(p.text, p.cacheControl))
              : text,
            role: "assistant",
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          };
          messages.push(assistantMessage);
        }
        break;
      }

      case "system": {
        const partOpts = parsePart(message.providerOptions);
        const cacheControl = partOpts?.cacheControl;
        const text = maybeEscape(message.content);
        const systemMessage: SystemChatMessage = {
          content: cacheControl ? [wrapAsTextContent(text, cacheControl)] : text,
          role: "system",
        };
        messages.push(systemMessage);
        break;
      }

      case "tool": {
        for (const part of message.content) {
          if (part.type === "tool-result") {
            const partOpts = parsePart(part.providerOptions);
            const cacheControl = partOpts?.cacheControl;
            const serializedOutput = safeJsonStringify(part.output);
            const escaped = maybeEscape(serializedOutput);
            const toolMessage: ToolChatMessage = {
              content: cacheControl ? [wrapAsTextContent(escaped, cacheControl)] : escaped,
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
          const partOpts = parsePart(part.providerOptions);
          const cacheControl = partOpts?.cacheControl;
          switch (part.type) {
            case "file": {
              const fileDataUrl = buildDataUrl(part);

              if (part.mediaType.startsWith("image/")) {
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

                contentParts.push({
                  ...(cacheControl ? { cache_control: cacheControl } : {}),
                  image_url: {
                    url: fileDataUrl,
                  },
                  type: "image_url",
                });
              } else {
                contentParts.push({
                  ...(cacheControl ? { cache_control: cacheControl } : {}),
                  file: {
                    file_data: fileDataUrl,
                    ...(part.filename ? { filename: part.filename } : {}),
                  },
                  type: "file",
                });
              }
              break;
            }
            case "text": {
              contentParts.push({
                ...(cacheControl ? { cache_control: cacheControl } : {}),
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
          contentParts.length === 1 &&
          firstPart?.type === "text" &&
          firstPart.cache_control === undefined
            ? {
                content: firstPart.text ?? "",
                role: "user",
              }
            : {
                content: contentParts,
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

/**
 * Builds a data URL from a file part's data and media type.
 *
 * Supports URL, base64 string, Uint8Array, Buffer, and buffer-like objects.
 * @internal
 * @param part - The file part containing data and mediaType.
 * @param part.data - The file data as URL, base64 string, or Uint8Array.
 * @param part.mediaType - The MIME type of the file.
 * @returns The data URL string.
 * @throws {UnsupportedFunctionalityError} If the data type is not supported.
 */
function buildDataUrl(part: { data: string | Uint8Array | URL; mediaType: string }): string {
  if (part.data instanceof URL) {
    return part.data.toString();
  }

  if (typeof part.data === "string") {
    return `data:${part.mediaType};base64,${part.data}`;
  }

  if (part.data instanceof Uint8Array) {
    const base64Data = Buffer.from(part.data).toString("base64");
    return `data:${part.mediaType};base64,${base64Data}`;
  }

  if (Buffer.isBuffer(part.data)) {
    const base64Data = Buffer.from(part.data).toString("base64");
    return `data:${part.mediaType};base64,${base64Data}`;
  }

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
    return `data:${part.mediaType};base64,${base64Data}`;
  }

  throw new UnsupportedFunctionalityError({
    functionality: "Unsupported file data type. Expected URL, base64 string, or Uint8Array.",
  });
}
