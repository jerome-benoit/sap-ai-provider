/**
 * Shared utilities for SAP AI Core strategy implementations.
 *
 * Contains common functions used by both Orchestration and Foundation Models strategies
 * to avoid code duplication and ensure consistency.
 */
import type {
  EmbeddingModelV3Embedding,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { ZodType } from "zod";

import { z } from "zod";

/**
 * Vercel AI SDK tool choice type.
 * @internal
 */
export type AISDKToolChoice =
  | { toolName: string; type: "tool" }
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" };

/**
 * Base configuration for model deployment resolution.
 * Shared fields used by buildModelDeployment helper.
 * @internal
 */
export interface BaseModelDeploymentConfig {
  /** Deployment configuration (ID-based or resource group-based). */
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  /** The model identifier (e.g., 'gpt-4o', 'text-embedding-ada-002'). */
  readonly modelId: string;
}

/**
 * Result of extracting tool parameters from an AI SDK tool.
 * @internal
 */
export interface ExtractedToolParameters {
  /** The extracted SAP-compatible parameters. */
  readonly parameters: SAPToolParameters;
  /** Optional warning if schema conversion failed. */
  readonly warning?: SharedV3Warning;
}

/**
 * Extended function tool interface with optional parameters property.
 * @internal
 */
export interface FunctionToolWithParameters extends LanguageModelV3FunctionTool {
  readonly parameters?: unknown;
}

/**
 * Parameter mapping for AI SDK options → SAP model params.
 *
 * Used to map between different parameter naming conventions:
 * - AI SDK uses camelCase (e.g., `maxOutputTokens`)
 * - SAP APIs use snake_case (e.g., `max_tokens`)
 * @internal
 */
export interface ParamMapping {
  /** camelCase key in modelParams to read from and remove (e.g., 'maxTokens', 'topP'). */
  readonly camelCaseKey?: string;
  /** AI SDK option key (e.g., 'maxOutputTokens', 'topP'). */
  readonly optionKey?: string;
  /** Output key for SAP API (e.g., 'max_tokens', 'top_p'). */
  readonly outputKey: string;
}

/**
 * SAP Foundation Models SDK tool_choice type.
 * Matches AzureOpenAiChatCompletionToolChoiceOption from `@sap-ai-sdk/foundation-models`.
 * @internal
 */
export type SAPToolChoice =
  | "auto"
  | "none"
  | "required"
  | { function: { name: string }; type: "function" };

/**
 * SAP-compatible tool parameters structure.
 * Must have type "object" as required by the SAP AI APIs.
 * @internal
 */
export type SAPToolParameters = Record<string, unknown> & {
  type: "object";
};

/**
 * State object for tracking streaming response processing.
 * @internal
 */
export interface StreamState {
  /** Whether a text block is currently active. */
  activeText: boolean;
  /** The finish reason for the response. */
  finishReason: LanguageModelV3FinishReason;
  /** Whether this is the first chunk in the stream. */
  isFirstChunk: boolean;
  /** Token usage tracking. */
  usage: {
    inputTokens: {
      cacheRead: number | undefined;
      cacheWrite: number | undefined;
      noCache: number | undefined;
      total: number | undefined;
    };
    outputTokens: {
      reasoning: number | undefined;
      text: number | undefined;
      total: number | undefined;
    };
  };
}

/**
 * Generates unique IDs for streaming response parts.
 *
 * Uses crypto.randomUUID() for cryptographically secure unique identifiers.
 * @internal
 */
export class StreamIdGenerator {
  /**
   * Generates a unique response ID.
   * @returns A UUID string for identifying the response.
   */
  generateResponseId(): string {
    return crypto.randomUUID();
  }

  /**
   * Generates a unique text block ID.
   * @returns A UUID string for identifying a text block.
   */
  generateTextBlockId(): string {
    return crypto.randomUUID();
  }
}

/**
 * Applies parameter overrides from AI SDK options and modelParams.
 * @param modelParams - The model parameters object to modify.
 * @param options - AI SDK call options.
 * @param sapModelParams - Provider options model params.
 * @param settingsModelParams - Settings model params.
 * @param mappings - Parameter mappings for this strategy.
 * @internal
 */
export function applyParameterOverrides(
  modelParams: Record<string, unknown>,
  options: Record<string, unknown>,
  sapModelParams: Record<string, unknown> | undefined,
  settingsModelParams: Record<string, unknown> | undefined,
  mappings: readonly ParamMapping[],
): void {
  for (const mapping of mappings) {
    const value =
      (mapping.optionKey ? options[mapping.optionKey] : undefined) ??
      (mapping.camelCaseKey ? sapModelParams?.[mapping.camelCaseKey] : undefined) ??
      (mapping.camelCaseKey ? settingsModelParams?.[mapping.camelCaseKey] : undefined);

    if (value !== undefined) {
      modelParams[mapping.outputKey] = value;
    }

    if (mapping.camelCaseKey && mapping.camelCaseKey !== mapping.outputKey) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete modelParams[mapping.camelCaseKey];
    }
  }
}

/**
 * Builds a ModelDeployment object for the Foundation Models API SDK.
 *
 * Supports both deployment resolution strategies:
 * - Direct deploymentId: Uses the specific deployment directly
 * - Model-based: Uses modelName with optional modelVersion and resourceGroup
 * @param config - The strategy configuration containing deployment info and model ID.
 * @param modelVersion - Optional model version for model-based resolution.
 * @returns A ModelDeployment object for the Foundation Models API SDK.
 * @internal
 */
export function buildModelDeployment(
  config: BaseModelDeploymentConfig,
  modelVersion?: string,
): { deploymentId: string } | { modelName: string; modelVersion?: string; resourceGroup?: string } {
  const deploymentConfig = config.deploymentConfig;

  // Use deploymentId directly if provided
  if ("deploymentId" in deploymentConfig) {
    return { deploymentId: deploymentConfig.deploymentId };
  }

  // Build model-based deployment with optional version and resourceGroup
  const resourceGroup =
    "resourceGroup" in deploymentConfig ? deploymentConfig.resourceGroup : undefined;

  return {
    modelName: config.modelId,
    ...(modelVersion && { modelVersion }),
    ...(resourceGroup && { resourceGroup }),
  };
}

/**
 * Builds SAP AI SDK-compatible tool parameters from a JSON schema.
 *
 * Handles edge cases:
 * - Non-object schemas are converted to empty object schemas
 * - Preserves additional schema fields (description, etc.)
 * - Validates properties and required arrays
 * @param schema - The JSON schema to convert.
 * @returns The SAP-compatible tool parameters object.
 * @internal
 */
export function buildSAPToolParameters(schema: Record<string, unknown>): SAPToolParameters {
  const schemaType = schema.type;

  // Non-object schemas are not supported - return empty object schema
  if (schemaType !== undefined && schemaType !== "object") {
    return {
      properties: {},
      required: [],
      type: "object",
    };
  }

  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};

  const required =
    Array.isArray(schema.required) && schema.required.every((item) => typeof item === "string")
      ? schema.required
      : [];

  // Preserve additional fields like description, additionalProperties, etc.
  const additionalFields = Object.fromEntries(
    Object.entries(schema).filter(
      ([key]) => key !== "type" && key !== "properties" && key !== "required",
    ),
  );

  return {
    properties,
    required,
    type: "object",
    ...additionalFields,
  };
}

/**
 * Creates a summary of Vercel AI SDK request options for error context.
 *
 * Extracts key information without including sensitive prompt data.
 * Used for debugging and error reporting.
 * @param options - The language model call options to summarize.
 * @returns An object summarizing the request for debugging.
 * @internal
 */
export function createAISDKRequestBodySummary(options: LanguageModelV3CallOptions): {
  hasImageParts: boolean;
  maxOutputTokens?: number;
  promptMessages: number;
  responseFormatType?: string;
  seed?: number;
  stopSequences?: number;
  temperature?: number;
  toolChoiceType?: string;
  tools: number;
  topK?: number;
  topP?: number;
} {
  return {
    hasImageParts: options.prompt.some(
      (message) =>
        message.role === "user" &&
        message.content.some((part) => part.type === "file" && part.mediaType.startsWith("image/")),
    ),
    maxOutputTokens: options.maxOutputTokens,
    promptMessages: options.prompt.length,
    responseFormatType: options.responseFormat?.type,
    seed: options.seed,
    stopSequences: options.stopSequences?.length,
    temperature: options.temperature,
    toolChoiceType: options.toolChoice?.type,
    tools: options.tools?.length ?? 0,
    topK: options.topK,
    topP: options.topP,
  };
}

/**
 * Creates the initial stream state for processing streaming responses.
 *
 * Provides consistent initial state across both Orchestration and Foundation Models strategies.
 * @returns The initial stream state object.
 * @internal
 */
export function createInitialStreamState(): StreamState {
  return {
    activeText: false,
    finishReason: {
      raw: undefined,
      unified: "other" as const,
    },
    isFirstChunk: true,
    usage: {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: undefined,
        total: undefined,
      },
      outputTokens: {
        reasoning: undefined,
        text: undefined,
        total: undefined,
      },
    },
  };
}

/**
 * Extracts SAP-compatible tool parameters from an AI SDK function tool.
 *
 * Handles multiple schema formats:
 * - Zod schemas (converted via z.toJSONSchema)
 * - JSON Schema objects with properties
 * - Empty/missing schemas (returns empty object schema)
 * @param tool - The AI SDK function tool to extract parameters from.
 * @returns The extracted parameters and optional warning.
 * @internal
 */
export function extractToolParameters(tool: LanguageModelV3FunctionTool): ExtractedToolParameters {
  const inputSchema = tool.inputSchema as Record<string, unknown> | undefined;
  const toolWithParams = tool as FunctionToolWithParameters;

  if (toolWithParams.parameters && isZodSchema(toolWithParams.parameters)) {
    try {
      const jsonSchema = z.toJSONSchema(toolWithParams.parameters);
      const schemaRecord = jsonSchema as Record<string, unknown>;
      delete schemaRecord.$schema;
      return { parameters: buildSAPToolParameters(schemaRecord) };
    } catch (error) {
      return {
        parameters: buildSAPToolParameters({}),
        warning: {
          details: `Failed to convert tool Zod schema: ${error instanceof Error ? error.message : String(error)}. Falling back to empty object schema.`,
          feature: `tool schema conversion for ${tool.name}`,
          type: "unsupported",
        },
      };
    }
  }

  if (inputSchema && Object.keys(inputSchema).length > 0) {
    const hasProperties =
      inputSchema.properties &&
      typeof inputSchema.properties === "object" &&
      Object.keys(inputSchema.properties).length > 0;

    if (hasProperties) {
      return { parameters: buildSAPToolParameters(inputSchema) };
    }
  }

  return { parameters: buildSAPToolParameters({}) };
}

/**
 * Checks if an object has a callable parse method.
 * @param obj - The object to check for a parse method.
 * @returns True if the object has a callable parse method.
 * @internal
 */
export function hasCallableParse(
  obj: Record<string, unknown>,
): obj is Record<string, unknown> & { parse: (...args: unknown[]) => unknown } {
  return typeof obj.parse === "function";
}

/**
 * Type guard for Zod schema objects.
 *
 * Detects Zod schemas by checking for the presence of `_def` and a callable `parse` method.
 * @param obj - The object to check.
 * @returns True if the object is a Zod schema.
 * @internal
 */
export function isZodSchema(obj: unknown): obj is ZodType {
  if (obj === null || typeof obj !== "object") {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return "_def" in record && "parse" in record && hasCallableParse(record);
}

/**
 * Maps provider finish reasons to Vercel AI SDK LanguageModelV3FinishReason.
 *
 * Handles various finish reason formats from different model providers:
 * - OpenAI: "stop", "length", "tool_calls", "content_filter"
 * - Anthropic: "end_turn", "stop_sequence", "max_tokens"
 * - Amazon: "eos", "max_tokens_reached"
 * - Others: "error", "function_call", "tool_call"
 * @param reason - The raw finish reason string from the provider.
 * @returns The unified finish reason with both raw and unified representations.
 * @internal
 */
export function mapFinishReason(reason: null | string | undefined): LanguageModelV3FinishReason {
  const raw = reason ?? undefined;

  if (!reason) {
    return { raw, unified: "other" };
  }

  switch (reason.toLowerCase()) {
    case "content_filter":
      return { raw, unified: "content-filter" };
    case "end_turn":
    case "eos":
    case "stop":
    case "stop_sequence":
      return { raw, unified: "stop" };
    case "error":
      return { raw, unified: "error" };
    case "function_call":
    case "tool_call":
    case "tool_calls":
      return { raw, unified: "tool-calls" };
    case "length":
    case "max_tokens":
    case "max_tokens_reached":
      return { raw, unified: "length" };
    default:
      return { raw, unified: "other" };
  }
}

/**
 * Maps Vercel AI SDK toolChoice to SAP Foundation Models SDK tool_choice format.
 *
 * Mapping:
 * - `{ type: 'auto' }` → `'auto'`
 * - `{ type: 'none' }` → `'none'`
 * - `{ type: 'required' }` → `'required'`
 * - `{ type: 'tool', toolName: 'fn' }` → `{ type: 'function', function: { name: 'fn' } }`
 * @param toolChoice - The Vercel AI SDK tool choice.
 * @returns The SAP SDK tool_choice format, or undefined if no mapping needed.
 * @internal
 */
export function mapToolChoice(toolChoice: AISDKToolChoice | undefined): SAPToolChoice | undefined {
  if (!toolChoice) {
    return undefined;
  }

  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "required":
      return "required";
    case "tool":
      return {
        function: { name: toolChoice.toolName },
        type: "function",
      };
    default:
      return undefined;
  }
}

/**
 * Converts SAP AI SDK embedding (number[] or base64) to Vercel AI SDK format.
 *
 * Handles both formats that can be returned by embedding APIs:
 * - Direct number arrays (most common)
 * - Base64-encoded float32 arrays (for bandwidth efficiency)
 * @param embedding - The embedding as number array or base64 string.
 * @returns The normalized embedding as a number array.
 * @internal
 */
export function normalizeEmbedding(embedding: number[] | string): EmbeddingModelV3Embedding {
  if (Array.isArray(embedding)) {
    return embedding;
  }
  // Base64-encoded float32 values
  const buffer = Buffer.from(embedding, "base64");
  const float32Array = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(float32Array);
}
