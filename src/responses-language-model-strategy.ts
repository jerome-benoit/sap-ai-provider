/** OpenAI Responses through SAP AI Core's authenticated HTTP transport. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolResultOutput,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Citation,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from "@ai-sdk/provider";

import { createOpenAI } from "@ai-sdk/openai";
import { APICallError } from "@ai-sdk/provider";
import { z } from "zod";

import type { SAPAIModelSettings, SAPAISettings } from "./sap-ai-settings.js";
import type { LanguageModelAPIStrategy, LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertResponsesCallToV4 } from "./responses-adapters-v3-to-v4.js";
import {
  convertResponsesResultToV3,
  convertResponsesStreamPartToV3,
} from "./responses-adapters-v4-to-v3.js";
import { createResponsesTransport } from "./responses-http-transport.js";
import { convertToAISDKError } from "./sap-ai-error.js";
import { getProviderName } from "./sap-ai-provider-options.js";
import { createAISDKRequestBodySummary } from "./strategy-utils.js";
import { createAbortError } from "./stream-transformer.js";
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

type PromptPart = Exclude<LanguageModelV3Prompt[number], { role: "system" }>["content"][number];

/**
 * Responses strategy shared by the V2, V3, and V4 public providers.
 * @internal
 */
export class ResponsesLanguageModelStrategy implements LanguageModelAPIStrategy {
  async doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    try {
      const { input, model, providerName, warnings } = await prepareModel(
        config,
        settings,
        options,
      );
      const result = convertResponsesResultToV3(await model.doGenerate(input));
      return {
        ...result,
        content: result.content.map((part) => fromOpenAIContent(part, providerName)),
        providerMetadata: responseMetadata(result.providerMetadata, providerName),
        warnings: [...warnings, ...result.warnings],
      };
    } catch (error) {
      throw convertError(error, config, options, "doGenerate");
    }
  }

  async doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    try {
      const { input, model, providerName, warnings } = await prepareModel(
        config,
        settings,
        options,
      );
      const result = await model.doStream(input);
      const reader = result.stream.getReader();
      let cancelled = false;
      const isCancelled = () => cancelled;
      return {
        ...result,
        stream: new ReadableStream<LanguageModelV3StreamPart>(
          {
            async cancel(reason) {
              cancelled = true;
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
                const part = convertResponsesStreamPartToV3(next.value);
                if (part.type === "stream-start") {
                  controller.enqueue({ ...part, warnings: [...warnings, ...part.warnings] });
                } else if (part.type === "finish") {
                  controller.enqueue({
                    ...part,
                    providerMetadata: responseMetadata(part.providerMetadata, providerName),
                  });
                } else if (part.type === "error") {
                  controller.enqueue({
                    ...part,
                    error: convertError(part.error, config, options, "doStream"),
                  });
                } else if ("providerMetadata" in part || part.type === "text-end") {
                  controller.enqueue(fromOpenAIContent(part, providerName));
                } else {
                  controller.enqueue(part);
                }
              } catch (error) {
                if (isCancelled()) return;
                // Cleanup failures must not replace the original request or cancellation error.
                await reader.cancel(error).catch(() => undefined);
                if (isCancelled()) return;
                reader.releaseLock();
                controller.enqueue({
                  error: convertError(error, config, options, "doStream"),
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
      throw convertError(error, config, options, "doStream");
    }
  }
}

/**
 * Applies the provider's shared error contract without copying transport credentials.
 * @param error - Delegate or SAP transport error.
 * @param config - Model configuration.
 * @param options - Invocation options.
 * @param operation - Generation operation.
 * @returns The corresponding AI SDK error.
 */
function convertError(
  error: unknown,
  config: LanguageModelStrategyConfig,
  options: LanguageModelV3CallOptions,
  operation: "doGenerate" | "doStream",
) {
  // The delegate can hide a classified body-read failure under a successful HTTP status.
  if (
    APICallError.isInstance(error) &&
    error.message === "Failed to process successful response" &&
    error.statusCode !== undefined &&
    error.statusCode >= 200 &&
    error.statusCode < 300 &&
    APICallError.isInstance(error.cause)
  ) {
    return error.cause;
  }
  if (operation === "doStream" && !APICallError.isInstance(error)) {
    const parsed = OPENAI_STREAM_ERROR_SCHEMA.safeParse(error);
    if (parsed.success) {
      return new APICallError({
        cause: error,
        data: parsed.data.data,
        isRetryable: parsed.data.isRetryable,
        message: parsed.data.message,
        requestBodyValues: createAISDKRequestBodySummary(options),
        statusCode: parsed.data.statusCode,
        url: "sap-ai:responses",
      });
    }
  }
  return convertToAISDKError(error, {
    modelId: config.modelId,
    modelType: "languageModel",
    operation,
    requestBody: createAISDKRequestBodySummary(options),
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
 * @param citations - V4 citations preserved through the shared V3 core.
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
 * @param part - Content or a text-end event, including preserved V4 citation fields.
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
 * @returns The delegate and its normalized invocation.
 */
async function prepareModel(
  config: LanguageModelStrategyConfig,
  settings: SAPAISettings,
  options: LanguageModelV3CallOptions,
): Promise<{
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
  const input: LanguageModelV3CallOptions = {
    ...options,
    frequencyPenalty: options.frequencyPenalty ?? parameters.frequencyPenalty,
    maxOutputTokens: options.maxOutputTokens ?? parameters.maxTokens,
    presencePenalty: options.presencePenalty ?? parameters.presencePenalty,
    prompt: toOpenAIPrompt(options.prompt, providerName),
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
            providerOptions: toOpenAI(tool.providerOptions, providerName),
            strict: tool.strict ?? false,
          }
        : tool,
    ),
    topP: options.topP ?? parameters.topP,
  };
  const transport = await createResponsesTransport(config, settings, options);
  const model = createOpenAI({
    // Authentication is supplied by SAP's transport, not an OpenAI API key.
    apiKey: "sap-ai-core",
    baseURL: transport.baseURL,
    fetch: transport.fetch,
  }).responses(config.modelId);
  return { input: convertResponsesCallToV4(input), model, providerName, warnings };
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

/**
 * Restores the native namespace used by OpenAI's history converter.
 * @param options - Provider options on a message, part, or tool.
 * @param providerName - Configured SAP provider namespace.
 * @returns Options with a native OpenAI slice.
 */
function toOpenAI(
  options: SharedV3ProviderOptions | undefined,
  providerName: string,
): SharedV3ProviderOptions | undefined {
  if (providerName === "openai" || !options?.[providerName]) return options;
  return { ...options, openai: { ...options.openai, ...options[providerName] } };
}

/**
 * Translates provider-specific file IDs and metadata nested in tool output.
 * @param output - Tool output.
 * @param providerName - Configured SAP provider namespace.
 * @returns Tool output with native Responses identifiers.
 */
function toOpenAIOutput(
  output: LanguageModelV3ToolResultOutput & { providerOptions?: SharedV3ProviderOptions },
  providerName: string,
): LanguageModelV3ToolResultOutput {
  const mappedOutput = {
    ...output,
    providerOptions: toOpenAI(output.providerOptions, providerName),
  };
  if (mappedOutput.type !== "content") return mappedOutput;
  return {
    ...mappedOutput,
    value: mappedOutput.value.map((part) => ({
      ...part,
      ...((part.type === "file-id" || part.type === "image-file-id") &&
      typeof part.fileId !== "string" &&
      part.fileId[providerName]
        ? { fileId: { ...part.fileId, openai: part.fileId[providerName] } }
        : {}),
      ...("providerOptions" in part
        ? { providerOptions: toOpenAI(part.providerOptions, providerName) }
        : {}),
    })),
  };
}

/**
 * Translates one prompt part while preserving its message-specific type.
 * @param part - Input part.
 * @param providerName - Configured SAP provider namespace.
 * @returns The translated input part.
 */
function toOpenAIPart<T extends PromptPart>(part: T, providerName: string): T {
  return {
    ...part,
    ...(part.type === "tool-result" ? { output: toOpenAIOutput(part.output, providerName) } : {}),
    providerOptions: toOpenAI(part.providerOptions, providerName),
  };
}

/**
 * Preserves reasoning IDs, encrypted content, and tool metadata across requests.
 * @param prompt - The normalized AI SDK prompt.
 * @param providerName - Configured SAP provider namespace.
 * @returns The prompt understood by the Responses delegate.
 */
function toOpenAIPrompt(
  prompt: LanguageModelV3Prompt,
  providerName: string,
): LanguageModelV3Prompt {
  return prompt.map((message) => {
    const providerOptions = toOpenAI(message.providerOptions, providerName);
    switch (message.role) {
      case "assistant":
        return {
          ...message,
          content: message.content.map((part) => toOpenAIPart(part, providerName)),
          providerOptions,
        };
      case "system":
        return { ...message, providerOptions };
      case "tool":
        return {
          ...message,
          content: message.content.map((part) => toOpenAIPart(part, providerName)),
          providerOptions,
        };
      case "user":
        return {
          ...message,
          content: message.content.map((part) => toOpenAIPart(part, providerName)),
          providerOptions,
        };
    }
  });
}
