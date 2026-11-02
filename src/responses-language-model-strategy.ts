/** OpenAI Responses through SAP AI Core's authenticated HTTP transport. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Citation,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { createOpenAI } from "@ai-sdk/openai";
import { APICallError } from "@ai-sdk/provider";
import { z } from "zod";

import type { ResponsesRequestContext } from "./responses-http-transport.js";
import type { SAPAIModelSettings, SAPAISettings } from "./sap-ai-settings.js";
import type {
  LanguageModelStrategyConfig,
  ResponsesLanguageModelAPIStrategy,
} from "./sap-ai-strategy.js";
import type { AISDKRequestBodySummary } from "./strategy-utils.js";

import { createAbortError } from "./abort-utils.js";
import { convertResponsesCallToV4 } from "./responses-adapters-v3-to-v4.js";
import {
  convertResponsesResultToV3,
  convertResponsesStreamPartToV3,
} from "./responses-adapters-v4-to-v3.js";
import { createResponsesTransport } from "./responses-http-transport.js";
import { prepareResponsesPrompt, toOpenAIProviderOptions } from "./responses-prompt.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import { getProviderName } from "./sap-ai-provider-options.js";
import { createAISDKRequestBodySummary } from "./strategy-utils.js";
import { VERSION } from "./version.js";

const MODEL_PARAMETERS = new Set([
  "frequencyPenalty",
  "maxTokens",
  "parallel_tool_calls",
  "presencePenalty",
  "temperature",
  "topP",
]);

const OPENAI_STREAM_ERROR_SCHEMA = z.object({
  data: z.object({ type: z.enum(["error", "response.failed"]) }).loose(),
  isRetryable: z.boolean(),
  message: z.string(),
  statusCode: z.number().int().min(400).max(599),
});

/**
 * Responses strategy shared by the V2, V3, and V4 public providers.
 * @internal
 */
export class ResponsesLanguageModelStrategy implements ResponsesLanguageModelAPIStrategy {
  doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    return this.generate(config, settings, options, true);
  }

  doGenerateV4(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4GenerateResult> {
    return this.generate(config, settings, options, false);
  }

  doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    return this.stream(config, settings, options, true);
  }

  doStreamV4(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV4CallOptions,
  ): Promise<LanguageModelV4StreamResult> {
    return this.stream(config, settings, options, false);
  }

  private generate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
    legacy: true,
  ): Promise<LanguageModelV3GenerateResult>;
  private generate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV4CallOptions,
    legacy: false,
  ): Promise<LanguageModelV4GenerateResult>;
  private async generate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions | LanguageModelV4CallOptions,
    legacy: boolean,
  ) {
    let dispose: ((reason?: unknown) => void) | undefined;
    let requestBody: AISDKRequestBodySummary | undefined;
    const context: ResponsesRequestContext = {
      abortSignal: options.abortSignal,
      getRequestBodySummary: () => (requestBody ??= createAISDKRequestBodySummary(options)),
      headers: options.headers,
      operation: "doGenerate",
    };
    let getBodyReadFailure: ((error: unknown) => APICallError | undefined) | undefined;
    try {
      if (options.abortSignal?.aborted) throw createAbortError(options.abortSignal.reason);
      const inputOptions = legacy
        ? convertResponsesCallToV4(options as LanguageModelV3CallOptions)
        : (options as LanguageModelV4CallOptions);
      const prepared = await prepareModel(config, settings, inputOptions, context);
      dispose = prepared.dispose;
      getBodyReadFailure = prepared.getBodyReadFailure;
      const { input, model, providerName, warnings } = prepared;
      const native = await model.doGenerate(input);
      const result: LanguageModelV4GenerateResult = {
        ...native,
        content: native.content.map((part) => fromOpenAIContent(part, providerName)),
        providerMetadata: responseMetadata(native.providerMetadata, providerName),
        warnings: [...warnings, ...native.warnings],
      };
      return legacy ? convertResponsesResultToV3(result) : result;
    } catch (error) {
      const failure = convertError(error, config, context, getBodyReadFailure);
      dispose?.(failure);
      throw failure;
    }
  }

  private stream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
    legacy: true,
  ): Promise<LanguageModelV3StreamResult>;
  private stream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV4CallOptions,
    legacy: false,
  ): Promise<LanguageModelV4StreamResult>;
  private async stream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions | LanguageModelV4CallOptions,
    legacy: boolean,
  ) {
    let dispose: ((reason?: unknown) => void) | undefined;
    let requestBody: AISDKRequestBodySummary | undefined;
    const context: ResponsesRequestContext = {
      abortSignal: options.abortSignal,
      getRequestBodySummary: () => (requestBody ??= createAISDKRequestBodySummary(options)),
      headers: options.headers,
      operation: "doStream",
    };
    let getBodyReadFailure: ((error: unknown) => APICallError | undefined) | undefined;
    try {
      if (options.abortSignal?.aborted) throw createAbortError(options.abortSignal.reason);
      const inputOptions = legacy
        ? convertResponsesCallToV4(options as LanguageModelV3CallOptions)
        : (options as LanguageModelV4CallOptions);
      const prepared = await prepareModel(config, settings, inputOptions, context);
      dispose = prepared.dispose;
      getBodyReadFailure = prepared.getBodyReadFailure;
      const { input, model, providerName, warnings } = prepared;
      const result = await model.doStream(input);
      const reader = result.stream.getReader();
      let cancelled = false;
      const isCancelled = () => cancelled;
      return {
        ...result,
        stream: new ReadableStream<LanguageModelV3StreamPart | LanguageModelV4StreamPart>(
          {
            async cancel(reason) {
              cancelled = true;
              dispose?.(reason);
              try {
                await reader.cancel(reason);
              } finally {
                reader.releaseLock();
              }
            },
            async pull(controller) {
              try {
                if (options.abortSignal?.aborted)
                  throw createAbortError(options.abortSignal.reason);
                const next = await reader.read();
                if (isCancelled()) return;
                if (options.abortSignal?.aborted)
                  throw createAbortError(options.abortSignal.reason);
                if (next.done) {
                  reader.releaseLock();
                  controller.close();
                  return;
                }
                let part = next.value;
                if (part.type === "stream-start") {
                  part = { ...part, warnings: [...warnings, ...part.warnings] };
                } else if (part.type === "finish") {
                  part = {
                    ...part,
                    providerMetadata: responseMetadata(part.providerMetadata, providerName),
                  };
                } else if (part.type === "error") {
                  part = {
                    ...part,
                    error: convertError(part.error, config, context, getBodyReadFailure),
                  };
                } else if ("providerMetadata" in part || part.type === "text-end") {
                  part = fromOpenAIContent(part, providerName);
                }
                controller.enqueue(legacy ? convertResponsesStreamPartToV3(part) : part);
              } catch (error) {
                if (isCancelled()) return;
                const failure = convertError(error, config, context, getBodyReadFailure);
                dispose?.(failure);
                // Cleanup failures must not replace the original request or cancellation error.
                await reader.cancel(error).catch(() => undefined);
                if (isCancelled()) return;
                reader.releaseLock();
                controller.enqueue({
                  error: failure,
                  type: "error",
                });
                controller.close();
              }
            },
          },
          { highWaterMark: 0 },
        ),
      };
    } catch (error) {
      const failure = convertError(error, config, context, getBodyReadFailure);
      dispose?.(failure);
      throw failure;
    }
  }
}

/**
 * Applies the provider's shared error contract without copying transport credentials.
 * @param error - Delegate or SAP transport error.
 * @param config - Model configuration.
 * @param context - Invocation operation and safe diagnostics.
 * @param getBodyReadFailure - Recovers body-read failures owned by this invocation.
 * @returns The corresponding AI SDK error.
 */
function convertError(
  error: unknown,
  config: LanguageModelStrategyConfig,
  context: ResponsesRequestContext,
  getBodyReadFailure?: (error: unknown) => APICallError | undefined,
) {
  const bodyReadFailure = getBodyReadFailure?.(error);
  if (bodyReadFailure) return bodyReadFailure;
  if (context.operation === "doStream" && !APICallError.isInstance(error)) {
    const parsed = OPENAI_STREAM_ERROR_SCHEMA.safeParse(error);
    if (parsed.success) {
      return new APICallError({
        cause: error,
        data: parsed.data.data,
        isRetryable: parsed.data.isRetryable,
        message: parsed.data.message,
        requestBodyValues: context.getRequestBodySummary(),
        statusCode: parsed.data.statusCode,
        url: "sap-ai:responses",
      });
    }
  }
  return convertToAISDKError(error, {
    modelId: config.modelId,
    modelType: "languageModel",
    operation: context.operation,
    requestBody: context.getRequestBodySummary(),
    url: "sap-ai:responses",
  });
}

/**
 * Exposes native Responses metadata under the configured SAP namespace.
 * @param metadata - Responses metadata.
 * @param providerName - Configured SAP provider namespace.
 * @returns Namespaced metadata.
 */
function fromOpenAI(
  metadata: SharedV3ProviderMetadata | undefined,
  providerName: string,
): SharedV3ProviderMetadata | undefined {
  if (providerName === "openai" || !metadata?.openai) return metadata;
  const { openai, ...rest } = metadata;
  return { ...rest, [providerName]: { ...rest[providerName], ...openai } };
}

/**
 * Remaps only citation source metadata, retaining untouched sources and positions.
 * @param citations - Native V4 text citations.
 * @param providerName - Resolved SAP provider namespace.
 * @returns The original array unless a source namespace changes.
 */
function fromOpenAICitations(
  citations: LanguageModelV4Citation[] | undefined,
  providerName: string,
): LanguageModelV4Citation[] | undefined {
  if (providerName === "openai" || !citations) return citations;
  let mapped: LanguageModelV4Citation[] | undefined;
  let index = 0;
  for (const citation of citations) {
    const providerMetadata = fromOpenAI(citation.source.providerMetadata, providerName);
    if (providerMetadata !== citation.source.providerMetadata) {
      mapped ??= citations.slice();
      mapped[index] = {
        ...citation,
        source: { ...citation.source, providerMetadata },
      };
    }
    index++;
  }
  return mapped ?? citations;
}

/**
 * Applies the same namespace policy to direct metadata and nested citation sources.
 * @param part - Native content or a text-end event.
 * @param providerName - Resolved SAP provider namespace.
 * @returns The original part when no metadata changes, otherwise an immutable copy.
 */
function fromOpenAIContent<
  T extends {
    citations?: LanguageModelV4Citation[];
    providerMetadata?: SharedV3ProviderMetadata;
  },
>(part: T, providerName: string): T {
  const providerMetadata = fromOpenAI(part.providerMetadata, providerName);
  const citations = fromOpenAICitations(part.citations, providerName);
  if (providerMetadata === part.providerMetadata && citations === part.citations) return part;
  if (providerMetadata === part.providerMetadata) return { ...part, citations };
  return citations === part.citations
    ? { ...part, providerMetadata }
    : { ...part, citations, providerMetadata };
}

/**
 * Maps configured structured output to the common AI SDK call format.
 * @param settings - Model settings.
 * @returns The corresponding AI SDK response format.
 */
function modelResponseFormat(
  settings: SAPAISettings,
): LanguageModelV3CallOptions["responseFormat"] {
  const format = settings.responseFormat;
  if (!format || format.type === "text") return format;
  if (format.type === "json_object") return { type: "json" };
  const schema = format.json_schema;
  return {
    description: schema.description,
    name: schema.name,
    schema:
      schema.schema === undefined ? undefined : z.record(z.string(), z.json()).parse(schema.schema),
    type: "json",
  };
}

/**
 * Resolves SAP transport and maps the provider's configuration to Responses options.
 * @param config - SAP deployment and transport configuration.
 * @param settings - Model defaults.
 * @param options - Invocation options.
 * @param context - Invocation cancellation, headers, and safe diagnostics.
 * @returns The delegate and its normalized invocation.
 */
async function prepareModel(
  config: LanguageModelStrategyConfig,
  settings: SAPAISettings,
  options: LanguageModelV4CallOptions,
  context: ResponsesRequestContext,
): Promise<{
  dispose: (reason?: unknown) => void;
  getBodyReadFailure: (error: unknown) => APICallError | undefined;
  input: LanguageModelV4CallOptions;
  model: LanguageModelV4;
  providerName: string;
  warnings: SharedV3Warning[];
}> {
  if (options.abortSignal?.aborted) {
    throw createAbortError(options.abortSignal.reason);
  }
  const providerName = getProviderName(config.provider);
  const sapOptions = config.parsedProviderOptions;
  const parameters = { ...settings.modelParams, ...sapOptions?.modelParams };
  const warnings: SharedV3Warning[] = Object.keys(parameters)
    .filter((key) => !MODEL_PARAMETERS.has(key))
    .map((key) => ({
      details: "Use the responses option for Responses-specific parameters.",
      feature: `modelParams.${key}`,
      type: "unsupported",
    }));
  if (sapOptions?.includeReasoning ?? settings.includeReasoning) {
    warnings.push({
      details: "Responses preserves native reasoning history instead of converting it to text.",
      feature: "includeReasoning",
      type: "unsupported",
    });
  }
  const responseOptions = {
    ...(parameters.parallel_tool_calls !== undefined
      ? { parallelToolCalls: parameters.parallel_tool_calls }
      : {}),
    ...(settings.responseFormat?.type === "json_schema"
      ? { strictJsonSchema: settings.responseFormat.json_schema.strict }
      : {}),
    store: false,
    ...settings.responses,
    ...sapOptions?.responses,
  };
  const reasoning = "reasoning" in options ? options.reasoning : undefined;
  if (typeof reasoning === "string" && reasoning !== "provider-default") {
    responseOptions.reasoningEffort = reasoning;
  }
  const input: LanguageModelV4CallOptions = {
    ...options,
    frequencyPenalty: options.frequencyPenalty ?? parameters.frequencyPenalty,
    maxOutputTokens: options.maxOutputTokens ?? parameters.maxTokens,
    presencePenalty: options.presencePenalty ?? parameters.presencePenalty,
    prompt: prepareResponsesPrompt(options.prompt, providerName),
    providerOptions: {
      ...options.providerOptions,
      openai: responseOptions,
    },
    responseFormat: options.responseFormat ?? modelResponseFormat(settings),
    temperature: options.temperature ?? parameters.temperature,
    tools: options.tools?.map((tool) =>
      tool.type === "function"
        ? {
            ...tool,
            providerOptions: toOpenAIProviderOptions(tool.providerOptions, providerName),
            strict: tool.strict ?? false,
          }
        : tool,
    ),
    topP: options.topP ?? parameters.topP,
  };
  const transport = await createResponsesTransport(config, settings, context);
  const model = createOpenAI({
    // Authentication is supplied by SAP's transport, not an OpenAI API key.
    apiKey: "sap-ai-core",
    baseURL: transport.baseURL,
    fetch: transport.fetch,
  }).responses(config.modelId);
  return {
    dispose: transport.dispose,
    getBodyReadFailure: transport.getBodyReadFailure,
    input,
    model,
    providerName,
    warnings,
  };
}

/**
 * Adds provider identity to the final Responses metadata.
 * @param metadata - Delegate metadata.
 * @param providerName - Configured SAP provider namespace.
 * @returns Final provider metadata.
 */
function responseMetadata(
  metadata: SharedV3ProviderMetadata | undefined,
  providerName: string,
): SharedV3ProviderMetadata {
  const mapped = fromOpenAI(metadata, providerName);
  return {
    ...mapped,
    [providerName]: { ...mapped?.[providerName], api: "responses", version: VERSION },
  };
}
