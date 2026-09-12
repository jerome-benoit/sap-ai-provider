/** Unit tests for shared strategy utilities. */

import type { LanguageModelV3FunctionTool, SharedV3Warning } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { parseSAPPartProviderOptions } from "./sap-ai-provider-options.js";
import {
  buildAnthropicCacheMetadata,
  computeNoCache,
  convertToolsToSAPFormat,
  extractCompletionId,
  extractToolParameters,
  mapFinishReason,
  mapTokenUsage,
  mergeRequestConfig,
  sanitizeAsJSONArray,
  sanitizeAsJSONObject,
  type SAPTool,
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
});

describe("tool schema constraints", () => {
  it("preserves dynamic object constraints without named properties", () => {
    const inputSchema = {
      additionalProperties: { type: "string" },
      minProperties: 1,
      type: "object",
    } satisfies LanguageModelV3FunctionTool["inputSchema"];
    expect(extractToolParameters(buildFunctionTool({ inputSchema })).parameters).toMatchObject(
      inputSchema,
    );
  });
});

describe("output token accounting", () => {
  it("keeps unknown output totals unknown instead of deriving negative text counts", () => {
    expect(
      mapTokenUsage({ completion_tokens_details: { reasoning_tokens: 5 } }).outputTokens,
    ).toEqual({
      reasoning: 5,
      text: undefined,
      total: undefined,
    });
    expect(
      mapTokenUsage({ completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 5 } })
        .outputTokens,
    ).toEqual({
      reasoning: 5,
      text: 0,
      total: 3,
    });
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

describe("mergeRequestConfig", () => {
  it("returns undefined when both inputs are absent", () => {
    expect(mergeRequestConfig(undefined, undefined)).toBeUndefined();
  });

  it("ignores requestConfig.signal even when no abortSignal is provided", () => {
    const userSignal = new AbortController().signal;
    const result = mergeRequestConfig({ signal: userSignal }, undefined);
    expect(result).toBeUndefined();
  });

  it("returns abortSignal when requestConfig is absent", () => {
    const signal = new AbortController().signal;
    const result = mergeRequestConfig(undefined, signal);
    expect(result).toEqual({ signal });
  });

  it("overrides requestConfig.signal with abortSignal when both are set", () => {
    const userSignal = new AbortController().signal;
    const sdkSignal = new AbortController().signal;
    const result = mergeRequestConfig({ headers: { "x-h": "v" }, signal: userSignal }, sdkSignal);
    expect(result?.signal).toBe(sdkSignal);
    expect((result as Record<string, unknown>).headers).toEqual({ "x-h": "v" });
    expect(result?.signal).not.toBe(userSignal);
  });

  it("preserves non-signal fields when no abortSignal is provided", () => {
    const result = mergeRequestConfig({ headers: { "x-custom": "1" } }, undefined);
    expect(result).toEqual({ headers: { "x-custom": "1" } });
  });

  it("merges non-signal fields with abortSignal", () => {
    const signal = new AbortController().signal;
    const result = mergeRequestConfig({ headers: { "x-custom": "1" } }, signal);
    expect(result?.signal).toBe(signal);
    expect((result as Record<string, unknown>).headers).toEqual({ "x-custom": "1" });
  });
});
