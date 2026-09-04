/** Node-specific cross-realm tests for SAP message conversion. */
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { convertToSAPMessages } from "./convert-to-sap-messages.js";

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

  it("should reject a detached ArrayBuffer with an AI SDK error", () => {
    const data = new ArrayBuffer(2);
    structuredClone(data, { transfer: [data] });
    const prompt: LanguageModelV3Prompt = [
      {
        content: [{ data: data as unknown as Uint8Array, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    expect(() => convertToSAPMessages(prompt)).toThrow(
      "Detached ArrayBuffer file data is unsupported.",
    );
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
