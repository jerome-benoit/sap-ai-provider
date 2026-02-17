/** Unit tests for internal-to-V2 format adapters. */

import type {
  LanguageModelV3FinishReason as InternalFinishReason,
  LanguageModelV3StreamPart as InternalStreamPart,
  LanguageModelV3Usage as InternalUsage,
  SharedV3Warning as InternalWarning,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import {
  convertFinishReasonToV2,
  convertProviderMetadataToV2,
  convertStreamPartToV2,
  convertUsageToV2,
  convertWarningsToV2,
  convertWarningToV2,
  createV2StreamFromInternal,
} from "./sap-ai-adapters-v3-to-v2.js";

describe("convertProviderMetadataToV2", () => {
  it("should return undefined for undefined input", () => {
    const result = convertProviderMetadataToV2(undefined);
    expect(result).toBeUndefined();
  });

  it("should pass through provider metadata unchanged", () => {
    const metadata = { provider: { key: "value", nested: { a: 1 } } };
    const result = convertProviderMetadataToV2(metadata);
    expect(result).toEqual(metadata);
  });

  it("should handle empty metadata object", () => {
    const metadata = {};
    const result = convertProviderMetadataToV2(metadata);
    expect(result).toEqual({});
  });

  it("should handle metadata with multiple providers", () => {
    const metadata = {
      anthropic: { cacheControl: true },
      openai: { requestId: "req-123" },
    };
    const result = convertProviderMetadataToV2(metadata);
    expect(result).toEqual(metadata);
  });
});

describe("convertFinishReasonToV2", () => {
  it.each([
    { expected: "stop", raw: undefined, unified: "stop" },
    { expected: "length", raw: "max_tokens", unified: "length" },
    { expected: "content-filter", raw: "content_filter", unified: "content-filter" },
    { expected: "tool-calls", raw: "function_call", unified: "tool-calls" },
    { expected: "error", raw: "api_error", unified: "error" },
    { expected: "other", raw: "some_custom_reason", unified: "other" },
  ] as const)("should convert '$unified' finish reason", ({ expected, raw, unified }) => {
    const internalReason: InternalFinishReason = { raw, unified };
    const v2Reason: LanguageModelV2FinishReason = convertFinishReasonToV2(internalReason);
    expect(v2Reason).toBe(expected);
  });
});

describe("convertUsageToV2", () => {
  it("should convert basic usage with all fields", () => {
    const internalUsage: InternalUsage = {
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

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage).toEqual({
      cachedInputTokens: 20,
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 150,
    });
  });

  it("should convert usage with only total fields", () => {
    const internalUsage: InternalUsage = {
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

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage).toEqual({
      cachedInputTokens: undefined,
      inputTokens: 80,
      outputTokens: 40,
      reasoningTokens: undefined,
      totalTokens: 120,
    });
  });

  it("should handle undefined inputTokens total", () => {
    const internalUsage: InternalUsage = {
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

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage.inputTokens).toBeUndefined();
    expect(v2Usage.outputTokens).toBe(50);
    expect(v2Usage.totalTokens).toBeUndefined();
  });

  it("should handle undefined outputTokens total", () => {
    const internalUsage: InternalUsage = {
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

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage.inputTokens).toBe(100);
    expect(v2Usage.outputTokens).toBeUndefined();
    expect(v2Usage.totalTokens).toBeUndefined();
  });

  it("should handle zero tokens", () => {
    const internalUsage: InternalUsage = {
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

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage).toEqual({
      cachedInputTokens: undefined,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: undefined,
      totalTokens: 0,
    });
  });

  it("should handle large token counts", () => {
    const internalUsage: InternalUsage = {
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

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage).toEqual({
      cachedInputTokens: 5000,
      inputTokens: 10000,
      outputTokens: 8000,
      reasoningTokens: 2000,
      totalTokens: 18000,
    });
  });
});

describe("convertWarningToV2", () => {
  it("should convert unsupported warning", () => {
    const internalWarning = {
      details: "Model does not support streaming",
      feature: "streaming",
      type: "unsupported" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningToV2(internalWarning);

    expect(v2Warning).toEqual({
      message: "Unsupported feature: streaming. Model does not support streaming",
      type: "other",
    });
  });

  it("should convert compatibility warning", () => {
    const internalWarning = {
      details: "Using compatibility mode for tool calls",
      feature: "tool-calls",
      type: "compatibility" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningToV2(internalWarning);

    expect(v2Warning).toEqual({
      message: "Compatibility mode: tool-calls. Using compatibility mode for tool calls",
      type: "other",
    });
  });

  it("should convert compatibility warning without details", () => {
    const internalWarning = {
      feature: "some-feature",
      type: "compatibility" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningToV2(internalWarning);

    expect(v2Warning).toEqual({
      message: "Compatibility mode: some-feature",
      type: "other",
    });
  });

  it("should convert other warning", () => {
    const internalWarning = {
      message: "Some other warning",
      type: "other" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningToV2(internalWarning);

    expect(v2Warning).toEqual({
      message: "Some other warning",
      type: "other",
    });
  });

  it("should convert unsupported warning without details", () => {
    const internalWarning = {
      feature: "some-feature",
      type: "unsupported" as const,
    };

    const v2Warning: LanguageModelV2CallWarning = convertWarningToV2(internalWarning);

    expect(v2Warning).toEqual({
      message: "Unsupported feature: some-feature",
      type: "other",
    });
  });
});

describe("convertWarningsToV2", () => {
  it("should convert empty warnings array", () => {
    const internalWarnings: InternalWarning[] = [];

    const v2Warnings = convertWarningsToV2(internalWarnings);

    expect(v2Warnings).toEqual([]);
  });

  it("should convert single warning", () => {
    const internalWarnings: InternalWarning[] = [
      {
        details: "Not supported",
        feature: "streaming",
        type: "unsupported",
      },
    ];

    const v2Warnings = convertWarningsToV2(internalWarnings);

    expect(v2Warnings).toHaveLength(1);
    expect(v2Warnings[0]).toEqual({
      message: "Unsupported feature: streaming. Not supported",
      type: "other",
    });
  });

  it("should convert multiple warnings of different types", () => {
    const internalWarnings: InternalWarning[] = [
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

    const v2Warnings = convertWarningsToV2(internalWarnings);

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

describe("convertStreamPartToV2", () => {
  it("should dispatch finish event to conversion functions", () => {
    const internalPart: InternalStreamPart = {
      finishReason: { raw: "end_turn", unified: "stop" },
      type: "finish",
      usage: {
        inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: undefined, total: 10 },
        outputTokens: { reasoning: undefined, text: undefined, total: 5 },
      },
    };

    const v2Part = convertStreamPartToV2(internalPart);

    expect(v2Part).not.toBeNull();
    expect(v2Part?.type).toBe("finish");
    // Verify dispatch happened (finishReason and usage are converted)
    if (v2Part?.type === "finish") {
      expect(typeof v2Part.finishReason).toBe("string");
      expect(v2Part.usage).toHaveProperty("inputTokens");
      expect(v2Part.usage).toHaveProperty("outputTokens");
    }
  });

  it("should dispatch stream-start event to warnings conversion", () => {
    const internalPart: InternalStreamPart = {
      type: "stream-start",
      warnings: [{ feature: "test", type: "unsupported" }],
    };

    const v2Part = convertStreamPartToV2(internalPart);

    expect(v2Part?.type).toBe("stream-start");
    if (v2Part?.type === "stream-start") {
      expect(Array.isArray(v2Part.warnings)).toBe(true);
    }
  });

  it("should pass through text-delta events with providerMetadata cast", () => {
    const v2Part = convertStreamPartToV2({
      delta: "Hello",
      id: "text-1",
      providerMetadata: { provider: { key: "value" } },
      type: "text-delta",
    });

    expect(v2Part?.type).toBe("text-delta");
  });

  it("should pass through text-start and text-end events", () => {
    expect(convertStreamPartToV2({ id: "1", type: "text-start" })?.type).toBe("text-start");
    expect(convertStreamPartToV2({ id: "1", type: "text-end" })?.type).toBe("text-end");
  });

  it("should pass through reasoning events", () => {
    expect(convertStreamPartToV2({ id: "1", type: "reasoning-start" })?.type).toBe(
      "reasoning-start",
    );
    expect(convertStreamPartToV2({ delta: "...", id: "1", type: "reasoning-delta" })?.type).toBe(
      "reasoning-delta",
    );
    expect(convertStreamPartToV2({ id: "1", type: "reasoning-end" })?.type).toBe("reasoning-end");
  });

  it("should remove V3-only dynamic field from tool-call", () => {
    const v2Part = convertStreamPartToV2({
      dynamic: true,
      input: "{}",
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-call",
    });

    expect(v2Part?.type).toBe("tool-call");
    expect(v2Part).not.toHaveProperty("dynamic");
  });

  it("should preserve providerExecuted on tool-call", () => {
    const v2Part = convertStreamPartToV2({
      input: "{}",
      providerExecuted: true,
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-call",
    });

    if (v2Part?.type === "tool-call") {
      expect(v2Part.providerExecuted).toBe(true);
    }
  });

  it("should not include undefined optional properties on tool-call", () => {
    const v2Part = convertStreamPartToV2({
      input: "{}",
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-call",
    });

    expect(v2Part?.type).toBe("tool-call");
    expect(v2Part).not.toHaveProperty("providerExecuted");
    expect(v2Part).not.toHaveProperty("providerMetadata");
  });

  it("should remove V3-only fields (dynamic, title) from tool-input-start", () => {
    const v2Part = convertStreamPartToV2({
      dynamic: true,
      id: "input-1",
      title: "Search Query",
      toolName: "searchTool",
      type: "tool-input-start",
    });

    expect(v2Part?.type).toBe("tool-input-start");
    expect(v2Part).not.toHaveProperty("dynamic");
    expect(v2Part).not.toHaveProperty("title");
  });

  it("should preserve providerExecuted on tool-input-start", () => {
    const v2Part = convertStreamPartToV2({
      id: "input-1",
      providerExecuted: true,
      toolName: "searchTool",
      type: "tool-input-start",
    });

    if (v2Part?.type === "tool-input-start") {
      expect(v2Part.providerExecuted).toBe(true);
    }
  });

  it("should not include undefined optional properties on tool-input-start", () => {
    const v2Part = convertStreamPartToV2({
      id: "input-1",
      toolName: "searchTool",
      type: "tool-input-start",
    });

    expect(v2Part?.type).toBe("tool-input-start");
    expect(v2Part).not.toHaveProperty("providerExecuted");
    expect(v2Part).not.toHaveProperty("providerMetadata");
  });

  it("should pass through tool-input-delta and tool-input-end", () => {
    expect(convertStreamPartToV2({ delta: "{}", id: "1", type: "tool-input-delta" })?.type).toBe(
      "tool-input-delta",
    );
    expect(convertStreamPartToV2({ id: "1", type: "tool-input-end" })?.type).toBe("tool-input-end");
  });

  it("should map V3 dynamic to V2 providerExecuted in tool-result", () => {
    const v2Part = convertStreamPartToV2({
      dynamic: true,
      result: {},
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-result",
    });

    expect(v2Part?.type).toBe("tool-result");
    if (v2Part?.type === "tool-result") {
      expect(v2Part.providerExecuted).toBe(true);
    }
    expect(v2Part).not.toHaveProperty("dynamic");
  });

  it("should remove V3-only preliminary field from tool-result", () => {
    const v2Part = convertStreamPartToV2({
      preliminary: true,
      result: {},
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-result",
    });

    expect(v2Part).not.toHaveProperty("preliminary");
  });

  it("should preserve isError on tool-result", () => {
    const v2Part = convertStreamPartToV2({
      isError: true,
      result: { error: "something failed" },
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-result",
    });

    if (v2Part?.type === "tool-result") {
      expect(v2Part.isError).toBe(true);
    }
  });

  it("should not include undefined optional properties on tool-result", () => {
    const v2Part = convertStreamPartToV2({
      result: {},
      toolCallId: "call-1",
      toolName: "tool",
      type: "tool-result",
    });

    expect(v2Part?.type).toBe("tool-result");
    expect(v2Part).not.toHaveProperty("isError");
    expect(v2Part).not.toHaveProperty("providerExecuted");
    expect(v2Part).not.toHaveProperty("providerMetadata");
  });

  it("should pass through error and raw events unchanged", () => {
    const errorPart = { error: new Error("test"), type: "error" as const };
    const rawPart = { rawValue: { data: 1 }, type: "raw" as const };

    expect(convertStreamPartToV2(errorPart)).toEqual(errorPart);
    expect(convertStreamPartToV2(rawPart)).toEqual(rawPart);
  });

  it("should return null for V3-only tool-approval-request", () => {
    const v2Part = convertStreamPartToV2({
      approvalId: "approval-1",
      toolCallId: "call-1",
      type: "tool-approval-request",
    });

    expect(v2Part).toBeNull();
  });

  it("should remove V3-only providerMetadata from file event", () => {
    const v2Part = convertStreamPartToV2({
      data: "base64==",
      mediaType: "image/png",
      providerMetadata: { provider: { id: "123" } },
      type: "file",
    });

    expect(v2Part?.type).toBe("file");
    expect(v2Part).not.toHaveProperty("providerMetadata");
  });

  it("should handle source event with url sourceType", () => {
    const v2Part = convertStreamPartToV2({
      id: "src-1",
      sourceType: "url",
      title: "Source",
      type: "source",
      url: "https://example.com",
    });

    expect(v2Part?.type).toBe("source");
    if (v2Part?.type === "source") {
      expect(v2Part.sourceType).toBe("url");
    }
  });

  it("should handle source event with document sourceType", () => {
    const v2Part = convertStreamPartToV2({
      id: "src-2",
      mediaType: "application/pdf",
      sourceType: "document",
      title: "Doc",
      type: "source",
    });

    expect(v2Part?.type).toBe("source");
    if (v2Part?.type === "source") {
      expect(v2Part.sourceType).toBe("document");
    }
  });

  it("should cast providerMetadata on source (url)", () => {
    const v2Part = convertStreamPartToV2({
      id: "src-3",
      providerMetadata: { provider: { relevance: 0.95 } },
      sourceType: "url",
      title: "Source with metadata",
      type: "source",
      url: "https://example.com/doc",
    });

    expect(v2Part?.type).toBe("source");
    if (v2Part?.type === "source" && v2Part.sourceType === "url") {
      expect(v2Part.providerMetadata).toEqual({ provider: { relevance: 0.95 } });
    }
  });

  it("should cast providerMetadata and preserve filename on source (document)", () => {
    const v2Part = convertStreamPartToV2({
      filename: "report.pdf",
      id: "src-4",
      mediaType: "application/pdf",
      providerMetadata: { provider: { pageCount: 10 } },
      sourceType: "document",
      title: "Document with metadata",
      type: "source",
    });

    expect(v2Part?.type).toBe("source");
    if (v2Part?.type === "source" && v2Part.sourceType === "document") {
      expect(v2Part.providerMetadata).toEqual({ provider: { pageCount: 10 } });
      expect(v2Part.filename).toBe("report.pdf");
    }
  });

  it("should pass through response-metadata events", () => {
    const v2Part = convertStreamPartToV2({
      id: "resp-1",
      modelId: "gpt-4",
      timestamp: new Date(),
      type: "response-metadata",
    });

    expect(v2Part?.type).toBe("response-metadata");
  });
});

describe("createV2StreamFromInternal", () => {
  it("should stream multiple events and close properly", async () => {
    const internalStream = new ReadableStream<InternalStreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ delta: "Hello", id: "text-1", type: "text-delta" });
        controller.enqueue({ delta: " world", id: "text-1", type: "text-delta" });
        controller.close();
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();
    const types: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      types.push(value.type);
    }

    expect(types).toEqual(["stream-start", "text-delta", "text-delta"]);
  });

  it("should handle empty streams", async () => {
    const internalStream = new ReadableStream<InternalStreamPart>({
      start(controller) {
        controller.close();
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();
    const { done, value } = await reader.read();

    expect(done).toBe(true);
    expect(value).toBeUndefined();
  });

  it("should propagate cancellation to source stream", async () => {
    let cancelCalled = false;

    const internalStream = new ReadableStream<InternalStreamPart>({
      cancel() {
        cancelCalled = true;
      },
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();

    await reader.read();
    await reader.cancel("User cancelled");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelCalled).toBe(true);
  });

  it("should propagate errors from source stream", async () => {
    const internalStream = new ReadableStream<InternalStreamPart>({
      start(controller) {
        controller.error(new Error("Source stream error"));
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();

    await expect(reader.read()).rejects.toThrow("Source stream error");
  });

  it("should filter out V3-only events (tool-approval-request)", async () => {
    const internalStream = new ReadableStream<InternalStreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ approvalId: "a1", toolCallId: "c1", type: "tool-approval-request" });
        controller.enqueue({ delta: "Hello", id: "text-1", type: "text-delta" });
        controller.enqueue({ approvalId: "a2", toolCallId: "c2", type: "tool-approval-request" });
        controller.close();
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();
    const types: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      types.push(value.type);
    }

    expect(types).toEqual(["stream-start", "text-delta"]);
    expect(types).not.toContain("tool-approval-request");
  });

  it("should handle stream with only V3-only events (yields empty)", async () => {
    const internalStream = new ReadableStream<InternalStreamPart>({
      start(controller) {
        controller.enqueue({ approvalId: "a1", toolCallId: "c1", type: "tool-approval-request" });
        controller.enqueue({ approvalId: "a2", toolCallId: "c2", type: "tool-approval-request" });
        controller.close();
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();
    const events: LanguageModelV2StreamPart[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }

    expect(events).toHaveLength(0);
  });
});
