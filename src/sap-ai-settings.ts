import type {
  ChatCompletionTool,
  ChatModel,
  FilteringModule,
  GroundingModule,
  MaskingModule,
  TranslationModule,
} from "@sap-ai-sdk/orchestration";

// ============================================================================
// API Types
// ============================================================================

/**
 * Supported API types for SAP AI Core.
 * - `'orchestration'`: Uses SAP AI Core Orchestration API (default) - supports filtering, grounding, masking, translation
 * - `'foundation-models'`: Uses SAP AI Core Foundation Models API - supports dataSources, logprobs, seed, etc.
 */
export type SAPAIApiType = "orchestration" | "foundation-models";

/**
 * Supported model IDs in SAP AI Core.
 * Actual availability depends on your SAP AI Core tenant configuration.
 */
export type SAPAIModelId = ChatModel;

// ============================================================================
// Model Parameters (API-specific)
// ============================================================================

/**
 * Common model parameters shared between both APIs.
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
  /** Sampling temperature between 0 and 2. */
  readonly temperature?: number;
  /** Nucleus sampling parameter between 0 and 1. */
  readonly topP?: number;
  /** Index signature for compatibility with Record<string, unknown>. */
  readonly [key: string]: unknown;
}

/**
 * Model parameters for Orchestration API.
 * Currently same as CommonModelParams - no additional params exposed.
 */
export interface OrchestrationModelParams extends CommonModelParams {
  // No additional params currently exposed for Orchestration
}

/**
 * Model parameters for Foundation Models API.
 * Includes additional Azure OpenAI-specific parameters.
 */
export interface FoundationModelsModelParams extends CommonModelParams {
  /** Modifies likelihood of specified tokens appearing in completion. */
  readonly logit_bias?: Record<string, number>;
  /** Whether to return log probabilities of output tokens. */
  readonly logprobs?: boolean;
  /** Random seed for deterministic sampling. */
  readonly seed?: number;
  /** Stop sequences where the API will stop generating further tokens. */
  readonly stop?: string | string[];
  /** Number of most likely tokens to return at each position (requires logprobs=true). */
  readonly top_logprobs?: number;
  /** A unique identifier representing your end-user for abuse monitoring. */
  readonly user?: string;
}

/**
 * Model parameters for Foundation Models Embedding API.
 */
export interface FoundationModelsEmbeddingParams {
  /** The number of dimensions the resulting output embeddings should have. */
  readonly dimensions?: number;
  /** The format to return the embeddings in. */
  readonly encoding_format?: "float" | "base64";
  /** A unique identifier representing your end-user for abuse monitoring. */
  readonly user?: string;
}

// ============================================================================
// Response Format (shared)
// ============================================================================

/**
 * Response format for structured output (OpenAI-compatible).
 */
export type ResponseFormat =
  | {
      readonly json_schema: {
        readonly description?: string;
        readonly name: string;
        readonly schema?: unknown;
        readonly strict?: boolean | null;
      };
      readonly type: "json_schema";
    }
  | { readonly type: "json_object" }
  | { readonly type: "text" };

// ============================================================================
// Foundation Models Data Sources (Azure On Your Data)
// ============================================================================

/**
 * Azure OpenAI chat extension configuration for "On Your Data" feature.
 * Placeholder type - will be replaced with actual SDK type when @sap-ai-sdk/foundation-models is installed.
 *
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/use-your-data
 */
export interface AzureOpenAiAzureChatExtensionConfiguration {
  /** The type of extension (e.g., "azure_search", "azure_cosmos_db"). */
  readonly type: "azure_search" | "azure_cosmos_db" | string;
  /** Extension-specific parameters. */
  readonly parameters?: Record<string, unknown>;
}

// ============================================================================
// Discriminated Union Types - API-specific Default Settings
// ============================================================================

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
 * Union type for API-specific default settings configuration.
 */
export type SAPAIDefaultSettingsConfig =
  | OrchestrationDefaultSettings
  | FoundationModelsDefaultSettings;

// ============================================================================
// Discriminated Union Types - Model Settings
// ============================================================================

/**
 * Model settings when using Orchestration API.
 * Includes all orchestration-only features: filtering, grounding, masking, translation.
 */
export interface OrchestrationModelSettings {
  /** API type - optional, defaults to 'orchestration'. */
  readonly api?: "orchestration";

  // === Orchestration-Only Options ===

  /**
   * Escape template delimiters (`{{`, `{%`, `{#`) to prevent SAP orchestration template conflicts.
   * @default true
   */
  readonly escapeTemplatePlaceholders?: boolean;

  /** Filtering configuration for input and output content safety. */
  readonly filtering?: FilteringModule;

  /** Grounding module configuration for document-based retrieval (RAG). */
  readonly grounding?: GroundingModule;

  /** Masking configuration for data anonymization/pseudonymization via SAP DPI. */
  readonly masking?: MaskingModule;

  /** Tool definitions in SAP AI SDK format. */
  readonly tools?: ChatCompletionTool[];

  /** Translation module configuration for input/output translation. */
  readonly translation?: TranslationModule;

  // === Common Options ===

  /**
   * Whether to include assistant reasoning parts in the response.
   * @default false
   */
  readonly includeReasoning?: boolean;

  /** Model generation parameters that control the output. */
  readonly modelParams?: OrchestrationModelParams;

  /** Specific version of the model to use (defaults to latest). */
  readonly modelVersion?: string;

  /** Response format for structured output (OpenAI-compatible). */
  readonly responseFormat?: ResponseFormat;
}

/**
 * Model settings when using Foundation Models API.
 * Includes Foundation Models-only features: dataSources.
 */
export interface FoundationModelsModelSettings {
  /** API type - required discriminant for Foundation Models. */
  readonly api: "foundation-models";

  // === Foundation Models-Only Options ===

  /**
   * Azure OpenAI "On Your Data" configuration for chat extensions.
   * Enables RAG scenarios with Azure AI Search, Cosmos DB, etc.
   */
  readonly dataSources?: AzureOpenAiAzureChatExtensionConfiguration[];

  // === Common Options ===

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
 * Union type for model settings - supports both APIs.
 */
export type SAPAIModelSettings = OrchestrationModelSettings | FoundationModelsModelSettings;

// ============================================================================
// Legacy Settings Interface (Backward Compatibility)
// ============================================================================

/**
 * Settings for configuring SAP AI Core model behavior.
 * Controls model parameters, data masking, content filtering, and tool usage.
 *
 * @remarks
 * This is the legacy settings interface maintained for backward compatibility.
 * For new code, prefer using {@link OrchestrationModelSettings} or {@link FoundationModelsModelSettings}
 * which provide API-specific type safety.
 */
export interface SAPAISettings {
  /**
   * Escape template delimiters (`{​{`, `{​%`, `{​#`) to prevent SAP orchestration template conflicts.
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

// ============================================================================
// Re-exports from SAP AI SDK
// ============================================================================

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
