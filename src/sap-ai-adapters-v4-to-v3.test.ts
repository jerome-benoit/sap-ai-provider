/** Tests for the V4-to-V3 prompt normalization (AI SDK 7 entry adapter). */
import type {
  LanguageModelV3Prompt,
  LanguageModelV4Prompt,
  SharedV4Warning,
} from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { normalizeV4PromptToV3 } from "./sap-ai-adapters-v4-to-v3.js";

describe("normalizeV4PromptToV3", () => {
  it("should unwrap tagged data file parts to V3 file parts", () => {
    const prompt = [
      {
        content: [
          {
            data: { data: "aGVsbG8=", type: "data" },
            mediaType: "image/jpeg",
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result).toEqual([
      {
        content: [{ data: "aGVsbG8=", mediaType: "image/jpeg", type: "file" }],
        role: "user",
      },
    ] satisfies LanguageModelV3Prompt);
  });

  it("should unwrap tagged url file parts to raw URLs", () => {
    const prompt = [
      {
        content: [
          {
            data: { type: "url", url: new URL("https://example.com/a.pdf") },
            mediaType: "application/pdf",
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    const content = (result[0] as { content: { data: unknown }[] }).content[0];
    expect(content?.data).toEqual(new URL("https://example.com/a.pdf"));
  });

  it("should convert text-variant file parts to V3 text parts", () => {
    const prompt = [
      {
        content: [{ data: { text: "inline doc", type: "text" }, mediaType: "text", type: "file" }],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result).toEqual([
      { content: [{ text: "inline doc", type: "text" }], role: "user" },
    ] satisfies LanguageModelV3Prompt);
  });

  it("should throw for reference file parts without fetching", () => {
    const prompt = [
      {
        content: [
          {
            data: { reference: { "test-provider": "file-123" }, type: "reference" },
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    expect(() => normalizeV4PromptToV3(prompt)).toThrow("provider reference");
  });

  it.each([["reasoning-file"], ["custom"]])("should throw for unsupported %s parts", (type) => {
    const prompt = [{ content: [{ type }], role: "user" }] as unknown as LanguageModelV4Prompt;
    expect(() => normalizeV4PromptToV3(prompt)).toThrow();
  });

  it("should pass tool-approval-response parts through (V3 contract)", () => {
    const prompt = [
      {
        content: [{ approvalId: "a1", approved: true, type: "tool-approval-response" }],
        role: "tool",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result).toEqual(prompt);
  });

  it("should pass through text and execution-denied tool outputs", () => {
    const warnings: SharedV4Warning[] = [];
    const prompt = [
      {
        content: [
          {
            output: { type: "text", value: "ok" },
            toolCallId: "c1",
            toolName: "t",
            type: "tool-result",
          },
          {
            output: { reason: "nope", type: "execution-denied" },
            toolCallId: "c2",
            toolName: "t",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt, warnings);
    expect(result).toHaveLength(1);
    expect((result[0] as { content: unknown[] }).content).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("should map content[] file outputs to V3 file-data parts", () => {
    const prompt = [
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                { text: "see attached", type: "text" },
                {
                  data: { data: "aGVsbG8=", type: "data" },
                  mediaType: "image/png",
                  type: "file",
                },
              ],
            },
            toolCallId: "c1",
            toolName: "t",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    const message = result[0] as {
      content: { output: { value: unknown } }[];
    };
    expect(message.content[0]?.output).toEqual({
      type: "content",
      value: [
        { text: "see attached", type: "text" },
        { data: "aGVsbG8=", mediaType: "image/png", type: "file-data" },
      ],
    });
  });
  it("should warn once for bare top-level media types", () => {
    const warnings: SharedV4Warning[] = [];
    const prompt = [
      {
        content: [
          { data: "aGVsbG8=", mediaType: "image", type: "file" },
          { data: "aGVsbG8=", mediaType: "image", type: "file" },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt, warnings);
    expect(result).toHaveLength(1);
    expect(warnings).toEqual([
      {
        details:
          "Media type 'image' has no subtype; it is passed through as-is for the API to interpret.",
        feature: "bare top-level media type",
        type: "compatibility",
      },
    ]);
  });
  it("should preserve message-level providerOptions on all roles", () => {
    const prompt = [
      { content: "sys", providerOptions: { "test-provider": { a: 1 } }, role: "system" },
      {
        content: [{ text: "hi", type: "text" }],
        providerOptions: { "test-provider": { b: 2 } },
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result[0]).toMatchObject({ providerOptions: { "test-provider": { a: 1 } } });
    expect(result[1]).toMatchObject({ providerOptions: { "test-provider": { b: 2 } } });
  });

  it("should carry part-level providerOptions through file mappings", () => {
    const prompt = [
      {
        content: [
          {
            data: { data: "aGVsbG8=", type: "data" },
            mediaType: "image/png",
            providerOptions: { "test-provider": { c: 3 } },
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result[0]).toMatchObject({
      content: [{ providerOptions: { "test-provider": { c: 3 } } }],
    });
  });

  it("should pass custom tool content through (native V3 variant)", () => {
    const prompt = [
      {
        content: [
          {
            output: { type: "content", value: [{ type: "custom" }] },
            toolCallId: "c1",
            toolName: "t",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    const message = result[0] as { content: { output: { value: unknown[] } }[] };
    expect(message.content[0]?.output.value).toEqual([{ type: "custom" }]);
  });
});
