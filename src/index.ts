/**
 * `@jerome-benoit/sap-ai-provider`
 *
 * Vercel AI SDK provider for SAP AI Core.
 * Wraps the SAP AI SDK to provide Vercel AI SDK-compatible interfaces.
 */

/**
 * Utility functions for escaping template delimiters (`{{`, `{%`, `{#`) in orchestration content.
 */
export {
  escapeOrchestrationPlaceholders,
  unescapeOrchestrationPlaceholders,
} from "./convert-to-sap-messages.js";

/**
 * Embedding model class for generating vector embeddings via SAP AI Core.
 */
export { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";

export type { SAPAIEmbeddingModelId } from "./sap-ai-embedding-model.js";

/**
 * Custom error classes for Foundation Models API support.
 * - `UnsupportedFeatureError`: Thrown when a feature is used with an incompatible API.
 * - `ApiSwitchError`: Thrown when attempting to switch APIs at invocation time with conflicting settings.
 */
export { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error.js";

/**
 * Language model class for chat/text completions via SAP AI Core.
 */
export { SAPAILanguageModel } from "./sap-ai-language-model.js";

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
 * Provider factory function and pre-configured default instance.
 */
export { createSAPAIProvider, sapai } from "./sap-ai-provider.js";

export type { DeploymentConfig, SAPAIProvider, SAPAIProviderSettings } from "./sap-ai-provider.js";

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
  DeveloperChatMessage,
  DocumentTranslationApplyToSelector,
  FilteringModule,
  FunctionObject,
  GroundingModule,
  LlmModelDetails,
  LlmModelParams,
  MaskingModule,
  OrchestrationConfigRef,
  OrchestrationModuleConfig,
  PromptTemplatingModule,
  SystemChatMessage,
  ToolChatMessage,
  TranslationApplyToCategory,
  TranslationInputParameters,
  TranslationModule,
  TranslationOutputParameters,
  TranslationTargetLanguage,
  UserChatMessage,
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
 * Error handling types and classes for SAP AI Core error responses.
 */
export type { OrchestrationErrorResponse } from "@sap-ai-sdk/orchestration";

/**
 * Direct access to SAP AI SDK OrchestrationClient.
 *
 * For advanced users who need to use the SAP AI SDK directly.
 */
export { OrchestrationClient, OrchestrationEmbeddingClient } from "@sap-ai-sdk/orchestration";
