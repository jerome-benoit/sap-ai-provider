/** Unit tests for shared strategy utilities. */

import type { LanguageModelV3FunctionTool, SharedV3Warning } from "@ai-sdk/provider";

import { describe, expect, it } from "vitest";

import { parseSAPPartProviderOptions } from "./sap-ai-provider-options.js";
import { convertToolsToSAPFormat, type SAPTool } from "./strategy-utils.js";

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
    const result = convertToolsToSAPFormat<ChatCompletionTool>(tools, parseSAPPartProviderOptions);

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
    const result = convertToolsToSAPFormat<ChatCompletionTool>(
      tools,
      parseSAPPartProviderOptions,
      sink,
    );

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
    const result = convertToolsToSAPFormat<ChatCompletionTool>(tools, undefined, sink);

    expect(result.tools?.[0]).not.toHaveProperty("cache_control");
    expect(sink).toHaveLength(0);
  });
});
