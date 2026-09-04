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

/** Native cross-realm ArrayBuffer brand descriptor. */
const ARRAY_BUFFER_BYTE_LENGTH_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
);

/** Native Uint8Array length descriptor, immune to subclass overrides. */
const TYPED_ARRAY_LENGTH_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "length",
);

/** Native cross-realm typed array brand descriptor. */
const TYPED_ARRAY_TAG_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  Symbol.toStringTag,
);

/** Native cross-realm URL href descriptor. */
const URL_HREF_DESCRIPTOR = Object.getOwnPropertyDescriptor(URL.prototype, "href");

/**
 * Returns the RFC 4648 value of a base64 character.
 * @param charCode - The character's UTF-16 code unit.
 * @returns The base64 sextet value, or -1 when invalid.
 */
function base64SextetValue(charCode: number): number {
  if (charCode >= 0x41 && charCode <= 0x5a) return charCode - 0x41;
  if (charCode >= 0x61 && charCode <= 0x7a) return charCode - 0x61 + 26;
  if (charCode >= 0x30 && charCode <= 0x39) return charCode - 0x30 + 52;
  if (charCode === 0x2b) return 62;
  if (charCode === 0x2f) return 63;
  return -1;
}

/**
 * Returns the canonical href for genuine URL values across JavaScript realms.
 * @param value - The value to inspect.
 * @returns The URL href, or undefined when the value lacks URL internal slots.
 */
function getURLHref(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || URL_HREF_DESCRIPTOR?.get === undefined) {
    return undefined;
  }
  try {
    const href: unknown = URL_HREF_DESCRIPTOR.get.call(value);
    return typeof href === "string" ? href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detects genuine ArrayBuffer values across JavaScript realms.
 * @param value - The value to inspect.
 * @returns Whether the value has ArrayBuffer internal slots.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (
    typeof value !== "object" ||
    value === null ||
    ARRAY_BUFFER_BYTE_LENGTH_DESCRIPTOR?.get === undefined
  ) {
    return false;
  }
  try {
    ARRAY_BUFFER_BYTE_LENGTH_DESCRIPTOR.get.call(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates canonical RFC 4648 base64 in linear time and constant stack space.
 * @param value - The candidate base64 value.
 * @returns Whether the value is canonical RFC 4648 base64.
 */
function isCanonicalBase64(value: string): boolean {
  const length = value.length;
  if (length % 4 !== 0) return false;

  let padding = 0;
  if (length > 0 && value.charCodeAt(length - 1) === 0x3d) padding++;
  if (length > 1 && value.charCodeAt(length - 2) === 0x3d) padding++;

  const payloadLength = length - padding;
  for (let index = 0; index < payloadLength; index++) {
    if (base64SextetValue(value.charCodeAt(index)) < 0) return false;
  }

  if (padding === 0) return true;
  const lastValue = base64SextetValue(value.charCodeAt(payloadLength - 1));
  return padding === 1 ? (lastValue & 0x03) === 0 : (lastValue & 0x0f) === 0;
}

/**
 * Detects genuine Uint8Array values across JavaScript realms.
 * @param value - The value to inspect.
 * @returns Whether the value has Uint8Array internal slots.
 */
function isUint8Array(value: unknown): value is Uint8Array {
  if (
    typeof value !== "object" ||
    value === null ||
    TYPED_ARRAY_TAG_DESCRIPTOR?.get === undefined
  ) {
    return false;
  }
  try {
    return TYPED_ARRAY_TAG_DESCRIPTOR.get.call(value) === "Uint8Array";
  } catch {
    return false;
  }
}

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
 * Wraps a text payload as a SAP `TextContent` block, attaching `cache_control` when set.
 * @param text - Pre-escaped text payload.
 * @param cacheControl - Optional Anthropic prompt-cache directive.
 * @returns SAP `TextContent` block.
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

  const pushWarningOnce = (feature: string, details: string): void => {
    if (!options.warnings) return;
    if (!options.warnings.some((w) => (w as { feature?: string }).feature === feature)) {
      options.warnings.push({ details, feature, type: "unsupported" });
    }
  };

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
            case "file": {
              pushWarningOnce(
                "file content in assistant message",
                "SAP orchestration assistant messages carry text and tool calls only; file parts are ignored.",
              );
              break;
            }
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
            default: {
              pushWarningOnce(
                "unsupported assistant content",
                "Unsupported assistant content type; part ignored.",
              );
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
          } else {
            pushWarningOnce(
              "non-tool-result content in tool message",
              "Only tool-result parts are forwarded to SAP; other tool content is ignored.",
            );
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
 * Encodes bytes as base64 without the Node.js `Buffer` global (Edge-safe).
 * @internal
 * @param bytes - The bytes to encode.
 * @returns The base64 string (empty string for empty input).
 */
function base64FromBytes(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let byteLength: unknown;
  try {
    byteLength = TYPED_ARRAY_LENGTH_DESCRIPTOR?.get?.call(bytes);
  } catch {
    throw new UnsupportedFunctionalityError({
      functionality: "Invalid Uint8Array file data.",
    });
  }
  if (typeof byteLength !== "number") {
    throw new UnsupportedFunctionalityError({
      functionality: "Invalid Uint8Array file data.",
    });
  }

  const codeUnits = new Array<number>(Math.min(CHUNK_SIZE, byteLength));
  let binary = "";
  for (let offset = 0; offset < byteLength; offset += CHUNK_SIZE) {
    const chunkLength = Math.min(CHUNK_SIZE, byteLength - offset);
    codeUnits.length = chunkLength;
    for (let index = 0; index < chunkLength; index++) {
      const byte = bytes[offset + index];
      if (byte === undefined) {
        throw new UnsupportedFunctionalityError({
          functionality: "Invalid Uint8Array file data.",
        });
      }
      codeUnits[index] = byte;
    }
    binary += String.fromCharCode(...codeUnits);
  }
  return btoa(binary);
}

/**
 * Builds a data URL from a file part's data and media type.
 *
 * Supports URL, base64 string, Uint8Array, ArrayBuffer, and buffer-like objects
 * whose custom `toString("base64")` method returns canonical base64. Other
 * objects are rejected instead of being stringified into an invalid payload.
 * @internal
 * @param part - The file part containing data and mediaType.
 * @param part.data - The file data.
 * @param part.mediaType - The MIME type of the file.
 * @returns The data URL string.
 * @throws {UnsupportedFunctionalityError} If the data type is not supported.
 */
function buildDataUrl(part: { data: unknown; mediaType: string }): string {
  const { data, mediaType } = part;
  const href = getURLHref(data);
  if (href !== undefined) return href;

  if (typeof data === "string") return `data:${mediaType};base64,${data}`;

  if (isUint8Array(data)) {
    return `data:${mediaType};base64,${base64FromBytes(data)}`;
  }

  if (isArrayBuffer(data)) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(data);
    } catch {
      throw new UnsupportedFunctionalityError({
        functionality: "Detached ArrayBuffer file data is unsupported.",
      });
    }
    return `data:${mediaType};base64,${base64FromBytes(bytes)}`;
  }

  if (typeof data === "object" && data !== null) {
    const toString = (data as { toString?: unknown }).toString;
    if (typeof toString === "function" && toString !== Object.prototype.toString) {
      const encoded: unknown = toString.call(data, "base64");
      if (typeof encoded === "string" && isCanonicalBase64(encoded)) {
        return `data:${mediaType};base64,${encoded}`;
      }
    }
  }

  throw new UnsupportedFunctionalityError({
    functionality:
      "Unsupported file data type. Expected base64 string, Uint8Array, ArrayBuffer, URL, or a buffer-like object returning canonical base64.",
  });
}
