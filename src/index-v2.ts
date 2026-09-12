/**
 * `@jerome-benoit/sap-ai-provider/v2` AI SDK 5 (spec V2) entrypoint.
 *
 * Exposes the V2 facades (`LanguageModelV2` / `EmbeddingModelV2` /
 * `ProviderV2`) over the shared V3 core. Also available from the standalone
 * `@jerome-benoit/sap-ai-provider-v2` package. AI SDK 6 can consume these V2
 * interfaces through its compatibility layer; use `v4` with AI SDK 7.
 * @see {@link https://sdk.vercel.ai/} Vercel AI SDK documentation
 */

/**
 * Utility functions for escaping template delimiters (`{{`, `{%`, `{#`) in orchestration content.
 */
export {
  escapeOrchestrationPlaceholders,
  unescapeOrchestrationPlaceholders,
} from "./convert-to-sap-messages.js";

/**
 * Embedding model class implementing EmbeddingModelV2 for SAP AI Core.
 * V2 facade over internal implementation.
 */
export { SAPAIEmbeddingModelV2 as SAPAIEmbeddingModel } from "./sap-ai-embedding-model-v2.js";

export type { SAPAIEmbeddingModelId } from "./sap-ai-embedding-model.js";

/**
 * Custom error classes for Foundation Models API support.
 * - `UnsupportedFeatureError`: Thrown when a feature is used with an incompatible API.
 * - `ApiSwitchError`: Thrown when attempting to switch APIs at invocation time with conflicting settings.
 */
export { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error.js";

/**
 * Language model class implementing LanguageModelV2 for SAP AI Core.
 * V2 facade over internal implementation.
 */
export { SAPAILanguageModelV2 as SAPAILanguageModel } from "./sap-ai-language-model-v2.js";

/**
 * Provider options for per-call configuration.
 *
 * These schemas and types enable runtime validation of provider options
 * passed via `providerOptions['sap-ai']` in Vercel AI SDK calls.
 */
export {
  getProviderName,
  SAP_AI_PROVIDER_NAME,
  sapAIEmbeddingProviderOptions,
  sapAILanguageModelProviderOptions,
} from "./sap-ai-provider-options.js";

export type {
  SAPAIEmbeddingProviderOptions,
  SAPAILanguageModelProviderOptions,
} from "./sap-ai-provider-options.js";

/**
 * Provider factory function implementing ProviderV2 interface.
 * Creates language and embedding model instances for SAP AI Core.
 */
export { createSAPAIProvider, sapai } from "./sap-ai-provider-v2.js";

export type {
  DeploymentConfig,
  SAPAIProviderV2 as SAPAIProvider,
  SAPAIProviderSettings,
} from "./sap-ai-provider-v2.js";

/**
 * Model settings types and model identifier type definitions.
 */
export type {
  AzureOpenAiChatExtensionConfiguration,
  CommonModelParams,
  FoundationModelsDefaultSettings,
  FoundationModelsEmbeddingParams,
  FoundationModelsModelParams,
  FoundationModelsModelSettings,
  OrchestrationDefaultSettings,
  OrchestrationModelParams,
  OrchestrationModelSettings,
  OrchestrationStreamOptions,
  PromptTemplateRef,
  PromptTemplateRefByID,
  PromptTemplateRefByScenarioNameVersion,
  PromptTemplateScope,
  ResponseFormat,
  SAPAIApiType,
  SAPAIDefaultSettingsConfig,
  SAPAIEmbeddingSettings,
  SAPAIModelId,
  SAPAIModelSettings,
  SAPAISettings,
} from "./sap-ai-settings.js";

/**
 * SAP AI SDK types and utilities.
 *
 * Re-exported for convenience and advanced usage scenarios.
 */
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
  FilteringModule,
  FunctionObject,
  GroundingModule,
  ImageContentUrl,
  LlmModelDetails,
  LlmModelParams,
  MaskingModule,
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
  TranslationModule,
  TranslationOutputParameters,
  TranslationTargetLanguage,
  UserChatMessage,
  UserChatMessageContent,
  UserChatMessageContentItem,
} from "./sap-ai-settings.js";

/**
 * Helper functions for building configurations.
 */
export {
  buildAzureContentSafetyFilter,
  buildDocumentGroundingConfig,
  buildDpiMaskingProvider,
  buildLlamaGuard38BFilter,
  buildTranslationConfig,
} from "./sap-ai-settings.js";

/**
 * Response classes from the SAP AI SDK for orchestration results.
 */
export {
  OrchestrationEmbeddingResponse,
  OrchestrationResponse,
  OrchestrationStream,
  OrchestrationStreamChunkResponse,
  OrchestrationStreamResponse,
} from "./sap-ai-settings.js";

/**
 * Validation utilities for API selection and feature compatibility.
 * - `resolveApi`: Resolves API type from provider/model/invocation precedence chain.
 * - `validateSettings`: Validates settings are compatible with the selected API.
 */
export { resolveApi, validateSettings } from "./sap-ai-validation.js";

/**
 * Package version, injected at build time.
 */
export { VERSION } from "./version.js";

/**
 * SAP AI SDK request configuration type for {@link SAPAIProviderSettings.requestConfig}.
 *
 * Re-exported so consumers do not need a direct dependency on `@sap-ai-sdk/core`.
 * Its shape follows the installed SAP AI SDK version.
 */
export type { CustomRequestConfig } from "@sap-ai-sdk/core";

/**
 * Error handling types and classes for SAP AI Core error responses.
 */
export type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

/**
 * Direct access to SAP AI SDK OrchestrationClient.
 *
 * For advanced users who need to use the SAP AI SDK directly.
 */
export { OrchestrationClient, OrchestrationEmbeddingClient } from "@sap-ai-sdk/orchestration";

/**
 * SAP Cloud SDK destination type for {@link SAPAIProviderSettings.destination}.
 *
 * Re-exported so consumers do not need a direct dependency on
 * `@sap-cloud-sdk/connectivity`. Its shape follows the installed SAP Cloud SDK version.
 */
export type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";
