/** Consumer-visible media and event contracts across the OpenAI V4 delegate boundary. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  convertResponsesCallToV4,
  convertResponsesResultToV3,
  convertResponsesStreamPartToV3,
} from "./responses-language-model-adapters.js";

const usage: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 3, total: 3 },
  outputTokens: { reasoning: undefined, text: 1, total: 1 },
};

describe("Responses delegate boundary", () => {
  it("canonicalizes genuine URLs even when their prototype has been replaced", () => {
    const data = new URL("https://example.com/document.pdf");
    Object.setPrototypeOf(data, null);
    const converted = convertResponsesCallToV4({
      prompt: [{ content: [{ data, mediaType: "application/pdf", type: "file" }], role: "user" }],
    });
    const user = converted.prompt[0];
    if (user?.role !== "user" || user.content[0]?.type !== "file") {
      throw new Error("Expected a user file");
    }
    expect(user.content[0].data).toEqual({
      type: "url",
      url: new URL("https://example.com/document.pdf"),
    });
  });

  it("tags user files and preserves image versus file tool-result categories", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const url = new URL("https://example.com/document.pdf");
    const options: LanguageModelV3CallOptions = {
      prompt: [
        {
          content: [
            { data: bytes, mediaType: "image/png", type: "file" },
            { data: url, mediaType: "application/pdf", type: "file" },
          ],
          role: "user",
        },
        {
          content: [
            {
              output: {
                type: "content",
                value: [
                  { data: "aGk=", mediaType: "image/png", type: "image-data" },
                  {
                    data: "cGRm",
                    filename: "result.pdf",
                    mediaType: "application/pdf",
                    type: "file-data",
                  },
                  { type: "image-url", url: "https://example.com/image.png" },
                  { type: "file-url", url: url.href },
                  {
                    fileId: { openai: "image-1" },
                    providerOptions: { openai: { imageDetail: "high" } },
                    type: "image-file-id",
                  },
                  { fileId: "file-1", type: "file-id" },
                ],
              },
              toolCallId: "call-1",
              toolName: "lookup",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ],
    };
    const converted = convertResponsesCallToV4(options);
    const user = converted.prompt[0];
    if (user?.role !== "user") throw new Error("Expected a user message");
    expect(user.content).toEqual([
      { data: { data: bytes, type: "data" }, mediaType: "image/png", type: "file" },
      { data: { type: "url", url }, mediaType: "application/pdf", type: "file" },
    ]);
    const tool = converted.prompt[1];
    if (tool?.role !== "tool" || tool.content[0]?.type !== "tool-result")
      throw new Error("Expected a tool result");
    expect(tool.content[0].output).toMatchObject({
      type: "content",
      value: [
        { data: { data: "aGk=", type: "data" }, mediaType: "image/png", type: "file" },
        {
          data: { data: "cGRm", type: "data" },
          filename: "result.pdf",
          mediaType: "application/pdf",
          type: "file",
        },
        {
          data: { type: "url", url: new URL("https://example.com/image.png") },
          mediaType: "image",
          type: "file",
        },
        { data: { type: "url", url }, mediaType: "application/octet-stream", type: "file" },
        {
          data: { reference: { openai: "image-1" }, type: "reference" },
          mediaType: "image",
          providerOptions: { openai: { imageDetail: "high" } },
          type: "file",
        },
        {
          data: { reference: { openai: "file-1" }, type: "reference" },
          mediaType: "application/octet-stream",
          type: "file",
        },
      ],
    });
    expect(options.prompt[0]).toMatchObject({ content: [{ data: bytes }, { data: url }] });
  });

  it("unwraps generated media and maps V4-only finish and warning variants", () => {
    const bytes = new Uint8Array([4, 5]);
    const result: LanguageModelV4GenerateResult = {
      content: [{ data: { data: bytes, type: "data" }, mediaType: "image/png", type: "file" }],
      finishReason: { raw: "connection-ended", unified: "interrupted" },
      usage,
      warnings: [{ message: "Use the current option.", setting: "legacy", type: "deprecated" }],
    };
    const converted = convertResponsesResultToV3(result);
    expect(converted.content).toEqual([{ data: bytes, mediaType: "image/png", type: "file" }]);
    if (converted.content[0]?.type !== "file") throw new Error("Expected a generated file");
    expect(converted.content[0].data).toBe(bytes);
    expect(converted.finishReason).toEqual({ raw: "connection-ended", unified: "other" });
    expect(converted.warnings).toEqual([
      { message: "legacy: Use the current option.", type: "other" },
    ]);
    expect(
      convertResponsesStreamPartToV3({ finishReason: result.finishReason, type: "finish", usage }),
    ).toMatchObject({ finishReason: converted.finishReason });
    expect(
      convertResponsesStreamPartToV3({ type: "stream-start", warnings: result.warnings }),
    ).toEqual({ type: "stream-start", warnings: converted.warnings });
    const file = result.content[0];
    if (file?.type !== "file") throw new Error("Expected delegate file content");
    expect(convertResponsesStreamPartToV3(file)).toEqual(converted.content[0]);
  });

  it("retains text encoding for native custom-tool input streams", () => {
    expect(
      convertResponsesStreamPartToV3({
        id: "custom-call",
        inputEncoding: "text",
        toolName: "custom",
        type: "tool-input-start",
      }),
    ).toMatchObject({ inputEncoding: "text", type: "tool-input-start" });
  });

  it.each<LanguageModelV4StreamPart>([
    {
      data: { type: "url", url: new URL("https://example.com/output.png") },
      mediaType: "image/png",
      type: "file",
    },
    { data: { data: "aGk=", type: "data" }, mediaType: "image/png", type: "reasoning-file" },
    {
      kind: "openai.compaction",
      providerMetadata: { openai: { encryptedContent: "opaque" } },
      type: "custom",
    },
  ])("rejects unsupported $type output instead of leaking an invalid V3 shape", (part) => {
    expect(() => convertResponsesStreamPartToV3(part)).toThrow(UnsupportedFunctionalityError);
  });
});
