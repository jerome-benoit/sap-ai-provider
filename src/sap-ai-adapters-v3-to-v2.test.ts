/**
 * Unit tests for V3-to-V2 format adapters
 *
 * Tests transformation logic that converts V3 LanguageModel formats
 * to V2 LanguageModel formats for AI SDK 5.x compatibility.
 */

import type {
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import {
  convertFinishReasonV3ToV2,
  convertStreamPartV3ToV2,
  convertStreamV3ToV2,
  convertUsageV3ToV2,
  convertWarningsV3ToV2,
  convertWarningV3ToV2,
} from "./sap-ai-adapters-v3-to-v2.js";

describe("convertFinishReasonV3ToV2", () => {
  it("should convert 'stop' finish reason", () => {
    const v3Reason: LanguageModelV3FinishReason = {
      raw: undefined,
      unified: "stop",
    };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonV3ToV2(v3Reason);
    expect(v2Reason).toBe("stop");
  });

  it("should convert 'length' finish reason", () => {
    const v3Reason: LanguageModelV3FinishReason = {
      raw: "max_tokens",
      unified: "length",
    };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonV3ToV2(v3Reason);
    expect(v2Reason).toBe("length");
  });

  it("should convert 'content-filter' finish reason", () => {
    const v3Reason: LanguageModelV3FinishReason = {
      raw: "content_filter",
      unified: "content-filter",
    };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonV3ToV2(v3Reason);
    expect(v2Reason).toBe("content-filter");
  });

  it("should convert 'tool-calls' finish reason", () => {
    const v3Reason: LanguageModelV3FinishReason = {
      raw: "function_call",
      unified: "tool-calls",
    };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonV3ToV2(v3Reason);
    expect(v2Reason).toBe("tool-calls");
  });

  it("should convert 'error' finish reason", () => {
    const v3Reason: LanguageModelV3FinishReason = {
      raw: "api_error",
      unified: "error",
    };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonV3ToV2(v3Reason);
    expect(v2Reason).toBe("error");
  });

  it("should convert 'other' finish reason", () => {
    const v3Reason: LanguageModelV3FinishReason = {
      raw: "some_custom_reason",
      unified: "other",
    };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonV3ToV2(v3Reason);
    expect(v2Reason).toBe("other");
  });
});

describe("convertUsageV3ToV2", () => {
  it("should convert basic usage with all fields", () => {
    const v3Usage: LanguageModelV3Usage = {
      inputTokens: {
        cacheRead: 20,
        cacheWrite: 10,
        noCache: 70,
        total: 100,
      },
      outputTokens: {
        reasoning: 10,
        text: 40,
        total: 50,
      },
    };

    const v2Usage = convertUsageV3ToV2(v3Usage);

    expect(v2Usage).toEqual({
      cachedInputTokens: 20, // V2 includes cacheRead as cachedInputTokens
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10, // V2 includes reasoning as reasoningTokens
      totalTokens: 150,
    });
  });

  it("should convert usage with only total fields", () => {
    const v3Usage: LanguageModelV3Usage = {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: undefined,
        total: 80,
      },
      outputTokens: {
        reasoning: undefined,
        text: undefined,
        total: 40,
      },
    };

    const v2Usage = convertUsageV3ToV2(v3Usage);

    expect(v2Usage).toEqual({
      cachedInputTokens: undefined,
      inputTokens: 80,
      outputTokens: 40,
      reasoningTokens: undefined,
      totalTokens: 120,
    });
  });

  it("should handle undefined inputTokens total", () => {
    const v3Usage: LanguageModelV3Usage = {
      inputTokens: {
        cacheRead: 10,
        cacheWrite: undefined,
        noCache: undefined,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        total: undefined as any,
      },
      outputTokens: {
        reasoning: undefined,
        text: undefined,
        total: 50,
      },
    };

    const v2Usage = convertUsageV3ToV2(v3Usage);

    expect(v2Usage.inputTokens).toBeUndefined();
    expect(v2Usage.outputTokens).toBe(50);
    expect(v2Usage.totalTokens).toBeUndefined(); // totalTokens should be undefined when inputTokens.total is undefined
  });

  it("should handle undefined outputTokens total", () => {
    const v3Usage: LanguageModelV3Usage = {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: undefined,
        total: 100,
      },
      outputTokens: {
        reasoning: 10,
        text: undefined,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        total: undefined as any,
      },
    };

    const v2Usage = convertUsageV3ToV2(v3Usage);

    expect(v2Usage.inputTokens).toBe(100);
    expect(v2Usage.outputTokens).toBeUndefined();
    expect(v2Usage.totalTokens).toBeUndefined(); // totalTokens should be undefined when outputTokens.total is undefined
  });

  it("should handle zero tokens", () => {
    const v3Usage: LanguageModelV3Usage = {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: undefined,
        total: 0,
      },
      outputTokens: {
        reasoning: undefined,
        text: undefined,
        total: 0,
      },
    };

    const v2Usage = convertUsageV3ToV2(v3Usage);

    expect(v2Usage).toEqual({
      cachedInputTokens: undefined,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: undefined,
      totalTokens: 0,
    });
  });

  it("should handle large token counts", () => {
    const v3Usage: LanguageModelV3Usage = {
      inputTokens: {
        cacheRead: 5000,
        cacheWrite: 1000,
        noCache: 4000,
        total: 10000,
      },
      outputTokens: {
        reasoning: 2000,
        text: 6000,
        total: 8000,
      },
    };

    const v2Usage = convertUsageV3ToV2(v3Usage);

    expect(v2Usage).toEqual({
      cachedInputTokens: 5000,
      inputTokens: 10000,
      outputTokens: 8000,
      reasoningTokens: 2000,
      totalTokens: 18000,
    });
  });
});

describe("convertWarningV3ToV2", () => {
  it("should convert unsupported warning", () => {
    const v3Warning = {
      details: "Model does not support streaming",
      feature: "streaming",
      type: "unsupported" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningV3ToV2(v3Warning);

    // V2 format: mapped to 'other' type with combined message
    expect(v2Warning).toEqual({
      message: "Unsupported feature: streaming. Model does not support streaming",
      type: "other",
    });
  });

  it("should convert compatibility warning", () => {
    const v3Warning = {
      details: "Using compatibility mode for tool calls",
      feature: "tool-calls",
      type: "compatibility" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningV3ToV2(v3Warning);

    expect(v2Warning).toEqual({
      message: "Compatibility mode: tool-calls. Using compatibility mode for tool calls",
      type: "other",
    });
  });

  it("should convert other warning", () => {
    const v3Warning = {
      message: "Some other warning",
      type: "other" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningV3ToV2(v3Warning);

    expect(v2Warning).toEqual({
      message: "Some other warning",
      type: "other",
    });
  });

  it("should convert unsupported warning without details", () => {
    const v3Warning = {
      feature: "some-feature",
      type: "unsupported" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningV3ToV2(v3Warning);

    expect(v2Warning).toEqual({
      message: "Unsupported feature: some-feature",
      type: "other",
    });
  });
});

describe("convertWarningsV3ToV2", () => {
  it("should convert empty warnings array", () => {
    const v3Warnings: SharedV3Warning[] = [];

    const v2Warnings = convertWarningsV3ToV2(v3Warnings);

    expect(v2Warnings).toEqual([]);
  });

  it("should convert single warning", () => {
    const v3Warnings: SharedV3Warning[] = [
      {
        details: "Not supported",
        feature: "streaming",
        type: "unsupported",
      },
    ];

    const v2Warnings = convertWarningsV3ToV2(v3Warnings);

    expect(v2Warnings).toHaveLength(1);
    expect(v2Warnings[0]).toEqual({
      message: "Unsupported feature: streaming. Not supported",
      type: "other",
    });
  });

  it("should convert multiple warnings of different types", () => {
    const v3Warnings: SharedV3Warning[] = [
      {
        feature: "streaming",
        type: "unsupported",
      },
      {
        details: "Using compatibility mode",
        feature: "tool-calls",
        type: "compatibility",
      },
      {
        message: "Custom warning",
        type: "other",
      },
    ];

    const v2Warnings = convertWarningsV3ToV2(v3Warnings);

    expect(v2Warnings).toHaveLength(3);
    expect(v2Warnings[0]).toEqual({
      message: "Unsupported feature: streaming",
      type: "other",
    });
    expect(v2Warnings[1]).toEqual({
      message: "Compatibility mode: tool-calls. Using compatibility mode",
      type: "other",
    });
    expect(v2Warnings[2]).toEqual({
      message: "Custom warning",
      type: "other",
    });
  });
});

describe("convertStreamPartV3ToV2", () => {
  it("should convert finish event with usage and finishReason", () => {
    const v3Part: LanguageModelV3StreamPart = {
      finishReason: { raw: "end_turn", unified: "stop" },
      providerMetadata: { provider: { requestId: "req-123" } },
      type: "finish",
      usage: {
        inputTokens: {
          cacheRead: 20,
          cacheWrite: undefined,
          noCache: undefined,
          total: 100,
        },
        outputTokens: {
          reasoning: 10,
          text: undefined,
          total: 50,
        },
      },
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part.type).toBe("finish");
    if (v2Part.type === "finish") {
      expect(v2Part.finishReason).toBe("stop"); // V2 uses only unified value
      expect(v2Part.usage).toEqual({
        cachedInputTokens: 20,
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 10,
        totalTokens: 150,
      });
      expect(v2Part.providerMetadata).toEqual({ provider: { requestId: "req-123" } });
    }
  });

  it("should convert stream-start event with warnings", () => {
    const v3Part: LanguageModelV3StreamPart = {
      type: "stream-start",
      warnings: [
        {
          details: "Model does not support streaming",
          feature: "streaming",
          type: "unsupported",
        },
      ],
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part.type).toBe("stream-start");
    if (v2Part.type === "stream-start") {
      expect(v2Part.warnings).toHaveLength(1);
      expect(v2Part.warnings[0]).toEqual({
        message: "Unsupported feature: streaming. Model does not support streaming",
        type: "other",
      });
    }
  });

  it("should convert stream-start event with empty warnings", () => {
    const v3Part: LanguageModelV3StreamPart = {
      type: "stream-start",
      warnings: [],
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part.type).toBe("stream-start");
    if (v2Part.type === "stream-start") {
      expect(v2Part.warnings).toEqual([]);
    }
  });

  it("should pass through text-delta events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      delta: "Hello world",
      id: "text-1",
      providerMetadata: { provider: { data: "value" } },
      type: "text-delta",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through text-start events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      id: "text-1",
      providerMetadata: {},
      type: "text-start",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through text-end events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      id: "text-1",
      providerMetadata: {},
      type: "text-end",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through reasoning-delta events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      delta: "Thinking...",
      id: "reasoning-1",
      providerMetadata: {},
      type: "reasoning-delta",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through tool-call events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      input: '{"arg": "value"}',
      toolCallId: "call-123",
      toolName: "getTool",
      type: "tool-call",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through tool-call events with providerExecuted flag", () => {
    const v3Part: LanguageModelV3StreamPart = {
      input: '{"data": "test"}',
      providerExecuted: true,
      toolCallId: "call-456",
      toolName: "executeTool",
      type: "tool-call",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through tool-input-start events with extra V3 fields", () => {
    const v3Part: LanguageModelV3StreamPart = {
      dynamic: true, // V3-only field
      id: "input-1",
      providerExecuted: false,
      providerMetadata: {},
      title: "Search Query", // V3-only field
      toolName: "searchTool",
      type: "tool-input-start",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    // V3-only fields are passed through; V2 consumers will ignore them
    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through tool-input-delta events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      delta: '{"query": "test"}',
      id: "input-1",
      providerMetadata: {},
      type: "tool-input-delta",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through tool-result events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      result: { data: "Search results", status: "success" },
      toolCallId: "call-789",
      toolName: "searchTool",
      type: "tool-result",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through error events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      error: new Error("Stream error"),
      type: "error",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });

  it("should pass through raw events unchanged", () => {
    const v3Part: LanguageModelV3StreamPart = {
      rawValue: { custom: "data" },
      type: "raw",
    };

    const v2Part = convertStreamPartV3ToV2(v3Part);

    expect(v2Part).toEqual(v3Part);
  });
});

describe("convertStreamV3ToV2", () => {
  it("should convert a stream with multiple events", async () => {
    const v3Stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({
          type: "stream-start",
          warnings: [],
        });
        controller.enqueue({
          delta: "Hello",
          id: "text-1",
          type: "text-delta",
        });
        controller.enqueue({
          delta: " world",
          id: "text-1",
          type: "text-delta",
        });
        controller.enqueue({
          finishReason: { raw: undefined, unified: "stop" },
          type: "finish",
          usage: {
            inputTokens: {
              cacheRead: undefined,
              cacheWrite: undefined,
              noCache: undefined,
              total: 10,
            },
            outputTokens: { reasoning: undefined, text: undefined, total: 5 },
          },
        });
        controller.close();
      },
    });

    const v2Events: LanguageModelV2StreamPart[] = [];
    for await (const part of convertStreamV3ToV2(v3Stream)) {
      v2Events.push(part);
    }

    expect(v2Events).toHaveLength(4);
    expect(v2Events[0].type).toBe("stream-start");
    expect(v2Events[1].type).toBe("text-delta");
    expect(v2Events[2].type).toBe("text-delta");
    expect(v2Events[3].type).toBe("finish");
  });

  it("should convert finish event in stream correctly", async () => {
    const v3Stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({
          finishReason: { raw: "max_tokens", unified: "length" },
          type: "finish",
          usage: {
            inputTokens: { cacheRead: 20, cacheWrite: undefined, noCache: undefined, total: 100 },
            outputTokens: { reasoning: 10, text: undefined, total: 50 },
          },
        });
        controller.close();
      },
    });

    const v2Events: LanguageModelV2StreamPart[] = [];
    for await (const part of convertStreamV3ToV2(v3Stream)) {
      v2Events.push(part);
    }

    expect(v2Events).toHaveLength(1);
    expect(v2Events[0].type).toBe("finish");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((v2Events[0] as any).finishReason).toBe("length");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((v2Events[0] as any).usage).toEqual({
      cachedInputTokens: 20,
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 150,
    });
  });

  it("should handle empty streams", async () => {
    const v3Stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.close();
      },
    });

    const v2Events: LanguageModelV2StreamPart[] = [];
    for await (const part of convertStreamV3ToV2(v3Stream)) {
      v2Events.push(part);
    }

    expect(v2Events).toHaveLength(0);
  });

  it("should handle stream with only pass-through events", async () => {
    const v3Stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({
          delta: "Test",
          id: "text-1",
          type: "text-delta",
        });
        controller.enqueue({
          input: "{}",
          toolCallId: "call-1",
          toolName: "tool",
          type: "tool-call",
        });
        controller.close();
      },
    });

    const v2Events: LanguageModelV2StreamPart[] = [];
    for await (const part of convertStreamV3ToV2(v3Stream)) {
      v2Events.push(part);
    }

    expect(v2Events).toHaveLength(2);
    expect(v2Events[0].type).toBe("text-delta");
    expect(v2Events[1].type).toBe("tool-call");
  });

  it("should release reader lock on stream error", async () => {
    const v3Stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.error(new Error("Stream error"));
      },
    });

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const part of convertStreamV3ToV2(v3Stream)) {
        // Should throw before yielding any parts
      }
    }).rejects.toThrow("Stream error");
  });

  it("should convert stream with warnings correctly", async () => {
    const v3Stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({
          type: "stream-start",
          warnings: [
            {
              feature: "test-feature",
              type: "unsupported",
            },
          ],
        });
        controller.close();
      },
    });

    const v2Events: LanguageModelV2StreamPart[] = [];
    for await (const part of convertStreamV3ToV2(v3Stream)) {
      v2Events.push(part);
    }

    expect(v2Events).toHaveLength(1);
    expect(v2Events[0].type).toBe("stream-start");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((v2Events[0] as any).warnings[0]).toEqual({
      message: "Unsupported feature: test-feature",
      type: "other",
    });
  });
});
