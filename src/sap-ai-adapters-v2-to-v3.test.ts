/** Official AI SDK 5 prompt contracts and compatible V3 histories. */
import type { LanguageModelV3Prompt, LanguageModelV3ToolResultOutput } from "@ai-sdk/provider";
import type { LanguageModelV2Prompt, LanguageModelV2ToolResultOutput } from "@ai-sdk/provider-v2";

import { describe, expect, it } from "vitest";

import { normalizeV2PromptToV3 } from "./sap-ai-adapters-v2-to-v3.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

describe("normalizeV2PromptToV3", () => {
  describe.each(["assistant", "tool"] as const)("%s tool results", (role) => {
    it.each([
      { data: png, expectedMediaType: "image/png", mediaType: "image/png", type: "image-data" },
      { data: png, expectedMediaType: "image/png", mediaType: "IMAGE/PNG", type: "image-data" },
      { data: png, expectedMediaType: "image/png", mediaType: "image/*", type: "image-data" },
      {
        data: "JVBERi0xLjQ=",
        expectedMediaType: "application/pdf",
        mediaType: "APPLICATION/PDF",
        type: "file-data",
      },
      {
        data: "aGVsbG8=",
        expectedMediaType: "text/plain",
        mediaType: "text/plain",
        type: "file-data",
      },
    ])(
      "normalizes $mediaType without changing base64 data",
      ({ data, expectedMediaType, mediaType, type }) => {
        const media = {
          data,
          mediaType,
          providerOptions: { "sap-custom": { imageDetail: "low" } },
          type: "media" as const,
        };
        const prompt: LanguageModelV2Prompt = [
          {
            content: [
              {
                output: { type: "content", value: [{ text: "result", type: "text" }, media] },
                providerOptions: { "sap-custom": { itemId: "result-metadata" } },
                toolCallId: "call-1",
                toolName: "capture",
                type: "tool-result",
              },
            ],
            providerOptions: { "sap-custom": { itemId: "message-metadata" } },
            role,
          },
        ];
        const original = structuredClone(prompt);
        expect(normalizeV2PromptToV3(prompt)).toEqual([
          {
            content: [
              {
                output: {
                  type: "content",
                  value: [
                    { text: "result", type: "text" },
                    { ...media, mediaType: expectedMediaType, type },
                  ],
                },
                providerOptions: { "sap-custom": { itemId: "result-metadata" } },
                toolCallId: "call-1",
                toolName: "capture",
                type: "tool-result",
              },
            ],
            providerOptions: { "sap-custom": { itemId: "message-metadata" } },
            role,
          },
        ]);
        expect(prompt).toEqual(original);
      },
    );
  });

  it.each([
    { type: "text", value: "plain text" },
    { type: "json", value: { result: 42 } },
    { type: "error-text", value: "not found" },
    { type: "error-json", value: { error: "missing" } },
  ] satisfies LanguageModelV2ToolResultOutput[])(
    "preserves scalar $type output and metadata",
    (output) => {
      const withMetadata = {
        ...output,
        providerOptions: { "sap-custom": { itemId: "output-metadata" } },
      };
      expect(
        normalizeV2PromptToV3([
          {
            content: [
              {
                output: withMetadata,
                toolCallId: "call-1",
                toolName: "capture",
                type: "tool-result",
              },
            ],
            role: "tool",
          },
        ]),
      ).toMatchObject([{ content: [{ output: withMetadata }] }]);
    },
  );

  it("preserves other message contracts and their provider options", () => {
    const prompt: LanguageModelV2Prompt = [
      { content: "System", providerOptions: { "sap-custom": { value: "system" } }, role: "system" },
      {
        content: [
          { text: "user", type: "text" },
          { data: new URL("https://example.com/image.png"), mediaType: "image/png", type: "file" },
        ],
        providerOptions: { "sap-custom": { value: "user" } },
        role: "user",
      },
      {
        content: [
          {
            providerOptions: {
              "sap-custom": { itemId: "reasoning-id", reasoningEncryptedContent: "encrypted" },
            },
            text: "reasoning",
            type: "reasoning",
          },
          {
            input: {},
            providerOptions: { "sap-custom": { itemId: "call-id" } },
            toolCallId: "call-1",
            toolName: "capture",
            type: "tool-call",
          },
        ],
        role: "assistant",
      },
    ];
    expect(normalizeV2PromptToV3(prompt)).toEqual(prompt);
  });

  it("preserves compatible V3 file and custom tool output", () => {
    const output = {
      providerOptions: { "sap-custom": { output: true } },
      type: "content" as const,
      value: [
        {
          data: png,
          mediaType: "image/png",
          providerOptions: { "sap-custom": { imageDetail: "low" } },
          type: "image-data",
        },
        { fileId: { "sap-custom": "file-1" }, type: "file-id" },
        { providerOptions: { "sap-custom": { data: { custom: true } } }, type: "custom" },
      ] satisfies Extract<LanguageModelV3ToolResultOutput, { type: "content" }>["value"],
    };
    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ output, toolCallId: "call-1", toolName: "capture", type: "tool-result" }],
        role: "tool",
      },
    ];
    expect(normalizeV2PromptToV3(prompt)).toEqual(prompt);
  });
});
