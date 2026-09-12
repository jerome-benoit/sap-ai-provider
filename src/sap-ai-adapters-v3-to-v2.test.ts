/** Unit tests for internal-to-V2 format adapters. */

import type {
  LanguageModelV3StreamPart as InternalStreamPart,
  LanguageModelV3Usage as InternalUsage,
} from "@ai-sdk/provider";
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider-v2";

import { describe, expect, it } from "vitest";

import {
  convertStreamPartToV2,
  convertUsageToV2,
  createV2StreamFromInternal,
} from "./sap-ai-adapters-v3-to-v2.js";

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

        total: undefined,
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

        total: undefined,
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

  it("should drop usage.raw silently at the V3→V2 boundary", () => {
    const internalUsage = {
      inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 10, total: 10 },
      outputTokens: { reasoning: undefined, text: 20, total: 20 },
      raw: {
        accepted_prediction_tokens: 1,
        prompt_tokens_details: { audio_tokens: 5 },
      },
    } as InternalUsage & { raw: Record<string, unknown> };

    const v2Usage = convertUsageToV2(internalUsage);

    expect(v2Usage).not.toHaveProperty("raw");
    expect(v2Usage).toEqual({
      cachedInputTokens: undefined,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: undefined,
      totalTokens: 30,
    });
  });
});

describe("convertStreamPartToV2", () => {
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

  it("should preserve provider-side execution regardless of dynamic tool classification", () => {
    for (const dynamic of [undefined, false, true]) {
      const v2Part = convertStreamPartToV2({
        dynamic,
        result: { answer: 42 },
        toolCallId: "call-1",
        toolName: "search",
        type: "tool-result",
      });

      expect(v2Part).toMatchObject({ providerExecuted: true, type: "tool-result" });
    }
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
    let resolveCancellation: (reason: unknown) => void;
    const cancelled = new Promise<unknown>((resolve) => {
      resolveCancellation = resolve;
    });
    const internalStream = new ReadableStream<InternalStreamPart>({
      cancel(reason: unknown) {
        resolveCancellation(reason);
      },
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
      },
    });

    const v2Stream = createV2StreamFromInternal(internalStream);
    const reader = v2Stream.getReader();

    await reader.read();
    await reader.cancel("User cancelled");

    await expect(cancelled).resolves.toBe("User cancelled");
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
