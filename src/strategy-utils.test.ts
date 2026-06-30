/** Unit tests for shared strategy utilities. */

import type { LanguageModelV3FunctionTool, SharedV3Warning } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { parseSAPPartProviderOptions } from "./sap-ai-provider-options.js";
import {
  buildAnthropicCacheMetadata,
  computeNoCache,
  convertToolsToSAPFormat,
  extractCompletionId,
  extractResponseContent,
  mapFinishReason,
  sanitizeAsJSONArray,
  sanitizeAsJSONObject,
  type SAPTool,
  type SDKResponse,
} from "./strategy-utils.js";

interface ChatCompletionTool extends SAPTool<unknown> {
  function: { description?: string; name: string; parameters: unknown };
  type: "function";
}

const buildFunctionTool = (
  overrides: Partial<LanguageModelV3FunctionTool> = {},
): LanguageModelV3FunctionTool => ({
  description: "lookup",
  inputSchema: { properties: {}, required: [], type: "object" },
  name: "lookup",
  type: "function",
  ...overrides,
});

describe("convertToolsToSAPFormat", () => {
  it("should return no tools and no warnings for an empty list", () => {
    const result = convertToolsToSAPFormat<ChatCompletionTool>([]);
    expect(result).toEqual({ tools: undefined, warnings: [] });
  });

  it("should forward a valid cacheControl directive onto the SAP tool envelope", () => {
    const tools: LanguageModelV3FunctionTool[] = [
      buildFunctionTool({
        providerOptions: { "sap-ai": { cacheControl: { ttl: "5m", type: "ephemeral" } } },
      }),
    ];
    const result = convertToolsToSAPFormat<ChatCompletionTool>(tools, {
      parser: parseSAPPartProviderOptions,
    });

    const cached = result.tools?.[0] as { cache_control?: unknown };
    expect(cached.cache_control).toEqual({ ttl: "5m", type: "ephemeral" });
  });

  it("should push a parser warning into the sink when an invalid cacheControl block is provided", () => {
    const sink: SharedV3Warning[] = [];
    const tools: LanguageModelV3FunctionTool[] = [
      buildFunctionTool({
        providerOptions: { "sap-ai": { cacheControl: { type: "wrong-type" } } },
      }),
    ];
    const result = convertToolsToSAPFormat<ChatCompletionTool>(tools, {
      parser: parseSAPPartProviderOptions,
      warnings: sink,
    });

    const tool = result.tools?.[0] as { cache_control?: unknown };
    expect(tool).not.toHaveProperty("cache_control");
    expect(sink.length).toBeGreaterThan(0);
    expect(sink[0]).toMatchObject({ type: "other" });
    expect((sink[0] as { message?: string }).message ?? "").toMatch(/cacheControl/);
  });

  it("should not push warnings when no parser is supplied (Foundation Models path)", () => {
    const sink: SharedV3Warning[] = [];
    const tools: LanguageModelV3FunctionTool[] = [
      buildFunctionTool({
        providerOptions: { "sap-ai": { cacheControl: { type: "wrong-type" } } },
      }),
    ];
    const result = convertToolsToSAPFormat<ChatCompletionTool>(tools, { warnings: sink });

    expect(result.tools?.[0]).not.toHaveProperty("cache_control");
    expect(sink).toHaveLength(0);
  });

  it("should accept an empty options object identically to omitted options", () => {
    const tools: LanguageModelV3FunctionTool[] = [
      buildFunctionTool({
        providerOptions: { "sap-ai": { cacheControl: { ttl: "5m", type: "ephemeral" } } },
      }),
    ];
    const omitted = convertToolsToSAPFormat<ChatCompletionTool>(tools);
    const empty = convertToolsToSAPFormat<ChatCompletionTool>(tools, {});

    expect(empty).toEqual(omitted);
    expect((empty.tools?.[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
  });
});

describe("mapFinishReason", () => {
  it.each<[string, "content-filter" | "stop" | "tool-calls"]>([
    ["TOOL_USE", "tool-calls"],
    ["GUARDRAIL_INTERVENED", "content-filter"],
  ])("should lower-case %s before mapping to %s", (raw, unified) => {
    expect(mapFinishReason(raw)).toEqual({ raw, unified });
  });
});

describe("buildAnthropicCacheMetadata", () => {
  it("should return an empty fragment when token usage is null or undefined", () => {
    expect(buildAnthropicCacheMetadata(null)).toEqual({});
    expect(buildAnthropicCacheMetadata(undefined)).toEqual({});
  });

  it("should return an empty fragment when both ephemeral counts are zero", () => {
    expect(
      buildAnthropicCacheMetadata({
        prompt_tokens: 100,
        prompt_tokens_details: {
          cache_creation_token_details: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }),
    ).toEqual({});
  });

  it("should expose cacheUsage when at least one ephemeral bucket is populated", () => {
    expect(
      buildAnthropicCacheMetadata({
        prompt_tokens: 100,
        prompt_tokens_details: {
          cache_creation_token_details: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 12,
          },
        },
      }),
    ).toEqual({
      cacheUsage: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 12 },
    });
  });
});

describe("sanitizeAsJSONArray", () => {
  it("should pass plain JSON-safe arrays through unchanged", () => {
    expect(sanitizeAsJSONArray([1, "two", { three: 3 }])).toEqual([1, "two", { three: 3 }]);
  });

  it("should drop function entries via JSON.stringify defaults", () => {
    const sanitized = sanitizeAsJSONArray([{ ok: 1 }, Math.random]);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[0]).toEqual({ ok: 1 });
    expect(sanitized[1]).toBeNull();
  });

  it("should return an empty array on circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sanitizeAsJSONArray([circular])).toEqual([]);
  });

  it("should coerce bigint entries to decimal strings rather than dropping the payload", () => {
    expect(sanitizeAsJSONArray([1, 2n, "x"])).toEqual([1, "2", "x"]);
  });
});

describe("sanitizeAsJSONObject", () => {
  it("should pass plain JSON-safe objects through unchanged", () => {
    expect(sanitizeAsJSONObject({ a: 1, b: { c: "two" } })).toEqual({ a: 1, b: { c: "two" } });
  });

  it("should drop function-valued properties", () => {
    expect(sanitizeAsJSONObject({ a: 1, fn: Math.random })).toEqual({ a: 1 });
  });

  it("should return an empty object on circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sanitizeAsJSONObject(circular)).toEqual({});
  });

  it("should coerce bigint values to decimal strings rather than dropping the payload", () => {
    expect(sanitizeAsJSONObject({ a: 1, b: 9007199254740993n })).toEqual({
      a: 1,
      b: "9007199254740993",
    });
  });

  it("should coerce nested bigint values recursively", () => {
    expect(sanitizeAsJSONObject({ outer: { inner: [1n, { deep: -9007199254740993n }] } })).toEqual({
      outer: { inner: ["1", { deep: "-9007199254740993" }] },
    });
  });

  it("should serialize Date values to ISO strings via JSON.stringify default", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(sanitizeAsJSONObject({ at: date })).toEqual({ at: "2026-01-02T03:04:05.000Z" });
  });
});

describe("extractCompletionId", () => {
  it.each<
    [string, { _data?: unknown; getRequestId?: unknown }, readonly string[], string | undefined]
  >([
    ["resolve a single-segment path", { _data: { id: "x1" } }, ["id"], "x1"],
    [
      "walk a dotted nested path",
      { _data: { final_result: { id: "x2" } } },
      ["final_result", "id"],
      "x2",
    ],
    [
      "fall back to getRequestId when path missing",
      { _data: {}, getRequestId: () => "rid" },
      ["id"],
      "rid",
    ],
    [
      "return undefined when both sources are absent",
      { _data: {}, getRequestId: () => undefined },
      ["id"],
      undefined,
    ],
    ["tolerate non-function getRequestId", { _data: {}, getRequestId: 42 }, ["id"], undefined],
    [
      "tolerate throwing getRequestId",
      {
        _data: {},
        getRequestId: () => {
          throw new Error("nope");
        },
      },
      ["id"],
      undefined,
    ],
  ])("should %s", (_label, response, path, expected) => {
    expect(
      extractCompletionId(
        response as { _data?: unknown; getRequestId?: () => string | undefined },
        path,
      ),
    ).toBe(expected);
  });
});

describe("extractResponseContent", () => {
  it("should preserve SAP's Gemini thought signature in the tool-call id suffix", () => {
    const signedToolCallId =
      "vertex_tool_be5b294b-ece3-46f0-8b0d-22cd00000000__sig_AY89a1_testSignature";

    const response: SDKResponse = {
      getContent: () => undefined,
      getFinishReason: () => undefined,
      getTokenUsage: () => undefined,
      getToolCalls: () => [
        {
          function: {
            arguments: "{}",
            name: "lookup",
          },
          id: signedToolCallId,
        },
      ],
      rawResponse: { headers: new Headers() },
    };

    const [toolCall] = extractResponseContent(response);

    expect(toolCall).toEqual(
      expect.objectContaining({
        toolCallId: signedToolCallId,
        type: "tool-call",
      }),
    );
  });
});

describe("computeNoCache", () => {
  it.each<[string, number | undefined, number | undefined, number | undefined, number | undefined]>(
    [
      ["return undefined when promptTokens is unknown", undefined, 5, 3, undefined],
      [
        "return promptTokens unchanged when no cache breakdown is reported",
        100,
        undefined,
        undefined,
        100,
      ],
      ["subtract both cache buckets from promptTokens", 100, 30, 20, 50],
      ["clamp the result at zero on overflow", 10, 8, 5, 0],
    ],
  )("should %s", (_label, prompt, cached, cacheWrite, expected) => {
    expect(computeNoCache(prompt, cached, cacheWrite)).toBe(expected);
  });
});
