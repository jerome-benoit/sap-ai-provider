/** Tests for the V4-to-V3 prompt normalization (AI SDK 7 entry adapter). */
import type { LanguageModelV3Prompt, LanguageModelV4Prompt } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { convertToSAPMessages } from "./convert-to-sap-messages.js";
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

  it("should preserve full media type and URL identity", () => {
    const url = new URL("https://example.com/a.pdf");
    const prompt = [
      {
        content: [
          {
            data: { type: "url", url },
            mediaType: "application/pdf",
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    const content = (result[0] as { content: { data: unknown; mediaType: string }[] }).content[0];
    expect(content).toMatchObject({ mediaType: "application/pdf" });
    expect(content?.data).toBe(url);
  });

  it("should convert text-variant file parts to V3 text parts", () => {
    const prompt = [
      {
        content: [
          {
            data: { text: "inline doc", type: "text" },
            mediaType: "text",
            providerOptions: { "test-provider": { cached: true } },
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result).toEqual([
      {
        content: [
          {
            providerOptions: { "test-provider": { cached: true } },
            text: "inline doc",
            type: "text",
          },
        ],
        role: "user",
      },
    ] satisfies LanguageModelV3Prompt);
  });

  it.each(["image/png", "image"])(
    "should reject reference file parts with media type %s without fetching",
    (mediaType) => {
      const prompt = [
        {
          content: [
            {
              data: { reference: { "test-provider": "file-123" }, type: "reference" },
              mediaType,
              type: "file",
            },
          ],
          role: "user",
        },
      ] as unknown as LanguageModelV4Prompt;
      expect(() => normalizeV4PromptToV3(prompt)).toThrow("provider reference");
    },
  );

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
    const result = normalizeV4PromptToV3(prompt);
    expect(result).toHaveLength(1);
    expect((result[0] as { content: unknown[] }).content).toHaveLength(2);
  });

  it("should resolve and encode inline tool-output media without copying input first", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const prompt = [
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                { text: "see attached", type: "text" },
                {
                  data: { data: bytes, type: "data" },
                  filename: "image.png",
                  mediaType: "IMAGE/PNG",
                  providerOptions: { "test-provider": { cached: true } },
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
        {
          data: "iVBORw0KGgo=",
          filename: "image.png",
          mediaType: "image/png",
          providerOptions: { "test-provider": { cached: true } },
          type: "file-data",
        },
      ],
    });
  });

  it.each(["image", "image/*", "IMAGE", "IMAGE/*", "IMAGE/PNG"])(
    "should resolve inline %s data before SAP image routing",
    (mediaType) => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const prompt = [
        {
          content: [{ data: { data: bytes, type: "data" }, mediaType, type: "file" }],
          role: "user",
        },
      ] as unknown as LanguageModelV4Prompt;
      const result = normalizeV4PromptToV3(prompt);
      const file = (result[0] as { content: { data: unknown; mediaType: string }[] }).content[0];
      expect(file).toMatchObject({ mediaType: "image/png" });
      expect(file?.data).toBe(bytes);

      const sapMessage = convertToSAPMessages(result)[0] as {
        content: { image_url: { url: string }; type: string }[];
      };
      expect(sapMessage.content[0]).toEqual({
        image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
        type: "image_url",
      });
    },
  );

  it("should resolve wildcard application media from inline base64", () => {
    const prompt = [
      {
        content: [
          {
            data: { data: "JVBERi0xLjQ=", type: "data" },
            mediaType: "application/*",
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    const result = normalizeV4PromptToV3(prompt);
    expect(result[0]).toMatchObject({ content: [{ mediaType: "application/pdf" }] });
  });

  it("should reject an unresolved inline media type", () => {
    const prompt = [
      {
        content: [
          {
            data: { data: new Uint8Array([1, 2, 3]), type: "data" },
            mediaType: "image",
            type: "file",
          },
        ],
        role: "user",
      },
    ] as unknown as LanguageModelV4Prompt;
    expect(() => normalizeV4PromptToV3(prompt)).toThrow("could not be auto-detected");
  });

  it.each([
    { expectedMediaType: "image/*", mediaType: "image" },
    { expectedMediaType: "image/*", mediaType: "image/*" },
    { expectedMediaType: "image/*", mediaType: "IMAGE" },
    { expectedMediaType: "image/*", mediaType: "IMAGE/*" },
    { expectedMediaType: "image/png", mediaType: "IMAGE/PNG" },
  ])(
    "should preserve remote image URL media type $mediaType",
    ({ expectedMediaType, mediaType }) => {
      const url = new URL("https://example.com/image");
      const prompt = [
        {
          content: [{ data: { type: "url", url }, mediaType, type: "file" }],
          role: "user",
        },
      ] as unknown as LanguageModelV4Prompt;
      const result = normalizeV4PromptToV3(prompt);
      expect(result[0]).toMatchObject({
        content: [{ data: url, mediaType: expectedMediaType, type: "file" }],
      });
      expect(convertToSAPMessages(result)).toEqual([
        {
          content: [{ image_url: { url: url.toString() }, type: "image_url" }],
          role: "user",
        },
      ]);
    },
  );

  it.each(["application", "application/*", "APPLICATION", "APPLICATION/*"])(
    "should reject incomplete non-image URL media type %s",
    (mediaType) => {
      const prompt = [
        {
          content: [
            {
              data: { type: "url", url: new URL("https://example.com/file") },
              mediaType,
              type: "file",
            },
          ],
          role: "user",
        },
      ] as unknown as LanguageModelV4Prompt;
      expect(() => normalizeV4PromptToV3(prompt)).toThrow("not passed as inline bytes");
    },
  );
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
