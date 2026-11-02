/** Node-specific cross-realm and public error-boundary tests for SAP message conversion. */
import type { LanguageModelV3Prompt } from "@ai-sdk/provider-v3";

import { InvalidPromptError, UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { convertToSAPMessages, toLocalUint8Array } from "./convert-to-sap-messages.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

describe("convertToSAPMessages across JavaScript realms", () => {
  it("should convert a Uint8Array created in another realm", () => {
    const data = runInNewContext("new Uint8Array([104, 105])") as Uint8Array;
    expect(data).not.toBeInstanceOf(Uint8Array);

    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ data, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    expect(convertToSAPMessages(prompt)).toEqual([
      {
        content: [{ image_url: { url: "data:image/png;base64,aGk=" }, type: "image_url" }],
        role: "user",
      },
    ]);
  });

  it("should convert an ArrayBuffer created in another realm", () => {
    const data = runInNewContext("new Uint8Array([104, 105]).buffer") as ArrayBuffer;
    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ data: data as unknown as Uint8Array, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    expect(convertToSAPMessages(prompt)).toEqual([
      {
        content: [{ image_url: { url: "data:image/png;base64,aGk=" }, type: "image_url" }],
        role: "user",
      },
    ]);
  });

  it("should convert a genuine URL with a foreign prototype", () => {
    const data = new URL("https://example.com/image.jpg");
    const foreignPrototype = runInNewContext("({})") as object;
    Object.setPrototypeOf(data, foreignPrototype);
    expect(data).not.toBeInstanceOf(URL);

    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ data, mediaType: "image/jpeg", type: "file" }],
        role: "user",
      },
    ];

    expect(convertToSAPMessages(prompt)).toEqual([
      {
        content: [{ image_url: { url: "https://example.com/image.jpg" }, type: "image_url" }],
        role: "user",
      },
    ]);
  });

  it.each(["ArrayBuffer", "Uint8Array"] as const)("should reject a detached %s", (type) => {
    const bytes = new Uint8Array([104, 105]);
    const data = type === "ArrayBuffer" ? bytes.buffer : bytes;
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ data: data as Uint8Array, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];
    expect(() => convertToSAPMessages(prompt)).toThrow(UnsupportedFunctionalityError);
  });
  it("should reject an Int8Array disguised through the Uint8Array prototype", () => {
    const data = new Int8Array([104, 105]);
    Object.setPrototypeOf(data, Uint8Array.prototype);
    expect(data).toBeInstanceOf(Uint8Array);

    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ data: data as unknown as Uint8Array, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    expect(() => convertToSAPMessages(prompt)).toThrow("Unsupported file data type");
  });
});

describe("local byte views", () => {
  it("retains local Uint8Array and Buffer identity", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const buffer = Buffer.from([1, 2, 3]);
    expect(toLocalUint8Array(bytes)).toBe(bytes);
    expect(toLocalUint8Array(buffer)).toBe(buffer);
  });

  it("shares the backing buffer and exact range of a foreign view", () => {
    const bytes = runInNewContext("new Uint8Array([9, 1, 2, 3, 8]).subarray(1, 4)") as Uint8Array;
    const local = toLocalUint8Array(bytes);
    expect(local).toBeInstanceOf(Uint8Array);
    expect(local.buffer).toBe(bytes.buffer);
    expect(local.byteOffset).toBe(1);
    expect(local.byteLength).toBe(3);
    expect([...local]).toEqual([1, 2, 3]);
  });

  it("uses the native byte range when foreign properties are overridden", () => {
    const bytes = runInNewContext("new Uint8Array([9, 1, 2, 3, 8]).subarray(1, 4)") as Uint8Array;
    const buffer = bytes.buffer;
    Object.defineProperties(bytes, {
      buffer: { value: new ArrayBuffer(32) },
      byteLength: { value: 20 },
      byteOffset: { value: 10 },
      length: { value: 20 },
    });
    const local = toLocalUint8Array(bytes);
    expect(local.buffer).toBe(buffer);
    expect(local.byteOffset).toBe(1);
    expect(local.byteLength).toBe(3);
    expect([...local]).toEqual([1, 2, 3]);
  });

  it("retains the backing buffer and offset of an empty foreign view", () => {
    const bytes = runInNewContext("new Uint8Array([9, 8]).subarray(1, 1)") as Uint8Array;
    const local = toLocalUint8Array(bytes);
    expect(local.buffer).toBe(bytes.buffer);
    expect(local.byteOffset).toBe(1);
    expect(local.byteLength).toBe(0);
  });

  it("rejects a detached foreign view", () => {
    const bytes = runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array<ArrayBuffer>;
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(() => toLocalUint8Array(bytes)).toThrow(UnsupportedFunctionalityError);
  });

  it("rejects an out-of-bounds foreign view instead of normalizing it to empty bytes", () => {
    const bytes = runInNewContext(`(() => {
      const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
      const view = new Uint8Array(buffer, 2, 4);
      buffer.resize(1);
      return view;
    })()`) as Uint8Array;
    expect(() => toLocalUint8Array(bytes)).toThrow(UnsupportedFunctionalityError);
  });
});

describe("public model prompt errors", () => {
  it.each(["doGenerate", "doStream"] as const)(
    "should preserve standard prompt errors from %s",
    async (method) => {
      const model = createSAPAIProvider()("gpt-4.1");
      const invalidArguments: LanguageModelV3Prompt = [
        {
          content: [
            { input: "not json", toolCallId: "call", toolName: "lookup", type: "tool-call" },
          ],
          role: "assistant",
        },
      ];
      await expect(model[method]({ prompt: invalidArguments })).rejects.toBeInstanceOf(
        InvalidPromptError,
      );

      const unsupportedFile: LanguageModelV3Prompt = [
        {
          content: [{ data: null as unknown as Uint8Array, mediaType: "image/png", type: "file" }],
          role: "user",
        },
      ];
      await expect(model[method]({ prompt: unsupportedFile })).rejects.toBeInstanceOf(
        UnsupportedFunctionalityError,
      );
    },
  );
});
