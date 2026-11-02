/** Typed delegate contracts for native variants the installed wire parser does not produce. */
import type {
  LanguageModelV4,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

const delegate = vi.hoisted(() => ({
  dispose: vi.fn(),
  generate: vi.fn<LanguageModelV4["doGenerate"]>(),
  stream: vi.fn<LanguageModelV4["doStream"]>(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({
    responses: () => ({ doGenerate: delegate.generate, doStream: delegate.stream }),
  }),
}));
vi.mock("./responses-http-transport.js", () => ({
  createResponsesTransport: () =>
    Promise.resolve({
      baseURL: "https://fixture.example/deployment",
      dispose: delegate.dispose,
      fetch,
      getBodyReadFailure: () => undefined,
    }),
}));

const usage: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 3, total: 3 },
  outputTokens: { reasoning: undefined, text: 1, total: 1 },
};
const prompt = [
  { content: [{ text: "Read fixture", type: "text" as const }], role: "user" as const },
];
const settings = { api: "responses" as const, deploymentId: "fixture", name: "sap-custom" };
const bytes = new Uint8Array([4, 5]);
const content = [
  { data: { data: bytes, type: "data" }, mediaType: "image/png", type: "file" },
  {
    data: { type: "url", url: new URL("https://example.com/generated.png") },
    mediaType: "image/png",
    type: "file",
  },
  {
    data: { data: bytes, type: "data" },
    mediaType: "image/png",
    providerMetadata: { openai: { itemId: "reasoning-file" } },
    type: "reasoning-file",
  },
  {
    kind: "openai.compaction",
    providerMetadata: { openai: { encryptedContent: "cipher", itemId: "cmp" } },
    type: "custom",
  },
] satisfies LanguageModelV4GenerateResult["content"];
const warnings: LanguageModelV4GenerateResult["warnings"] = [
  { message: "Use the current setting", setting: "legacy", type: "deprecated" },
];

beforeEach(() => {
  vi.clearAllMocks();
  delegate.generate.mockResolvedValue({
    content,
    finishReason: { raw: "eof", unified: "interrupted" },
    structuredOutputText: "",
    usage,
    warnings,
  });
});

describe("native Responses V4 output contract", () => {
  it("retains generated tagged files, reasoning files, custom content, warnings and empty structured output", async () => {
    const result = await createSAPAIProviderV4(settings)("fixture").doGenerate({ prompt });
    expect(result.content).toMatchObject([
      content[0],
      content[1],
      { providerMetadata: { "sap-custom": { itemId: "reasoning-file" } }, type: "reasoning-file" },
      {
        kind: "openai.compaction",
        providerMetadata: { "sap-custom": { encryptedContent: "cipher", itemId: "cmp" } },
        type: "custom",
      },
    ]);
    const file = result.content[0];
    if (file?.type !== "file" || file.data.type !== "data")
      throw new Error("Expected tagged inline file");
    expect(file.data.data).toBe(bytes);
    expect(result.content[1]).toBe(content[1]);
    expect(result.finishReason).toEqual({ raw: "eof", unified: "interrupted" });
    expect(result.structuredOutputText).toBe("");
    expect(result.warnings).toEqual(warnings);
    expect(result.providerMetadata?.["sap-custom"]).toMatchObject({ api: "responses" });
  });

  it("retains every native stream variant and honors demand and cancellation", async () => {
    const parts: LanguageModelV4StreamPart[] = [
      { type: "stream-start", warnings },
      ...content,
      { id: "tool", inputEncoding: "text", toolName: "editor", type: "tool-input-start" },
      { rawValue: { fixture: "raw" }, type: "raw" },
      { finishReason: { raw: "eof", unified: "interrupted" }, type: "finish", usage },
    ];
    let reads = 0;
    const cancel = vi.fn();
    delegate.stream.mockResolvedValue({
      stream: new ReadableStream<LanguageModelV4StreamPart>(
        {
          cancel,
          pull(controller) {
            const part = parts[reads++];
            if (part) controller.enqueue(part);
            else controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
    });
    const result = await createSAPAIProviderV4(settings)("fixture").doStream({ prompt });
    expect(reads).toBe(0);
    const observed: LanguageModelV4StreamPart[] = [];
    const reader = result.stream.getReader();
    for (const expected of parts) {
      const next = await reader.read();
      if (next.done) throw new Error("Native stream ended before all variants");
      expect(next.value.type).toBe(expected.type);
      observed.push(next.value);
    }
    expect(observed).toHaveLength(parts.length);
    expect(observed[0]).toEqual(parts[0]);
    expect(observed).toContainEqual({
      id: "tool",
      inputEncoding: "text",
      toolName: "editor",
      type: "tool-input-start",
    });
    expect(observed).toContainEqual({ rawValue: { fixture: "raw" }, type: "raw" });
    expect(observed.at(-1)).toMatchObject({
      finishReason: { unified: "interrupted" },
      providerMetadata: { "sap-custom": { api: "responses" } },
    });
    expect(observed.find((part) => part.type === "reasoning-file")).toMatchObject({
      providerMetadata: { "sap-custom": { itemId: "reasoning-file" } },
    });
    await reader.cancel("consumer finished");
    reader.releaseLock();
    expect(cancel).toHaveBeenCalledWith("consumer finished");
    expect(delegate.dispose).toHaveBeenCalledWith("consumer finished");
  });

  it("keeps unsupported legacy generation output inside disposal and error classification", async () => {
    const error: unknown = await createSAPAIProvider(settings)("fixture")
      .doGenerate({ prompt })
      .catch((error: unknown) => error);
    expect(UnsupportedFunctionalityError.isInstance(error)).toBe(true);
    expect(delegate.dispose).toHaveBeenCalledWith(error);
  });

  it("emits legacy conversion failures as error events and cancels the delegate reader", async () => {
    const cancel = vi.fn();
    delegate.stream.mockResolvedValue({
      stream: new ReadableStream<LanguageModelV4StreamPart>(
        {
          cancel,
          pull(controller) {
            controller.enqueue({ kind: "openai.compaction", type: "custom" });
          },
        },
        { highWaterMark: 0 },
      ),
    });
    const result = await createSAPAIProvider(settings)("fixture").doStream({ prompt });
    const parts = [];
    for await (const part of result.stream) parts.push(part);
    expect(parts).toHaveLength(1);
    const part = parts[0];
    if (part?.type !== "error") throw new Error("Expected a legacy conversion error event");
    expect(UnsupportedFunctionalityError.isInstance(part.error)).toBe(true);
    expect(delegate.dispose).toHaveBeenCalledWith(part.error);
    expect(cancel).toHaveBeenCalledWith(part.error);
  });
});
