/**
 * Tests conversion from Vercel AI SDK prompt format to SAP AI SDK ChatMessage format.
 * @see convertToSAPMessages
 */
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

import { InvalidPromptError } from "@ai-sdk/provider";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  convertToSAPMessages,
  escapeOrchestrationPlaceholders,
  unescapeOrchestrationPlaceholders,
} from "./convert-to-sap-messages";

const createUserPrompt = (text: string): LanguageModelV3Prompt => [
  { content: [{ text, type: "text" }], role: "user" },
];
const createSystemPrompt = (content: string): LanguageModelV3Prompt => [
  { content, role: "system" },
];

describe("convertToSAPMessages", () => {
  describe("system messages", () => {
    it("should convert system message", () => {
      const result = convertToSAPMessages(createSystemPrompt("You are helpful."));
      expect(result).toEqual([{ content: "You are helpful.", role: "system" }]);
    });

    it("should handle empty system message", () => {
      const result = convertToSAPMessages([{ content: "", role: "system" }]);
      expect(result).toEqual([{ content: "", role: "system" }]);
    });

    it("should handle large system messages without truncation (100KB+)", () => {
      const largeContent = "S".repeat(100000) + "[SYSTEM_END]";
      const prompt: LanguageModelV3Prompt = [{ content: largeContent, role: "system" }];
      const result = convertToSAPMessages(prompt);
      expect((result[0] as { content: string }).content).toBe(largeContent);
      expect((result[0] as { content: string }).content).toContain("[SYSTEM_END]");
    });
  });

  describe("user messages", () => {
    it("should convert simple text message", () => {
      const result = convertToSAPMessages(createUserPrompt("Hello!"));
      expect(result).toEqual([{ content: "Hello!", role: "user" }]);
    });

    it("should convert multiple text parts as array", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "First part.", type: "text" },
            { text: "Second part.", type: "text" },
          ],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        {
          content: [
            { text: "First part.", type: "text" },
            { text: "Second part.", type: "text" },
          ],
          role: "user",
        },
      ]);
    });

    it("should handle empty content array", () => {
      const result = convertToSAPMessages([{ content: [], role: "user" }]);
      expect(result).toEqual([{ content: [], role: "user" }]);
    });

    it("should handle large user text messages without truncation (100KB+)", () => {
      const largeText = "A".repeat(100000) + "[END_MARKER]";
      const prompt: LanguageModelV3Prompt = [
        { content: [{ text: largeText, type: "text" }], role: "user" },
      ];
      const result = convertToSAPMessages(prompt);
      expect((result[0] as { content: string }).content).toBe(largeText);
      expect((result[0] as { content: string }).content).toHaveLength(
        100000 + "[END_MARKER]".length,
      );
    });

    it("should preserve Unicode characters in large text without corruption", () => {
      const unicodeMix =
        "中文".repeat(10000) +
        "😀🎉🚀".repeat(5000) +
        "éèêë".repeat(10000) +
        "مرحبا".repeat(5000) +
        "[UNICODE_END]";

      const prompt: LanguageModelV3Prompt = [
        { content: [{ text: unicodeMix, type: "text" }], role: "user" },
      ];
      const result = convertToSAPMessages(prompt);
      const content = (result[0] as { content: string }).content;

      expect(content).toBe(unicodeMix);
      expect(content).toContain("中文");
      expect(content).toContain("😀");
      expect(content).toContain("éèêë");
      expect(content).toContain("مرحبا");
      expect(content).toContain("[UNICODE_END]");
    });

    it.each([0, 1, 1024, 2048, 4096, 8192, 16384, 32768, 65536])(
      "should handle content at boundary size %i without truncation",
      (size) => {
        const text = "X".repeat(size);
        const prompt: LanguageModelV3Prompt = [{ content: [{ text, type: "text" }], role: "user" }];
        const result = convertToSAPMessages(prompt);
        expect((result[0] as { content: string }).content).toHaveLength(size);
      },
    );
  });

  describe("assistant messages", () => {
    it("should convert text message", () => {
      const prompt: LanguageModelV3Prompt = [
        { content: [{ text: "Hello there!", type: "text" }], role: "assistant" },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        { content: "Hello there!", role: "assistant", tool_calls: undefined },
      ]);
    });

    it("should handle empty content array", () => {
      const result = convertToSAPMessages([{ content: [], role: "assistant" }]);
      expect(result).toEqual([{ content: "", role: "assistant", tool_calls: undefined }]);
    });

    it("should handle large assistant text messages without truncation (100KB+)", () => {
      const largeText = "B".repeat(100000) + "[ASSISTANT_END]";
      const prompt: LanguageModelV3Prompt = [
        { content: [{ text: largeText, type: "text" }], role: "assistant" },
      ];
      const result = convertToSAPMessages(prompt);
      expect((result[0] as { content: string }).content).toBe(largeText);
      expect((result[0] as { content: string }).content).toContain("[ASSISTANT_END]");
    });

    it("should concatenate multiple large text parts without truncation", () => {
      const part1 = "X".repeat(50000) + "[PART1]";
      const part2 = "Y".repeat(50000) + "[PART2]";
      const part3 = "Z".repeat(50000) + "[PART3]";
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: part1, type: "text" },
            { text: part2, type: "text" },
            { text: part3, type: "text" },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const content = (result[0] as { content: string }).content;
      expect(content).toBe(part1 + part2 + part3);
      expect(content).toContain("[PART1]");
      expect(content).toContain("[PART2]");
      expect(content).toContain("[PART3]");
      expect(content).toHaveLength(150000 + 7 * 3);
    });
  });

  describe("reasoning handling", () => {
    const reasoningPrompt: LanguageModelV3Prompt = [
      {
        content: [
          { text: "Hidden chain of thought", type: "reasoning" },
          { text: "Final answer", type: "text" },
        ],
        role: "assistant",
      },
    ];

    it("should drop reasoning by default", () => {
      const result = convertToSAPMessages(reasoningPrompt);
      expect(result[0]).toEqual({
        content: "Final answer",
        role: "assistant",
        tool_calls: undefined,
      });
    });

    it("should include reasoning when enabled", () => {
      const result = convertToSAPMessages(reasoningPrompt, { includeReasoning: true });
      expect(result[0]).toEqual({
        content: "<think>Hidden chain of thought</think>Final answer",
        role: "assistant",
        tool_calls: undefined,
      });
    });

    it("should handle reasoning-only message by dropping content", () => {
      const prompt: LanguageModelV3Prompt = [
        { content: [{ text: "Thinking...", type: "reasoning" }], role: "assistant" },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([{ content: "", role: "assistant", tool_calls: undefined }]);
    });

    it.each([
      { description: "empty reasoning text (default)", includeReasoning: false },
      { description: "empty reasoning text (enabled)", includeReasoning: true },
    ])("should not produce think tags for $description", ({ includeReasoning }) => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "", type: "reasoning" },
            { text: "Answer", type: "text" },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt, { includeReasoning });
      expect(result[0]).toEqual({ content: "Answer", role: "assistant", tool_calls: undefined });
    });

    it("should handle large reasoning text without truncation when enabled", () => {
      const largeReasoning = "R".repeat(100000) + "[REASONING_END]";
      const normalText = "Final answer";

      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: largeReasoning, type: "reasoning" },
            { text: normalText, type: "text" },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt, { includeReasoning: true });
      const content = (result[0] as { content: string }).content;

      expect(content).toBe(`<think>${largeReasoning}</think>${normalText}`);
      expect(content).toContain("[REASONING_END]");
      expect(content).toContain("Final answer");
    });
  });

  describe("tool calls", () => {
    it("should convert tool call with object input", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: { location: "Tokyo" },
              toolCallId: "call_123",
              toolName: "get_weather",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        {
          content: "",
          role: "assistant",
          tool_calls: [
            {
              function: { arguments: '{"location":"Tokyo"}', name: "get_weather" },
              id: "call_123",
              type: "function",
            },
          ],
        },
      ]);
    });

    it("should not double-encode JSON string input", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: '{"location":"Tokyo"}',
              toolCallId: "call_123",
              toolName: "get_weather",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { tool_calls: { function: { arguments: string } }[] };
      const toolCall = message.tool_calls[0];
      expect(toolCall).toBeDefined();
      expect(toolCall?.function.arguments).toBe('{"location":"Tokyo"}');
    });

    it("should convert multiple tool calls in single message", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: { location: "Tokyo" },
              toolCallId: "call_1",
              toolName: "get_weather",
              type: "tool-call",
            },
            {
              input: { timezone: "JST" },
              toolCallId: "call_2",
              toolName: "get_time",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect((result[0] as { tool_calls: unknown[] }).tool_calls).toHaveLength(2);
    });

    it("should handle text and tool calls together", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "Let me check.", type: "text" },
            {
              input: { location: "Paris" },
              toolCallId: "call_123",
              toolName: "get_weather",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        {
          content: "Let me check.",
          role: "assistant",
          tool_calls: [
            {
              function: {
                arguments: '{"location":"Paris"}',
                name: "get_weather",
              },
              id: "call_123",
              type: "function",
            },
          ],
        },
      ]);
    });

    it("should handle special characters in input", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: { query: 'test "quotes" and \\ backslash' },
              toolCallId: "call_special",
              toolName: "search",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { tool_calls: { function: { arguments: string } }[] };
      const toolCall = message.tool_calls[0];
      expect(toolCall).toBeDefined();
      expect(JSON.parse(toolCall?.function.arguments ?? "{}")).toEqual({
        query: 'test "quotes" and \\ backslash',
      });
    });

    it("should handle tool calls with large JSON arguments without truncation (50KB+)", () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        data: "D".repeat(50),
        id: i,
        marker: i === 999 ? "LAST_ITEM" : `item_${String(i)}`,
      }));
      const largeArgs = { finalMarker: "TOOL_END", items: largeArray };

      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: largeArgs,
              toolCallId: "call_large",
              toolName: "process_large",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { tool_calls: { function: { arguments: string } }[] };
      const toolCall = message.tool_calls[0];
      expect(toolCall).toBeDefined();
      const argsString = toolCall?.function.arguments ?? "";

      const parsed = JSON.parse(argsString) as {
        finalMarker: string;
        items: { marker: string }[];
      };
      expect(parsed.items).toHaveLength(1000);
      expect(parsed.finalMarker).toBe("TOOL_END");
      const lastItem = parsed.items[999];
      expect(lastItem).toBeDefined();
      expect(lastItem?.marker).toBe("LAST_ITEM");
    });

    it("should preserve large string input as-is when valid JSON", () => {
      const largeObject = { data: "E".repeat(50000), marker: "STRING_JSON_END" };
      const largeJsonString = JSON.stringify(largeObject);

      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: largeJsonString,
              toolCallId: "call_string",
              toolName: "process_string",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { tool_calls: { function: { arguments: string } }[] };
      const toolCall = message.tool_calls[0];
      expect(toolCall).toBeDefined();
      const argsString = toolCall?.function.arguments ?? "";

      expect(argsString).toBe(largeJsonString);
      const parsed = JSON.parse(argsString) as { data: string; marker: string };
      expect(parsed.marker).toBe("STRING_JSON_END");
    });

    it("should handle special JSON characters in large tool arguments", () => {
      const specialContent = {
        backslashes: "\\".repeat(10000),
        marker: "SPECIAL_END",
        newlines: "\n".repeat(10000),
        quotes: '"'.repeat(10000),
        tabs: "\t".repeat(10000),
        unicode: "\u0000\u001f\u007f".repeat(1000),
      };

      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              input: specialContent,
              toolCallId: "call_special",
              toolName: "process_special",
              type: "tool-call",
            },
          ],
          role: "assistant",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { tool_calls: { function: { arguments: string } }[] };
      const toolCall = message.tool_calls[0];
      expect(toolCall).toBeDefined();
      const argsString = toolCall?.function.arguments ?? "";

      const parsed = JSON.parse(argsString) as typeof specialContent;
      expect(parsed.quotes).toHaveLength(10000);
      expect(parsed.backslashes).toHaveLength(10000);
      expect(parsed.newlines).toHaveLength(10000);
      expect(parsed.tabs).toHaveLength(10000);
      expect(parsed.marker).toBe("SPECIAL_END");
    });
  });

  describe("tool results", () => {
    it("should convert single tool result", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              output: { type: "json" as const, value: { weather: "sunny" } },
              toolCallId: "call_123",
              toolName: "get_weather",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        {
          content: '{"type":"json","value":{"weather":"sunny"}}',
          role: "tool",
          tool_call_id: "call_123",
        },
      ]);
    });

    it("should convert multiple tool results into separate messages", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              output: { type: "json" as const, value: { weather: "sunny" } },
              toolCallId: "call_1",
              toolName: "get_weather",
              type: "tool-result",
            },
            {
              output: { type: "json" as const, value: { time: "12:00" } },
              toolCallId: "call_2",
              toolName: "get_time",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        {
          content: '{"type":"json","value":{"weather":"sunny"}}',
          role: "tool",
          tool_call_id: "call_1",
        },
        {
          content: '{"type":"json","value":{"time":"12:00"}}',
          role: "tool",
          tool_call_id: "call_2",
        },
      ]);
    });

    it("should handle empty tool content array", () => {
      const result = convertToSAPMessages([{ content: [], role: "tool" }]);
      expect(result).toHaveLength(0);
    });

    it("should handle complex nested output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              output: {
                type: "json" as const,
                value: { nested: { array: [1, 2, { deep: true }], null_value: null } },
              },
              toolCallId: "call_nested",
              toolName: "get_data",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const parsed = JSON.parse((result[0] as { content: string }).content) as unknown;
      expect(parsed).toEqual({
        type: "json",
        value: { nested: { array: [1, 2, { deep: true }], null_value: null } },
      });
    });

    it("should handle tool results with large JSON output without truncation (100KB+)", () => {
      const largeOutput = {
        type: "json" as const,
        value: {
          items: Array.from({ length: 2000 }, (_, i) => ({
            content: "F".repeat(50),
            id: i,
          })),
          resultMarker: "RESULT_END",
        },
      };

      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            {
              output: largeOutput,
              toolCallId: "call_result",
              toolName: "get_data",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const content = (result[0] as { content: string }).content;
      const parsed = JSON.parse(content) as typeof largeOutput;

      expect(parsed.value.items).toHaveLength(2000);
      expect(parsed.value.resultMarker).toBe("RESULT_END");
    });
  });

  describe("multi-modal (images)", () => {
    it("should convert image with base64 data", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "What is this?", type: "text" },
            { data: "base64data", mediaType: "image/png", type: "file" },
          ],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result).toEqual([
        {
          content: [
            { text: "What is this?", type: "text" },
            { image_url: { url: "data:image/png;base64,base64data" }, type: "image_url" },
          ],
          role: "user",
        },
      ]);
    });

    it("should convert image URL directly", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "Describe this", type: "text" },
            {
              data: new URL("https://example.com/image.jpg"),
              mediaType: "image/jpeg",
              type: "file",
            },
          ],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { content: { image_url: { url: string } }[] };
      const content = message.content[1];
      expect(content).toBeDefined();
      expect(content?.image_url.url).toBe("https://example.com/image.jpg");
    });

    it("should convert multiple images", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "Compare", type: "text" },
            { data: "data1", mediaType: "image/png", type: "file" },
            { data: "data2", mediaType: "image/jpeg", type: "file" },
          ],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      expect((result[0] as { content: unknown[] }).content).toHaveLength(3);
    });

    it.each([
      { data: new Uint8Array([137, 80, 78, 71]), description: "Uint8Array" },
      { data: Buffer.from([137, 80, 78, 71]), description: "Buffer" },
    ])("should convert $description image data to base64", ({ data }) => {
      const prompt: LanguageModelV3Prompt = [
        { content: [{ data, mediaType: "image/png", type: "file" }], role: "user" },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { content: { image_url: { url: string } }[] };
      const content = message.content[0];
      expect(content).toBeDefined();
      expect(content?.image_url.url).toMatch(/^data:image\/png;base64,iVBORw==/);
    });

    it("should convert buffer-like object with toString", () => {
      const bufferLike = {
        toString: (encoding?: string) => (encoding === "base64" ? "aGVsbG8=" : "hello"),
      };
      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { data: bufferLike as unknown as Uint8Array, mediaType: "image/png", type: "file" },
          ],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { content: { image_url: { url: string } }[] };
      const content = message.content[0];
      expect(content).toBeDefined();
      expect(content?.image_url.url).toBe("data:image/png;base64,aGVsbG8=");
    });

    it("should handle large base64 image data without truncation (1MB+)", () => {
      const largeBase64 = "A".repeat(1000000) + "END";

      const prompt: LanguageModelV3Prompt = [
        {
          content: [
            { text: "Analyze this image", type: "text" },
            { data: largeBase64, mediaType: "image/png", type: "file" },
          ],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { content: { image_url?: { url: string }; type: string }[] };
      const imageContent = message.content.find((c) => c.type === "image_url");

      expect(imageContent).toBeDefined();
      const imageUrl = imageContent?.image_url?.url;
      expect(imageUrl).toBeDefined();
      expect(imageUrl).toBe(`data:image/png;base64,${largeBase64}`);
      expect(imageUrl).toContain("END");
    });

    it("should handle large Uint8Array image data without truncation", () => {
      const size = 100000;
      const largeData = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        largeData[i] = i % 256;
      }

      const prompt: LanguageModelV3Prompt = [
        {
          content: [{ data: largeData, mediaType: "image/jpeg", type: "file" }],
          role: "user",
        },
      ];
      const result = convertToSAPMessages(prompt);
      const message = result[0] as { content: { image_url: { url: string } }[] };
      const content = message.content[0];
      expect(content).toBeDefined();
      const url = content?.image_url.url ?? "";

      expect(url).toMatch(/^data:image\/jpeg;base64,/);
      const base64Part = url.replace("data:image/jpeg;base64,", "");
      const decoded = Buffer.from(base64Part, "base64");
      expect(decoded).toHaveLength(size);
    });
  });

  describe("full conversation", () => {
    it("should convert multi-turn conversation", () => {
      const prompt: LanguageModelV3Prompt = [
        { content: "You are helpful.", role: "system" },
        { content: [{ text: "Hi", type: "text" }], role: "user" },
        { content: [{ text: "Hello!", type: "text" }], role: "assistant" },
        { content: [{ text: "Thanks", type: "text" }], role: "user" },
      ];
      const result = convertToSAPMessages(prompt);
      expect(result.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    });
  });

  describe("error handling", () => {
    it.each([
      { description: "audio", mediaType: "audio/mp3" },
      { description: "pdf", mediaType: "application/pdf" },
      { description: "video", mediaType: "video/mp4" },
    ])("should throw for unsupported file type: $description", ({ mediaType }) => {
      const prompt: LanguageModelV3Prompt = [
        { content: [{ data: "base64data", mediaType, type: "file" }], role: "user" },
      ];
      expect(() => convertToSAPMessages(prompt)).toThrow("Only image files are supported");
    });

    it("should throw for unknown user content type", () => {
      const prompt = [
        {
          content: [
            { data: "data", type: "unknown_type" } as unknown as { text: string; type: "text" },
          ],
          role: "user",
        },
      ] as LanguageModelV3Prompt;
      expect(() => convertToSAPMessages(prompt)).toThrow("Content type unknown_type");
    });

    it("should throw for unsupported image data type", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          content: [{ data: null as unknown as Uint8Array, mediaType: "image/png", type: "file" }],
          role: "user",
        },
      ];
      expect(() => convertToSAPMessages(prompt)).toThrow("Unsupported file data type for image");
    });

    it("should throw InvalidPromptError for unsupported role", () => {
      const prompt = [
        { content: "Test", role: "unsupported_role" },
      ] as unknown as LanguageModelV3Prompt;
      expect(() => convertToSAPMessages(prompt)).toThrow(InvalidPromptError);
      expect(() => convertToSAPMessages(prompt)).toThrow("Unsupported role: unsupported_role");
    });
  });

  describe("template placeholder escaping", () => {
    const ZERO_WIDTH_SPACE = "\u200B";

    describe("escapeOrchestrationPlaceholders", () => {
      it("should escape opening double braces", () => {
        const input = "Use {{variable}} in your prompt";
        const result = escapeOrchestrationPlaceholders(input);
        // Only {{ is escaped, }} is left as-is to preserve JSON compatibility
        expect(result).toBe(`Use {${ZERO_WIDTH_SPACE}{variable}} in your prompt`);
        expect(result).not.toContain("{{");
      });

      it("should escape optional placeholder syntax", () => {
        const input = "Question: {{?question}}";
        const result = escapeOrchestrationPlaceholders(input);
        expect(result).toBe(`Question: {${ZERO_WIDTH_SPACE}{?question}}`);
      });

      it("should escape multiple placeholders", () => {
        const input = "{{a}} and {{b}} and {{?c}}";
        const result = escapeOrchestrationPlaceholders(input);
        expect(result).not.toContain("{{");
        // Only opening braces are escaped, so 3 zero-width spaces (one per {{)
        expect(result.match(new RegExp(ZERO_WIDTH_SPACE, "g"))).toHaveLength(3);
      });

      it("should handle text without placeholders", () => {
        const input = "Normal text without any braces";
        expect(escapeOrchestrationPlaceholders(input)).toBe(input);
      });

      it("should handle single braces (no escaping needed)", () => {
        const input = "JSON object: { key: value }";
        expect(escapeOrchestrationPlaceholders(input)).toBe(input);
      });

      it("should handle empty string", () => {
        expect(escapeOrchestrationPlaceholders("")).toBe("");
      });

      it("should handle nested braces and preserve JSON structure", () => {
        const input = "{{{nested}}}";
        const result = escapeOrchestrationPlaceholders(input);
        // Only {{ sequences are escaped; }} is left alone to preserve JSON
        expect(result).not.toContain("{{");
        // Should still contain }} since we don't escape closing braces
        expect(result).toContain("}}");
      });

      it("should preserve JSON object structure", () => {
        const input = '{"outer": {"inner": "value"}}';
        const result = escapeOrchestrationPlaceholders(input);
        // No {{ in JSON, so nothing should be escaped
        expect(result).toBe(input);
        // JSON should remain valid
        expect(() => JSON.parse(result) as unknown).not.toThrow();
      });

      it("should escape Jinja2 block statements ({%)", () => {
        const input = "{% for item in items %}{{ item }}{% endfor %}";
        const result = escapeOrchestrationPlaceholders(input);
        expect(result).toBe(
          `{${ZERO_WIDTH_SPACE}% for item in items %}{${ZERO_WIDTH_SPACE}{ item }}{${ZERO_WIDTH_SPACE}% endfor %}`,
        );
        expect(result).not.toContain("{%");
        expect(result).not.toContain("{{");
      });

      it("should escape Jinja2 comments ({#)", () => {
        const input = "{# This is a Jinja2 comment #}";
        const result = escapeOrchestrationPlaceholders(input);
        expect(result).toBe(`{${ZERO_WIDTH_SPACE}# This is a Jinja2 comment #}`);
        expect(result).not.toContain("{#");
      });

      it("should escape all Jinja2 delimiters in mixed content", () => {
        const input = "{{ var }} {% if cond %} {# comment #}";
        const result = escapeOrchestrationPlaceholders(input);
        expect(result).not.toContain("{{");
        expect(result).not.toContain("{%");
        expect(result).not.toContain("{#");
        // 3 delimiters escaped = 3 zero-width spaces
        expect(result.match(new RegExp(ZERO_WIDTH_SPACE, "g"))).toHaveLength(3);
      });

      it("should handle edge case: {{{ (triple brace)", () => {
        const input = "{{{nested}}}";
        const result = escapeOrchestrationPlaceholders(input);
        // First {{ is escaped, remaining { is just a brace
        expect(result).toBe(`{${ZERO_WIDTH_SPACE}{${ZERO_WIDTH_SPACE}{nested}}}`);
      });

      it("should handle overlapping delimiters ({{%)", () => {
        const input = "{{%mixed";
        const result = escapeOrchestrationPlaceholders(input);
        // Both {{ and {% delimiters overlap - the loop escapes {{ first,
        // then the remaining {% is also escaped
        expect(result).toBe(`{${ZERO_WIDTH_SPACE}{${ZERO_WIDTH_SPACE}%mixed`);
      });
    });

    describe("unescapeOrchestrationPlaceholders", () => {
      it("should restore original placeholder syntax", () => {
        const original = "Use {{variable}} in your prompt";
        const escaped = escapeOrchestrationPlaceholders(original);
        const restored = unescapeOrchestrationPlaceholders(escaped);
        expect(restored).toBe(original);
      });

      it("should restore multiple placeholders", () => {
        const original = "{{a}} and {{b}} and {{?c}}";
        const escaped = escapeOrchestrationPlaceholders(original);
        const restored = unescapeOrchestrationPlaceholders(escaped);
        expect(restored).toBe(original);
      });

      it("should handle text without escaped placeholders", () => {
        const input = "Normal text";
        expect(unescapeOrchestrationPlaceholders(input)).toBe(input);
      });

      it("should handle empty string", () => {
        expect(unescapeOrchestrationPlaceholders("")).toBe("");
      });

      it("should restore Jinja2 block statements ({%)", () => {
        const original = "{% for item in items %}{% endfor %}";
        const escaped = escapeOrchestrationPlaceholders(original);
        const restored = unescapeOrchestrationPlaceholders(escaped);
        expect(restored).toBe(original);
      });

      it("should restore Jinja2 comments ({#)", () => {
        const original = "{# comment #}";
        const escaped = escapeOrchestrationPlaceholders(original);
        const restored = unescapeOrchestrationPlaceholders(escaped);
        expect(restored).toBe(original);
      });

      it("should restore all Jinja2 delimiters in mixed content", () => {
        const original = "{{ var }} {% if x %} {# note #}";
        const escaped = escapeOrchestrationPlaceholders(original);
        const restored = unescapeOrchestrationPlaceholders(escaped);
        expect(restored).toBe(original);
      });
    });

    describe("convertToSAPMessages with escapeTemplatePlaceholders", () => {
      it("should escape template placeholders by default", () => {
        const prompt: LanguageModelV3Prompt = [
          { content: [{ text: "Use {{?question}} to ask", type: "text" }], role: "user" },
        ];
        const result = convertToSAPMessages(prompt);
        const content = (result[0] as { content: string }).content;
        expect(content).not.toContain("{{");
        expect(content).toContain(ZERO_WIDTH_SPACE);
      });

      it("should preserve placeholders when escaping disabled", () => {
        const prompt: LanguageModelV3Prompt = [
          { content: [{ text: "Use {{?question}} to ask", type: "text" }], role: "user" },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: false });
        expect((result[0] as { content: string }).content).toContain("{{?question}}");
      });

      it("should escape user message text", () => {
        const prompt: LanguageModelV3Prompt = [
          { content: [{ text: "Use {{?question}} to ask", type: "text" }], role: "user" },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const content = (result[0] as { content: string }).content;
        expect(content).not.toContain("{{");
        expect(content).toContain(ZERO_WIDTH_SPACE);
      });

      it("should escape system message content", () => {
        const prompt: LanguageModelV3Prompt = [
          { content: "You are using {{model}} as your LLM", role: "system" },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const content = (result[0] as { content: string }).content;
        expect(content).not.toContain("{{");
      });

      it("should escape assistant message text", () => {
        const prompt: LanguageModelV3Prompt = [
          { content: [{ text: "Try using {{?input}}", type: "text" }], role: "assistant" },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const content = (result[0] as { content: string }).content;
        expect(content).not.toContain("{{");
      });

      it("should escape tool result content", () => {
        const prompt: LanguageModelV3Prompt = [
          {
            content: [
              {
                output: {
                  type: "json" as const,
                  value: { syntax: "Use {{variable}}", template: "{{?question}}" },
                },
                toolCallId: "call_123",
                toolName: "get_schema",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const content = (result[0] as { content: string }).content;
        expect(content).not.toContain("{{");
        // Verify it's still valid JSON
        expect(() => JSON.parse(content) as unknown).not.toThrow();
      });

      it("should escape tool call arguments", () => {
        const prompt: LanguageModelV3Prompt = [
          {
            content: [
              {
                input: { template: "{{?variable}}" },
                toolCallId: "call_123",
                toolName: "process",
                type: "tool-call",
              },
            ],
            role: "assistant",
          },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const message = result[0] as { tool_calls: { function: { arguments: string } }[] };
        const args = message.tool_calls[0]?.function.arguments ?? "";
        expect(args).not.toContain("{{");
        // JSON structure (with }}) should still be valid
        expect(() => JSON.parse(args) as unknown).not.toThrow();
      });

      it("should escape reasoning content when included", () => {
        const prompt: LanguageModelV3Prompt = [
          {
            content: [
              { text: "Thinking about {{placeholder}}...", type: "reasoning" },
              { text: "Final answer", type: "text" },
            ],
            role: "assistant",
          },
        ];
        const result = convertToSAPMessages(prompt, {
          escapeTemplatePlaceholders: true,
          includeReasoning: true,
        });
        const content = (result[0] as { content: string }).content;
        expect(content).toContain("<think>");
        expect(content).not.toContain("{{placeholder}}");
        expect(content).toContain(ZERO_WIDTH_SPACE);
      });

      it("should handle complex AI agent tool content with placeholder syntax", () => {
        // AI coding agents often have tool schemas with {{?variable}} syntax
        const prompt: LanguageModelV3Prompt = [
          {
            content: [
              {
                output: {
                  type: "json" as const,
                  value: {
                    schema: {
                      properties: {
                        items: {
                          items: {
                            properties: {
                              variable1: { description: "First variable", type: "string" },
                            },
                          },
                          type: "array",
                        },
                      },
                    },
                    template: "Use {{?variable2}} to prompt the user",
                  },
                },
                toolCallId: "call_tool_123",
                toolName: "process",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const content = (result[0] as { content: string }).content;

        // Verify placeholders are escaped (only opening braces)
        expect(content).not.toContain("{{?variable2}}");
        expect(content).not.toContain("{{");

        // Verify it's still valid JSON that can be parsed
        expect(() => JSON.parse(content) as unknown).not.toThrow();
      });

      it("should not modify multi-modal content parts (images)", () => {
        const prompt: LanguageModelV3Prompt = [
          {
            content: [
              { text: "Check {{?image}}", type: "text" },
              { data: "base64data", mediaType: "image/png", type: "file" },
            ],
            role: "user",
          },
        ];
        const result = convertToSAPMessages(prompt, { escapeTemplatePlaceholders: true });
        const message = result[0] as {
          content: { image_url?: { url: string }; text?: string; type: string }[];
        };

        // Text should be escaped
        const textPart = message.content.find((c) => c.type === "text");
        expect(textPart?.text).not.toContain("{{");

        // Image URL should be unchanged
        const imagePart = message.content.find((c) => c.type === "image_url");
        expect(imagePart?.image_url?.url).toBe("data:image/png;base64,base64data");
      });
    });
  });
});
