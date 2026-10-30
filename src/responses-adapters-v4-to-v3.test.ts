/** V4-to-V3 result conversion at the OpenAI Responses delegate boundary. */
import type { LanguageModelV4GenerateResult, LanguageModelV4StreamPart } from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import {
  convertResponsesResultToV3,
  convertResponsesStreamPartToV3,
} from "./responses-adapters-v4-to-v3.js";
import { convertGenerateResultToV4, convertStreamPartToV4 } from "./sap-ai-adapters-v3-to-v4.js";

const usage: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 3, total: 3 },
  outputTokens: { reasoning: undefined, text: 1, total: 1 },
};

describe("Responses V4-to-V3 delegate adapter", () => {
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

  it("keeps interrupted diagnostics private in V3 and restores V4 generation and stream semantics", () => {
    const original = { raw: undefined, unified: "interrupted" as const };
    const result: LanguageModelV4GenerateResult = {
      content: [],
      finishReason: original,
      usage,
      warnings: [],
    };
    const converted = convertResponsesResultToV3(result);
    expect(converted.finishReason.unified).toBe("other");
    expect(Object.keys(converted.finishReason).sort()).toEqual(["raw", "unified"]);
    expect(JSON.stringify(converted.finishReason)).toBe('{"unified":"other"}');
    expect(convertGenerateResultToV4(converted).finishReason).toBe(original);

    const finish = convertResponsesStreamPartToV3({
      finishReason: original,
      type: "finish",
      usage,
    });
    if (finish.type !== "finish") throw new Error("Expected a converted finish event");
    const restored = convertStreamPartToV4(finish);
    if (restored.type !== "finish") throw new Error("Expected a restored finish event");
    expect(finish.finishReason.unified).toBe("other");
    expect(restored.finishReason).toBe(original);
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
