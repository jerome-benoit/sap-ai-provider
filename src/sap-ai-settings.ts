import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { AzureOpenAiChatCompletionParameters } from "@sap-ai-sdk/foundation-models";
import type {
  ChatCompletionTool,
  ChatModel,
  FilteringModule,
  GroundingModule,
  MaskingModule,
  OrchestrationConfigRefById,
  OrchestrationConfigRefByName,
  OrchestrationModuleConfig,
  TranslationModule,
} from "@sap-ai-sdk/orchestration";

/** Azure OpenAI chat extension configuration for "On Your Data" RAG scenarios. */
export type AzureOpenAiChatExtensionConfiguration = NonNullable<
  AzureOpenAiChatCompletionParameters["data_sources"]
>[number];

/**
 * Common model parameters shared between APIs.
 *
 * Known parameters are validated by Zod in constructor settings and per-call
 * `modelParams` provider options; additional model-specific keys are passed through.
 */
export interface CommonModelParams {
  /**
   * Frequency penalty to reduce repetition of token sequences.
   * Range: -2.0 to 2.0
   */
  readonly frequencyPenalty?: number;
  /**
   * Maximum number of tokens to generate.
   * Range: Positive integer
   */
  readonly maxTokens?: number;
  /**
   * Number of completions to generate.
   * Availability depends on the selected SAP API and model; no model-family filtering is applied.
   * Range: Positive integer
   */
  readonly n?: number;
  /** Whether to enable parallel tool calls when multiple tools are available. */
  readonly parallel_tool_calls?: boolean;
  /**
   * Presence penalty to encourage talking about new topics.
   * Range: -2.0 to 2.0
   */
  readonly presencePenalty?: number;
  /** Index signature for additional model-specific parameters. */
  readonly [key: string]: unknown;
  /**
   * Sampling temperature controlling randomness.
   * Higher values (e.g., 1.0) make output more random, lower values (e.g., 0.2) more deterministic.
   * Range: 0 to 2
   */
  readonly temperature?: number;
  /**
   * Nucleus sampling parameter. Only tokens with cumulative probability up to `topP` are considered.
   * Range: 0 to 1
   */
  readonly topP?: number;
}

/** Default settings configuration when using Foundation Models API. */
export interface FoundationModelsDefaultSettings {
  readonly api: "foundation-models";
  readonly settings?: FoundationModelsModelSettings;
}

/** Model parameters for Foundation Models Embedding API. */
export interface FoundationModelsEmbeddingParams {
  readonly dimensions?: number;
  readonly encoding_format?: "base64" | "float";
  readonly user?: string;
}

/** Model parameters for Foundation Models API with Azure OpenAI-specific extensions. */
export interface FoundationModelsModelParams extends CommonModelParams {
  readonly logit_bias?: AzureOpenAiChatCompletionParameters["logit_bias"];
  readonly logprobs?: AzureOpenAiChatCompletionParameters["logprobs"];
  readonly seed?: AzureOpenAiChatCompletionParameters["seed"];
  readonly stop?: AzureOpenAiChatCompletionParameters["stop"];
  /** Requires logprobs=true. */
  readonly top_logprobs?: AzureOpenAiChatCompletionParameters["top_logprobs"];
  readonly user?: AzureOpenAiChatCompletionParameters["user"];
}

/** Model settings when using Foundation Models API. */
export interface FoundationModelsModelSettings {
  readonly api: "foundation-models";
  /** Azure OpenAI "On Your Data" configuration for RAG scenarios. */
  readonly dataSources?: AzureOpenAiChatExtensionConfiguration[];
  /**
   * Forward assistant reasoning from the input history as text; does not enable reasoning output.
   * @default false
   */
  readonly includeReasoning?: boolean;
  readonly modelParams?: FoundationModelsModelParams;
  readonly modelVersion?: string;
  readonly responseFormat?: ResponseFormat;
}

/** Default settings configuration when using Orchestration API. */
export interface OrchestrationDefaultSettings {
  readonly api?: "orchestration";
  readonly settings?: OrchestrationModelSettings;
}

/** Model parameters for Orchestration API. */
export type OrchestrationModelParams = CommonModelParams;

/** Model settings when using Orchestration API with filtering, grounding, masking, and translation. */
export interface OrchestrationModelSettings {
  readonly api?: "orchestration";
  /**
   * Whether Orchestration drops parameters unsupported by Responses-only models.
   * Applies to the primary local model, not fallback models or stored configurations.
   * Omitted values retain the SAP service default; false requests an explicit error.
   */
  readonly dropUnsupportedParams?: boolean;
  /** @default true */
  readonly escapeTemplatePlaceholders?: boolean;
  /**
   * Additional module configurations for prompt module fallback.
   * These entries follow the primary configuration in the list passed to the SAP SDK.
   * Each entry is a full `OrchestrationModuleConfig` with its own model, prompt, and modules.
   * @example
   * ```ts
   * fallbackModuleConfigs: [
   *   {
   *     promptTemplating: {
   *       model: { name: "gpt-4.1-mini" },
   *       prompt: { template: [] },
   *     },
   *   },
   * ]
   * ```
   */
  readonly fallbackModuleConfigs?: OrchestrationModuleConfig[];
  readonly filtering?: FilteringModule;
  readonly grounding?: GroundingModule;
  /**
   * Forward assistant reasoning from the input history as text; does not enable reasoning output.
   * @default false
   */
  readonly includeReasoning?: boolean;
  readonly masking?: MaskingModule | { providers: MaskingModule["masking_providers"] };
  readonly modelParams?: OrchestrationModelParams;
  readonly modelVersion?: string;
  /**
   * Reference to a complete orchestration configuration stored in SAP AI Core Prompt Registry.
   * When provided, local module settings (filtering, masking, grounding, translation, tools,
   * promptTemplateRef, responseFormat) are ignored as the full configuration is managed
   * by the referenced config. The reference, including its explicit `overrideConfig`,
   * is passed to the SAP SDK; messages and `placeholderValues` remain request inputs.
   * @example { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" }
   * @example { scenario: "customer-support", name: "prod-config", version: "1.0.0" }
   */
  readonly orchestrationConfigRef?: OrchestrationConfigRefById | OrchestrationConfigRefByName;
  readonly placeholderValues?: Record<string, string>;
  readonly promptTemplateRef?: PromptTemplateRef;
  readonly responseFormat?: ResponseFormat;
  /**
   * Options for streaming behavior with locally configured post-LLM modules.
   * Includes direct `doStream()` calls; ignored when `orchestrationConfigRef` is used.
   */
  readonly streamOptions?: OrchestrationStreamOptions;
  readonly tools?: ChatCompletionTool[];
  readonly translation?: TranslationModule;
}

/**
 * Stream options for orchestration post-LLM module processing.
 * Controls chunking behavior for translation, filtering, and other modules during streaming.
 * Ignored with `orchestrationConfigRef`; configure streaming in the stored
 * configuration or its `overrideConfig` instead.
 */
export interface OrchestrationStreamOptions {
  /**
   * Minimum number of characters per chunk for post-LLM modules.
   * Valid range: 1-10000. Defaults to 100.
   */
  readonly chunkSize?: number;
  /**
   * Delimiters for splitting stream into chunks (e.g., sentence boundaries).
   * Recommended for translation; the provider warns when local translation settings lack them.
   * @example ["\n", ".", "?", "!"]
   */
  readonly delimiters?: readonly string[];
  /**
   * Additional characters from previous chunks sent to output filtering for context.
   * Valid range: 0-10000.
   */
  readonly outputFilteringOverlap?: number;
}

/** Reference to a template in SAP AI Core's Prompt Registry. */
export type PromptTemplateRef = PromptTemplateRefByID | PromptTemplateRefByScenarioNameVersion;

/** Reference to a Prompt Registry template by ID. */
export interface PromptTemplateRefByID {
  readonly id: string;
  readonly scope?: PromptTemplateScope;
}

/** Reference to a Prompt Registry template by scenario, name, and version. */
export interface PromptTemplateRefByScenarioNameVersion {
  readonly name: string;
  readonly scenario: string;
  readonly scope?: PromptTemplateScope;
  readonly version: string;
}

/** Scope for Prompt Registry templates: 'tenant' (default) or 'resource_group'. */
export type PromptTemplateScope = "resource_group" | "tenant";

/** Response format for structured output (OpenAI-compatible). */
export type ResponseFormat = AzureOpenAiChatCompletionParameters["response_format"];

/** Default settings configuration when using the Responses API. */
export interface ResponsesDefaultSettings {
  readonly api: "responses";
  readonly settings?: ResponsesModelSettings;
}

/** Model-specific Responses API options, validated by the OpenAI provider. */
export type ResponsesModelOptions = Omit<OpenAIResponsesProviderOptions, "metadata"> & {
  readonly metadata?: null | Record<string, string>;
};

/** Model settings for the OpenAI Responses API through SAP AI Core. */
export interface ResponsesModelSettings {
  readonly api: "responses";
  readonly modelParams?: CommonModelParams;
  readonly modelVersion?: string;
  readonly responseFormat?: ResponseFormat;
  readonly responses?: ResponsesModelOptions;
}

/**
 * Supported API types for SAP AI Core.
 *
 * - `'orchestration'` - Full-featured API with data masking, content filtering, document grounding, and translation.
 * - `'foundation-models'` - Direct model access with Azure OpenAI-specific parameters like `logprobs`, `seed`, and `dataSources`.
 * - `'responses'` - OpenAI Responses API with native reasoning and tool-call history.
 */
export type SAPAIApiType = "foundation-models" | "orchestration" | "responses";

/** Union type for API-specific default settings configuration. */
export type SAPAIDefaultSettingsConfig =
  FoundationModelsDefaultSettings | OrchestrationDefaultSettings | ResponsesDefaultSettings;

/** Settings for the SAP AI Embedding Model. */
export interface SAPAIEmbeddingSettings {
  readonly api?: SAPAIApiType;
  /** Orchestration API only. */
  readonly masking?: MaskingModule | { providers: MaskingModule["masking_providers"] };
  /**
   * Maximum batch size: a positive integer, or `Infinity` for no provider-side limit.
   * @default 2048
   */
  readonly maxEmbeddingsPerCall?: number;
  readonly modelParams?: FoundationModelsEmbeddingParams | Record<string, unknown>;
  readonly modelVersion?: string;
  readonly [key: string]: unknown;
  /**
   * Orchestration embedding input type; ignored by Foundation Models.
   * @default 'text'
   */
  readonly type?: "document" | "query" | "text";
}

/**
 * Supported model IDs in SAP AI Core.
 *
 * Model availability depends on tenant configuration and region.
 * Common values include: `'gpt-4.1'`, `'gpt-4.1-mini'`, `'anthropic--claude-4.5-sonnet'`, `'gemini-2.5-pro'`.
 * @see {@link https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/models-and-scenarios-in-generative-ai-hub | SAP AI Core Models}
 */
export type SAPAIModelId = ChatModel;

/**
 * Union type for API-specific model settings.
 *
 * Use `FoundationModelsModelSettings` for Foundation Models API features (dataSources, logprobs, seed).
 * Use `OrchestrationModelSettings` for Orchestration API features (filtering, grounding, masking, translation).
 * Use `ResponsesModelSettings` for native OpenAI Responses options and reasoning history.
 */
export type SAPAIModelSettings =
  FoundationModelsModelSettings | OrchestrationModelSettings | ResponsesModelSettings;

/** Re-exported SAP AI SDK orchestration types. */
export type {
  FilteringModule,
  GroundingModule,
  MaskingModule,
  TranslationModule,
} from "@sap-ai-sdk/orchestration";

export {
  buildAzureContentSafetyFilter,
  buildDocumentGroundingConfig,
  buildDpiMaskingProvider,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Preserve the upstream deprecated public API.
  buildLlamaGuard38BFilter,
  buildTranslationConfig,
} from "@sap-ai-sdk/orchestration";

/**
 * Settings for configuring SAP AI Core model behavior.
 * Legacy interface maintained for backward compatibility. Prefer the API-specific
 * OrchestrationModelSettings, FoundationModelsModelSettings, or ResponsesModelSettings types.
 */
export interface SAPAISettings {
  readonly api?: SAPAIApiType;
  /** Orchestration API only; controls unsupported parameters on the primary local model. */
  readonly dropUnsupportedParams?: boolean;
  /** @default true */
  readonly escapeTemplatePlaceholders?: boolean;
  /** Orchestration API only. */
  readonly fallbackModuleConfigs?: OrchestrationModuleConfig[];
  /** Orchestration API only. */
  readonly filtering?: FilteringModule;
  /** Orchestration API only. */
  readonly grounding?: GroundingModule;
  /**
   * Forward assistant reasoning from the input history as text; does not enable reasoning output.
   * @default false
   */
  readonly includeReasoning?: boolean;
  /** Orchestration API only. */
  readonly masking?: MaskingModule | { providers: MaskingModule["masking_providers"] };
  readonly modelParams?: CommonModelParams;
  readonly modelVersion?: string;
  /** Orchestration API only. */
  readonly orchestrationConfigRef?: OrchestrationConfigRefById | OrchestrationConfigRefByName;
  /** Orchestration API only. */
  readonly placeholderValues?: Record<string, string>;
  /** Orchestration API only. */
  readonly promptTemplateRef?: PromptTemplateRef;
  readonly responseFormat?: ResponseFormat;
  /** Responses API only. */
  readonly responses?: ResponsesModelOptions;
  /** Orchestration API only; ignored when `orchestrationConfigRef` is used. */
  readonly streamOptions?: OrchestrationStreamOptions;
  /** Orchestration API only. */
  readonly tools?: ChatCompletionTool[];
  /** Orchestration API only. */
  readonly translation?: TranslationModule;
}

export type {
  AssistantChatMessage,
  ChatCompletionRequest,
  ChatCompletionTool,
  ChatMessage,
  ChatMessageContent,
  ChatMessages,
  Citation,
  DeveloperChatMessage,
  DocumentTranslationApplyToSelector,
  FileContent,
  FunctionObject,
  ImageContentUrl,
  LlmModelDetails,
  LlmModelParams,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Preserve the upstream deprecated public API.
  OrchestrationConfigRef,
  OrchestrationConfigRefById,
  OrchestrationConfigRefByName,
  OrchestrationConfigRefOverride,
  OrchestrationError,
  OrchestrationModuleConfig,
  OrchestrationModuleConfigList,
  PromptTemplatingModule,
  SystemChatMessage,
  ToolChatMessage,
  TranslationApplyToCategory,
  TranslationInputParameters,
  TranslationOutputParameters,
  TranslationTargetLanguage,
  UserChatMessage,
  UserChatMessageContent,
  UserChatMessageContentItem,
} from "@sap-ai-sdk/orchestration";

export {
  OrchestrationEmbeddingResponse,
  OrchestrationResponse,
  OrchestrationStream,
  OrchestrationStreamChunkResponse,
  OrchestrationStreamResponse,
} from "@sap-ai-sdk/orchestration";
