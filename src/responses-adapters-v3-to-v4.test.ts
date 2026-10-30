/** V3-to-V4 call conversion at the OpenAI Responses delegate boundary. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { convertResponsesCallToV4 } from "./responses-adapters-v3-to-v4.js";

describe("Responses V3-to-V4 delegate adapter", () => {
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
});
