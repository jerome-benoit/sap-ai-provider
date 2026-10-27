/** Tests for the V3-to-V4 result conversion (AI SDK 7 output adapter). */
import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";

import { describe, expect, it, vi } from "vitest";

import {
  convertGenerateResultToV4,
  convertStreamPartToV4,
  createV4StreamFromInternal,
} from "./sap-ai-adapters-v3-to-v4.js";

const usage: LanguageModelV3Usage = {
  inputTokens: { cacheRead: 1, cacheWrite: 2, noCache: 10, total: 13 },
  outputTokens: { reasoning: 3, text: 20, total: 23 },
};

describe("createV4StreamFromInternal", () => {
  it("does not prefetch source events while the consumer is paused", async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>) => {
      controller.enqueue({ delta: "Hello", id: "text-1", type: "text-delta" });
    });
    const source = new ReadableStream<LanguageModelV3StreamPart>({ pull }, { highWaterMark: 0 });
    const reader = createV4StreamFromInternal(source).getReader();

    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(pull).not.toHaveBeenCalled();
    await reader.read();
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(pull).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });
});

describe("convertStreamPartToV4", () => {
  it.each(["aGVsbG8=", new Uint8Array([104, 105])])(
    "wraps file data without losing its media type or provider metadata (%s)",
    (data) => {
      const part: LanguageModelV3StreamPart = {
        data,
        mediaType: "image/png",
        providerMetadata: { "test-provider": { d: 4 } },
        type: "file",
      };
      expect(convertStreamPartToV4(part)).toEqual({
        data: { data, type: "data" },
        mediaType: "image/png",
        providerMetadata: { "test-provider": { d: 4 } },
        type: "file",
      });
    },
  );
});

describe("convertGenerateResultToV4", () => {
  it("converts file content to tagged data alongside text content", () => {
    const result: LanguageModelV3GenerateResult = {
      content: [
        { text: "hello", type: "text" },
        { data: "aGVsbG8=", mediaType: "image/png", type: "file" },
      ],
      finishReason: { raw: "stop", unified: "stop" },
      usage,
      warnings: [{ feature: "y", type: "compatibility" }],
    };
    const converted: LanguageModelV4GenerateResult = convertGenerateResultToV4(result);
    expect(converted.content).toEqual([
      { text: "hello", type: "text" },
      {
        data: { data: "aGVsbG8=", type: "data" },
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });
});
