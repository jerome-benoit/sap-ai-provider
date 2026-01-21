/**
 * Tests conversion from Vercel AI SDK prompt format to SAP AI SDK ChatMessage format.
 * @see convertToSAPMessages
 */
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

import { InvalidPromptError } from "@ai-sdk/provider";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { convertToSAPMessages } from "./convert-to-sap-messages";

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
      expect(result[0]).toMatchObject({
        content: "Let me check.",
        tool_calls: expect.any(Array) as unknown,
      });
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
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
      expect(result[1]).toMatchObject({ role: "tool", tool_call_id: "call_2" });
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
});
