import type { AzureOpenAiChatCompletionParameters } from "@sap-ai-sdk/foundation-models";
import type {
  ChatCompletionTool,
  ChatModel,
  FilteringModule,
  GroundingModule,
  MaskingModule,
  TranslationModule,
} from "@sap-ai-sdk/orchestration";

/**
 * Azure OpenAI chat extension configuration for "On Your Data" scenarios.
 * Extracted directly from the SDK's AzureOpenAiChatCompletionParameters type.
 *
 * Supports Azure AI Search, Azure Cosmos DB, and other data sources for RAG scenarios.
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/use-your-data
 */
export type AzureOpenAiChatExtensionConfiguration = NonNullable<
  AzureOpenAiChatCompletionParameters["data_sources"]
>[number];

/**
 * Common model parameters shared between both APIs.
 * These parameters are supported by both Orchestration and Foundation Models APIs.
 * Includes index signature for compatibility with deep merge utilities.
 */
export interface CommonModelParams {
  /** Frequency penalty between -2.0 and 2.0. */
  readonly frequencyPenalty?: number;
  /** Maximum number of tokens to generate. */
  readonly maxTokens?: number;
  /** Number of completions to generate (not supported by Amazon/Anthropic). */
  readonly n?: number;
  /** Whether to enable parallel tool calls. */
  readonly parallel_tool_calls?: boolean;
  /** Presence penalty between -2.0 and 2.0. */
  readonly presencePenalty?: number;
  /** Index signature for compatibility with Record<string, unknown>. */
  readonly [key: string]: unknown;
  /** Sampling temperature between 0 and 2. */
  readonly temperature?: number;
  /** Nucleus sampling parameter between 0 and 1. */
  readonly topP?: number;
}

/**
 * Default settings configuration when using Foundation Models API.
 * Used for type-safe provider defaultSettings with Foundation Models API.
 */
export interface FoundationModelsDefaultSettings {
  /** API type - required discriminant for Foundation Models. */
  readonly api: "foundation-models";
  /** Default model settings for Foundation Models API. */
  readonly settings?: FoundationModelsModelSettings;
}

/**
 * Model parameters for Foundation Models Embedding API.
 * These parameters are specific to embedding operations.
 */
export interface FoundationModelsEmbeddingParams {
  /** The number of dimensions the resulting output embeddings should have. */
  readonly dimensions?: number;
  /** The format to return the embeddings in. */
  readonly encoding_format?: "base64" | "float";
  /** A unique identifier representing your end-user for abuse monitoring. */
  readonly user?: string;
}

/**
 * Model parameters for Foundation Models API.
 * Includes additional Azure OpenAI-specific parameters not available in Orchestration.
 *
 * These parameters map directly to AzureOpenAiChatCompletionParameters from the SDK.
 */
export interface FoundationModelsModelParams extends CommonModelParams {
  /** Modifies likelihood of specified tokens appearing in completion. Maps to SDK's logit_bias. */
  readonly logit_bias?: AzureOpenAiChatCompletionParameters["logit_bias"];
  /** Whether to return log probabilities of output tokens. Maps to SDK's logprobs. */
  readonly logprobs?: AzureOpenAiChatCompletionParameters["logprobs"];
  /** Random seed for deterministic sampling. Maps to SDK's seed. */
  readonly seed?: AzureOpenAiChatCompletionParameters["seed"];
  /** Stop sequences where the API will stop generating further tokens. Maps to SDK's stop. */
  readonly stop?: AzureOpenAiChatCompletionParameters["stop"];
  /** Number of most likely tokens to return at each position (requires logprobs=true). Maps to SDK's top_logprobs. */
  readonly top_logprobs?: AzureOpenAiChatCompletionParameters["top_logprobs"];
  /** A unique identifier representing your end-user for abuse monitoring. Maps to SDK's user. */
  readonly user?: AzureOpenAiChatCompletionParameters["user"];
}

/**
 * Model settings when using Foundation Models API.
 * Includes Foundation Models-only features: dataSources.
 */
export interface FoundationModelsModelSettings {
  /** API type - required discriminant for Foundation Models. */
  readonly api: "foundation-models";

  /**
   * Azure OpenAI "On Your Data" configuration for chat extensions.
   * Enables RAG scenarios with Azure AI Search, Cosmos DB, etc.
   *
   * Type extracted from SDK's AzureOpenAiChatCompletionParameters["data_sources"].
   */
  readonly dataSources?: AzureOpenAiChatExtensionConfiguration[];

  /**
   * Whether to include assistant reasoning parts in the response.
   * @default false
   */
  readonly includeReasoning?: boolean;

  /** Model generation parameters that control the output. */
  readonly modelParams?: FoundationModelsModelParams;

  /** Specific version of the model to use (defaults to latest). */
  readonly modelVersion?: string;

  /** Response format for structured output (OpenAI-compatible). */
  readonly responseFormat?: ResponseFormat;
}

/**
 * Default settings configuration when using Orchestration API.
 * Used for type-safe provider defaultSettings with Orchestration API.
 */
export interface OrchestrationDefaultSettings {
  /** API type - optional, defaults to 'orchestration'. */
  readonly api?: "orchestration";
  /** Default model settings for Orchestration API. */
  readonly settings?: OrchestrationModelSettings;
}

/**
 * Model parameters for Orchestration API.
 * Currently same as CommonModelParams - no additional params exposed by SAP SDK.
 */
export type OrchestrationModelParams = CommonModelParams;

/**
 * Model settings when using Orchestration API.
 * Includes all orchestration-only features: filtering, grounding, masking, translation.
 */
export interface OrchestrationModelSettings {
  /** API type - optional, defaults to 'orchestration'. */
  readonly api?: "orchestration";

  /**
   * Escape template delimiters (`{{`, `{%`, `{#`) to prevent SAP orchestration template conflicts.
   * @default true
   */
  readonly escapeTemplatePlaceholders?: boolean;

  /** Filtering configuration for input and output content safety. */
  readonly filtering?: FilteringModule;

  /** Grounding module configuration for document-based retrieval (RAG). */
  readonly grounding?: GroundingModule;

  /**
   * Whether to include assistant reasoning parts in the response.
   * @default false
   */
  readonly includeReasoning?: boolean;

  /** Masking configuration for data anonymization/pseudonymization via SAP DPI. */
  readonly masking?: MaskingModule;

  /** Model generation parameters that control the output. */
  readonly modelParams?: OrchestrationModelParams;

  /** Specific version of the model to use (defaults to latest). */
  readonly modelVersion?: string;

  /** Response format for structured output (OpenAI-compatible). */
  readonly responseFormat?: ResponseFormat;

  /** Tool definitions in SAP AI SDK format. */
  readonly tools?: ChatCompletionTool[];

  /** Translation module configuration for input/output translation. */
  readonly translation?: TranslationModule;
}

/**
 * Response format for structured output (OpenAI-compatible).
 * Extracted directly from the SDK's AzureOpenAiChatCompletionParameters type.
 *
 * Supports:
 * - `{ type: "text" }` - Default text response
 * - `{ type: "json_object" }` - JSON mode
 * - `{ type: "json_schema", json_schema: {...} }` - Structured outputs with schema validation
 */
export type ResponseFormat = AzureOpenAiChatCompletionParameters["response_format"];

/**
 * Supported API types for SAP AI Core.
 * - `'orchestration'`: Uses SAP AI Core Orchestration API (default) - supports filtering, grounding, masking, translation
 * - `'foundation-models'`: Uses SAP AI Core Foundation Models API - supports dataSources, logprobs, seed, etc.
 */
export type SAPAIApiType = "foundation-models" | "orchestration";

/**
 * Union type for API-specific default settings configuration.
 */
export type SAPAIDefaultSettingsConfig =
  | FoundationModelsDefaultSettings
  | OrchestrationDefaultSettings;

/**
 * Settings for the SAP AI Embedding Model.
 */
export interface SAPAIEmbeddingSettings {
  /**
   * SAP AI Core API to use for this model.
   * Overrides provider-level API setting. Can be further overridden per-call via providerOptions.
   * - `'orchestration'` (default): SAP AI Core Orchestration API
   * - `'foundation-models'`: SAP AI Core Foundation Models API
   */
  readonly api?: SAPAIApiType;

  /**
   * Maximum number of embeddings per API call.
   * @default 2048
   */
  readonly maxEmbeddingsPerCall?: number;

  /**
   * Additional model parameters passed to the embedding API.
   * For Orchestration API, this is EmbeddingModelParams from `@sap-ai-sdk/orchestration`.
   * For Foundation Models API, this is FoundationModelsEmbeddingParams.
   */
  readonly modelParams?: FoundationModelsEmbeddingParams | Record<string, unknown>;

  /** Index signature for compatibility with Record<string, unknown>. */
  readonly [key: string]: unknown;

  /**
   * Embedding task type.
   * @default 'text'
   */
  readonly type?: "document" | "query" | "text";
}

/**
 * Supported model IDs in SAP AI Core.
 * Actual availability depends on your SAP AI Core tenant configuration.
 */
export type SAPAIModelId = ChatModel;

/**
 * Union type for model settings - supports both APIs.
 */
export type SAPAIModelSettings = FoundationModelsModelSettings | OrchestrationModelSettings;

/**
 * Re-export Azure OpenAI types from `@sap-ai-sdk/foundation-models` for convenience.
 * These are the actual SDK types exported from the main package entry.
 */
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

/** SAP AI SDK types re-exported for convenience and direct usage. */
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
 * Controls model parameters, data masking, content filtering, and tool usage.
 *
 * This is the legacy settings interface maintained for backward compatibility.
 * For new code, prefer using OrchestrationModelSettings or FoundationModelsModelSettings
 * which provide API-specific type safety.
 */
export interface SAPAISettings {
  /**
   * SAP AI Core API to use for this model.
   * Overrides provider-level API setting. Can be further overridden per-call via providerOptions.
   * - `'orchestration'` (default): SAP AI Core Orchestration API
   * - `'foundation-models'`: SAP AI Core Foundation Models API
   */
  readonly api?: SAPAIApiType;

  /**
   * Escape template delimiters (`\{\{`, `\{%`, `\{#`) to prevent SAP orchestration template conflicts.
   * @default true
   */
  readonly escapeTemplatePlaceholders?: boolean;

  /** Filtering configuration for input and output content safety. */
  readonly filtering?: FilteringModule;

  /** Grounding module configuration for document-based retrieval (RAG). */
  readonly grounding?: GroundingModule;

  /**
   * Whether to include assistant reasoning parts in the response.
   * @default false
   */
  readonly includeReasoning?: boolean;

  /** Masking configuration for data anonymization/pseudonymization via SAP DPI. */
  readonly masking?: MaskingModule;

  /** Model generation parameters that control the output. */
  readonly modelParams?: CommonModelParams;

  /** Specific version of the model to use (defaults to latest). */
  readonly modelVersion?: string;

  /** Response format for structured output (OpenAI-compatible). */
  readonly responseFormat?: ResponseFormat;

  /** Tool definitions in SAP AI SDK format. */
  readonly tools?: ChatCompletionTool[];

  /** Translation module configuration for input/output translation. */
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
