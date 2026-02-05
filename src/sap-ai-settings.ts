import type { AzureOpenAiChatCompletionParameters } from "@sap-ai-sdk/foundation-models";
import type {
  ChatCompletionTool,
  ChatModel,
  FilteringModule,
  GroundingModule,
  MaskingModule,
  OrchestrationConfigRef,
  TranslationModule,
} from "@sap-ai-sdk/orchestration";

/** Azure OpenAI chat extension configuration for "On Your Data" RAG scenarios. */
export type AzureOpenAiChatExtensionConfiguration = NonNullable<
  AzureOpenAiChatCompletionParameters["data_sources"]
>[number];

/**
 * Common model parameters shared between both APIs.
 *
 * These parameters control text generation behavior and are validated by Zod schemas
 * when passed via `providerOptions`.
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
   * Not supported by Amazon/Anthropic models.
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
  /** @default false */
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
  /** @default true */
  readonly escapeTemplatePlaceholders?: boolean;
  readonly filtering?: FilteringModule;
  readonly grounding?: GroundingModule;
  /** @default false */
  readonly includeReasoning?: boolean;
  readonly masking?: MaskingModule;
  readonly modelParams?: OrchestrationModelParams;
  readonly modelVersion?: string;
  /**
   * Reference to a complete orchestration configuration stored in SAP AI Core Prompt Registry.
   * When provided, local module settings (filtering, masking, grounding, translation, tools,
   * promptTemplateRef, responseFormat) are ignored as the full configuration is managed
   * by the referenced config. Only `placeholderValues` and messages are passed through.
   * @example { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" }
   * @example { scenario: "customer-support", name: "prod-config", version: "1.0.0" }
   */
  readonly orchestrationConfigRef?: OrchestrationConfigRef;
  readonly placeholderValues?: Record<string, string>;
  readonly promptTemplateRef?: PromptTemplateRef;
  readonly responseFormat?: ResponseFormat;
  readonly tools?: ChatCompletionTool[];
  readonly translation?: TranslationModule;
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

/**
 * Supported API types for SAP AI Core.
 *
 * - `'orchestration'` - Full-featured API with data masking, content filtering, document grounding, and translation.
 * - `'foundation-models'` - Direct model access with Azure OpenAI-specific parameters like `logprobs`, `seed`, and `dataSources`.
 */
export type SAPAIApiType = "foundation-models" | "orchestration";

/** Union type for API-specific default settings configuration. */
export type SAPAIDefaultSettingsConfig =
  | FoundationModelsDefaultSettings
  | OrchestrationDefaultSettings;

/** Settings for the SAP AI Embedding Model. */
export interface SAPAIEmbeddingSettings {
  readonly api?: SAPAIApiType;
  /** Orchestration API only. */
  readonly masking?: MaskingModule;
  /** @default 2048 */
  readonly maxEmbeddingsPerCall?: number;
  readonly modelParams?: FoundationModelsEmbeddingParams | Record<string, unknown>;
  readonly modelVersion?: string;
  readonly [key: string]: unknown;
  /** @default 'text' */
  readonly type?: "document" | "query" | "text";
}

/**
 * Supported model IDs in SAP AI Core.
 *
 * Model availability depends on tenant configuration and region.
 * Common values include: `'gpt-4o'`, `'gpt-4o-mini'`, `'anthropic--claude-3.5-sonnet'`, `'gemini-1.5-pro'`.
 * @see {@link https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/models-and-scenarios-in-generative-ai-hub|SAP AI Core Models}
 */
export type SAPAIModelId = ChatModel;

/**
 * Union type for model settings - supports both APIs.
 *
 * Use `FoundationModelsModelSettings` for Foundation Models API features (dataSources, logprobs, seed).
 * Use `OrchestrationModelSettings` for Orchestration API features (filtering, grounding, masking, translation).
 */
export type SAPAIModelSettings = FoundationModelsModelSettings | OrchestrationModelSettings;

/** Re-exported Azure OpenAI types from `@sap-ai-sdk/foundation-models`. */
export type {
  AzureOpenAiChatCompletionParameters,
  AzureOpenAiChatCompletionRequestAssistantMessage,
  AzureOpenAiChatCompletionRequestMessage,
  AzureOpenAiChatCompletionRequestSystemMessage,
  AzureOpenAiChatCompletionRequestToolMessage,
  AzureOpenAiChatCompletionRequestUserMessage,
  AzureOpenAiChatCompletionTool,
  AzureOpenAiEmbeddingParameters,
  AzureOpenAiFunctionObject,
} from "@sap-ai-sdk/foundation-models";

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
  buildLlamaGuard38BFilter,
  buildTranslationConfig,
} from "@sap-ai-sdk/orchestration";

/**
 * Settings for configuring SAP AI Core model behavior.
 * Legacy interface maintained for backward compatibility - prefer OrchestrationModelSettings
 * or FoundationModelsModelSettings for API-specific type safety.
 */
export interface SAPAISettings {
  readonly api?: SAPAIApiType;
  /** @default true */
  readonly escapeTemplatePlaceholders?: boolean;
  readonly filtering?: FilteringModule;
  readonly grounding?: GroundingModule;
  /** @default false */
  readonly includeReasoning?: boolean;
  readonly masking?: MaskingModule;
  readonly modelParams?: CommonModelParams;
  readonly modelVersion?: string;
  /** Orchestration API only. */
  readonly promptTemplateRef?: PromptTemplateRef;
  readonly responseFormat?: ResponseFormat;
  readonly tools?: ChatCompletionTool[];
  readonly translation?: TranslationModule;
}

export type {
  AssistantChatMessage,
  ChatCompletionRequest,
  ChatCompletionTool,
  ChatMessage,
  DeveloperChatMessage,
  DocumentTranslationApplyToSelector,
  FunctionObject,
  LlmModelDetails,
  LlmModelParams,
  OrchestrationConfigRef,
  OrchestrationModuleConfig,
  PromptTemplatingModule,
  SystemChatMessage,
  ToolChatMessage,
  TranslationApplyToCategory,
  TranslationInputParameters,
  TranslationOutputParameters,
  TranslationTargetLanguage,
  UserChatMessage,
} from "@sap-ai-sdk/orchestration";

export {
  OrchestrationEmbeddingResponse,
  OrchestrationResponse,
  OrchestrationStream,
  OrchestrationStreamChunkResponse,
  OrchestrationStreamResponse,
} from "@sap-ai-sdk/orchestration";
