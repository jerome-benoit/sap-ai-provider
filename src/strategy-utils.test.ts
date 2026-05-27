/** Unit tests for shared strategy utilities. */

import type { LanguageModelV3FunctionTool, SharedV3Warning } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { parseSAPPartProviderOptions } from "./sap-ai-provider-options.js";
import {
  computeNoCache,
  convertToolsToSAPFormat,
  extractCompletionId,
  mapFinishReason,
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
    ["tool_use", "tool-calls"],
    ["TOOL_USE", "tool-calls"],
    ["guardrail_intervened", "content-filter"],
    ["GUARDRAIL_INTERVENED", "content-filter"],
  ])("should map %s to %s", (raw, unified) => {
    expect(mapFinishReason(raw)).toEqual({ raw, unified });
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
