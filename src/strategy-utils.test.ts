/** Unit tests for shared strategy utilities. */

import type { LanguageModelV3FunctionTool, SharedV3Warning } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { parseSAPPartProviderOptions } from "./sap-ai-provider-options.js";
import {
  convertToolsToSAPFormat,
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
  it("returns no tools and no warnings for an empty list", () => {
    const result = convertToolsToSAPFormat<ChatCompletionTool>([]);
    expect(result).toEqual({ tools: undefined, warnings: [] });
  });

  it("forwards a valid cacheControl directive onto the SAP tool envelope", () => {
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

  it("pushes a parser warning into the sink when an invalid cacheControl block is provided", () => {
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

  it("does not push warnings when no parser is supplied (Foundation Models path)", () => {
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
});
