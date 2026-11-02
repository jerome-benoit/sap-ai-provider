/** Native Responses history preserves tagged media and rejects silent delegate omissions. */
import type { LanguageModelV4Prompt } from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { prepareResponsesPrompt } from "./responses-prompt.js";

const namespace = "sap-custom";
const providerOptions = { [namespace]: { imageDetail: "high" }, openai: { imageDetail: "low" } };

describe("native Responses prompt", () => {
  it("preserves byte identity and canonical URLs while normalizing media and namespaces", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const url = new URL("https://example.com/original.png");
    url.toString = () => "https://wrong.example/changed.png";
    const prompt: LanguageModelV4Prompt = [
      {
        content: [
          {
            data: { data: bytes, type: "data" },
            mediaType: "IMAGE/PNG",
            providerOptions,
            type: "file",
          },
          { data: { type: "url", url }, mediaType: "IMAGE/*", type: "file" },
          {
            data: { reference: { [namespace]: "file-right", openai: "wrong" }, type: "reference" },
            mediaType: "image",
            providerOptions,
            type: "file",
          },
        ],
        providerOptions,
        role: "user",
      },
    ];
    const prepared = prepareResponsesPrompt(prompt, namespace);
    const message = prepared[0];
    if (message?.role !== "user") throw new Error("Expected the user message");
    expect(message.providerOptions?.openai?.imageDetail).toBe("high");
    const first = message.content[0];
    if (first?.type !== "file" || first.data.type !== "data")
      throw new Error("Expected inline bytes");
    expect(first.data.data).toBe(bytes);
    expect(first.mediaType).toBe("image/png");
    expect(first.providerOptions?.openai?.imageDetail).toBe("high");
    const second = message.content[1];
    if (second?.type !== "file" || second.data.type !== "url")
      throw new Error("Expected a tagged URL");
    expect(second.data.url.toString()).toBe("https://example.com/original.png");
    expect(second.mediaType).toBe("image/*");
    expect(message.content[2]).toMatchObject({
      data: { reference: { openai: "file-right" }, type: "reference" },
    });
    expect(prompt[0]?.providerOptions?.openai?.imageDetail).toBe("low");
  });

  it.each(["tool", "assistant"] as const)(
    "maps nested %s tool results and MCP approval options",
    (role) => {
      const prepared = prepareResponsesPrompt(
        [
          {
            content: [
              {
                output: {
                  type: "content",
                  value: [
                    {
                      data: {
                        reference: { [namespace]: "nested-right", openai: "wrong" },
                        type: "reference",
                      },
                      mediaType: "IMAGE",
                      providerOptions,
                      type: "file",
                    },
                    {
                      data: { text: "tool document", type: "text" },
                      mediaType: "TEXT/PLAIN",
                      providerOptions,
                      type: "file",
                    },
                  ],
                },
                providerOptions,
                toolCallId: "call-1",
                toolName: "capture",
                type: "tool-result",
              },
              {
                output: {
                  providerOptions: {
                    [namespace]: { approvalId: "approval-right" },
                    openai: { approvalId: "wrong" },
                  },
                  type: "json",
                  value: {},
                },
                toolCallId: "call-2",
                toolName: "mcp",
                type: "tool-result",
              },
            ],
            role,
          },
        ],
        namespace,
      );
      const message = prepared[0];
      if (!message || message.role === "system" || message.role === "user")
        throw new Error("Expected tool history");
      expect(message.content[0]).toMatchObject({
        output: {
          value: [
            {
              data: { reference: { openai: "nested-right" } },
              mediaType: "image",
              providerOptions: { openai: { imageDetail: "high" } },
              type: "file",
            },
            {
              providerOptions: { openai: { imageDetail: "high" } },
              text: "tool document",
              type: "text",
            },
          ],
        },
        providerOptions: { openai: { imageDetail: "high" } },
      });
      expect(message.content[1]).toMatchObject({
        output: { providerOptions: { openai: { approvalId: "approval-right" } } },
      });
    },
  );

  it("converts tagged user text without losing provider options", () => {
    expect(
      prepareResponsesPrompt(
        [
          {
            content: [
              {
                data: { text: "document", type: "text" },
                mediaType: "TEXT/PLAIN",
                providerOptions,
                type: "file",
              },
            ],
            role: "user",
          },
        ],
        namespace,
      ),
    ).toMatchObject([
      {
        content: [
          { providerOptions: { openai: { imageDetail: "high" } }, text: "document", type: "text" },
        ],
      },
    ]);
  });

  it("preserves supported compaction and encrypted reasoning without requiring a reasoning ID", () => {
    const prepared = prepareResponsesPrompt(
      [
        {
          content: [
            {
              kind: "openai.compaction",
              providerOptions: {
                [namespace]: { encryptedContent: "cipher", itemId: "cmp-1" },
                openai: { itemId: "wrong" },
              },
              type: "custom",
            },
            {
              providerOptions: { [namespace]: { reasoningEncryptedContent: "cipher-r" } },
              text: "",
              type: "reasoning",
            },
          ],
          role: "assistant",
        },
      ],
      namespace,
    );
    expect(prepared).toMatchObject([
      {
        content: [
          {
            kind: "openai.compaction",
            providerOptions: { openai: { encryptedContent: "cipher", itemId: "cmp-1" } },
            type: "custom",
          },
          {
            providerOptions: { openai: { reasoningEncryptedContent: "cipher-r" } },
            type: "reasoning",
          },
        ],
      },
    ]);
  });

  it.each([undefined, null])(
    "rejects compaction with itemId %s after namespace precedence",
    (itemId) => {
      expect(() =>
        prepareResponsesPrompt(
          [
            {
              content: [
                {
                  kind: "openai.compaction",
                  providerOptions: {
                    ...(itemId === null ? { openai: { itemId: "old-id" } } : {}),
                    [namespace]: {
                      encryptedContent: "cipher",
                      ...(itemId === null ? { itemId } : {}),
                    },
                  },
                  type: "custom",
                },
              ],
              role: "assistant",
            },
          ],
          namespace,
        ),
      ).toThrow(UnsupportedFunctionalityError);
    },
  );

  it("does not invent validation for empty compaction IDs or missing ciphertext", () => {
    expect(
      prepareResponsesPrompt(
        [
          {
            content: [
              {
                kind: "openai.compaction",
                providerOptions: { [namespace]: { itemId: "" } },
                type: "custom",
              },
            ],
            role: "assistant",
          },
        ],
        namespace,
      ),
    ).toMatchObject([
      { content: [{ kind: "openai.compaction", providerOptions: { openai: { itemId: "" } } }] },
    ]);
  });

  it.each([
    {
      data: { data: "aGk=", type: "data" as const },
      mediaType: "image/png",
      type: "file" as const,
    },
    {
      data: { text: "assistant document", type: "text" as const },
      mediaType: "text/plain",
      type: "file" as const,
    },
    {
      data: { type: "url" as const, url: new URL("https://example.com/output.png") },
      mediaType: "image/png",
      type: "file" as const,
    },
    {
      data: { data: "aGk=", type: "data" as const },
      mediaType: "image/png",
      type: "reasoning-file" as const,
    },
    { kind: "other.unsupported" as const, type: "custom" as const },
  ])("rejects unsupported assistant $type history explicitly", (part) => {
    expect(() =>
      prepareResponsesPrompt([{ content: [part], role: "assistant" }], namespace),
    ).toThrow(UnsupportedFunctionalityError);
  });
});
