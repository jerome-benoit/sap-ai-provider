import type {
  ChatCompletionTool,
  ChatModel,
  FilteringModule,
  GroundingModule,
  MaskingModule,
  TranslationModule,
} from "@sap-ai-sdk/orchestration";

/**
 * Supported model IDs in SAP AI Core.
 * Actual availability depends on your SAP AI Core tenant configuration.
 */
export type SAPAIModelId = ChatModel;

/**
 * Settings for configuring SAP AI Core model behavior.
 * Controls model parameters, data masking, content filtering, and tool usage.
 */
export interface SAPAISettings {
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
  readonly modelParams?: {
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
  };

  /** Specific version of the model to use (defaults to latest). */
  readonly modelVersion?: string;

  /** Response format for structured output (OpenAI-compatible). */
  readonly responseFormat?:
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

  /** Tool definitions in SAP AI SDK format. */
  readonly tools?: ChatCompletionTool[];

  /** Translation module configuration for input/output translation. */
  readonly translation?: TranslationModule;
}

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
