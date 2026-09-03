/** Tests for the V3-to-V4 result conversion (AI SDK 7 output adapter). */
import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  LanguageModelV4GenerateResult,
  LanguageModelV4Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import {
  convertGenerateResultToV4,
  convertStreamPartToV4,
  convertUsageToV4,
  convertWarningsToV4,
} from "./sap-ai-adapters-v3-to-v4.js";

const usage: LanguageModelV3Usage = {
  inputTokens: { cacheRead: 1, cacheWrite: 2, noCache: 10, total: 13 },
  outputTokens: { reasoning: 3, text: 20, total: 23 },
};

describe("convertUsageToV4", () => {
  it("should map nested usage by identity", () => {
    const result: LanguageModelV4Usage = convertUsageToV4(usage);
    expect(result).toEqual(usage);
  });
});

describe("convertWarningsToV4", () => {
  it("should pass warnings through natively", () => {
    const warnings: SharedV3Warning[] = [
      { feature: "x", type: "unsupported" },
      { feature: "y", type: "compatibility" },
    ];
    expect(convertWarningsToV4(warnings)).toEqual(warnings);
  });
});

describe("convertStreamPartToV4", () => {
  it("should convert text deltas by identity of fields", () => {
    const part: LanguageModelV3StreamPart = { delta: "hi", id: "1", type: "text-delta" };
    expect(convertStreamPartToV4(part)).toMatchObject({
      delta: "hi",
      id: "1",
      type: "text-delta",
    });
  });

  it("should map finish usage by identity and keep unified reason", () => {
    const part = {
      finishReason: { unified: "stop" },
      type: "finish",
      usage,
    } as unknown as LanguageModelV3StreamPart;
    expect(convertStreamPartToV4(part)).toMatchObject({
      finishReason: { unified: "stop" },
      type: "finish",
      usage,
    });
  });

  it("should pass stream-start warnings through", () => {
    const part = {
      type: "stream-start",
      warnings: [{ feature: "x", type: "unsupported" }],
    } as unknown as LanguageModelV3StreamPart;
    expect(convertStreamPartToV4(part)).toMatchObject({ type: "stream-start" });
  });

  it("should pass tool-approval-request through (native V4 part)", () => {
    const part = {
      approvalId: "a1",
      toolCallId: "c1",
      type: "tool-approval-request",
    } as unknown as LanguageModelV3StreamPart;
    expect(convertStreamPartToV4(part)).toMatchObject({
      approvalId: "a1",
      type: "tool-approval-request",
    });
  });
  it("should preserve providerMetadata on streamed file parts", () => {
    const part = {
      data: "aGVsbG8=",
      mediaType: "image/png",
      providerMetadata: { "test-provider": { d: 4 } },
      type: "file",
    } as unknown as LanguageModelV3StreamPart;
    expect(convertStreamPartToV4(part)).toMatchObject({
      providerMetadata: { "test-provider": { d: 4 } },
      type: "file",
    });
  });
});

describe("convertGenerateResultToV4", () => {
  it("should convert content, usage, warnings and finish reason", () => {
    const result = {
      content: [{ text: "hello", type: "text" }],
      finishReason: { unified: "stop" },
      usage,
      warnings: [],
    } as unknown as LanguageModelV3GenerateResult;
    const converted: LanguageModelV4GenerateResult = convertGenerateResultToV4(result);
    expect(converted.content).toEqual([{ text: "hello", type: "text" }]);
    expect(converted.usage).toEqual(usage);
  });
});
