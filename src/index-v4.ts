/**
 * `@jerome-benoit/sap-ai-provider` AI SDK 7 (spec V4) entrypoint.
 *
 * Exposes the V4 facades (`LanguageModelV4` / `EmbeddingModelV4` /
 * `ProviderV4`) over the internal V3 core. Import via the `v4` subpath:
 * @example
 * ```typescript
 * import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v4";
 * ```
 */

/**
 * Utility functions for escaping template delimiters (`{{`, `{%`, `{#`) in orchestration content.
 */
export {
  escapeOrchestrationPlaceholders,
  unescapeOrchestrationPlaceholders,
} from "./convert-to-sap-messages.js";

/**
 * V4 entry/exit adapters (prompt normalization and result conversion).
 */
export {
  convertFinishReasonToV4,
  convertGenerateResultToV4,
  convertStreamPartToV4,
  convertUsageToV4,
  convertWarningsToV4,
  createV4StreamFromInternal,
} from "./sap-ai-adapters-v3-to-v4.js";

export { normalizeV4PromptToV3 } from "./sap-ai-adapters-v4-to-v3.js";

/**
 * Embedding model class implementing EmbeddingModelV4 for SAP AI Core.
 * V4 facade over internal implementation.
 */
export { SAPAIEmbeddingModelV4 as SAPAIEmbeddingModel } from "./sap-ai-embedding-model-v4.js";

export type { SAPAIEmbeddingModelId } from "./sap-ai-embedding-model.js";

/**
 * Custom error classes for Foundation Models API support.
 * - `UnsupportedFeatureError`: Thrown when a feature is used with an incompatible API.
 * - `ApiSwitchError`: Thrown when attempting to switch APIs at invocation time with conflicting settings.
 */
export { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error.js";

/**
 * Language model class implementing LanguageModelV4 for SAP AI Core.
 * V4 facade over internal implementation.
 */
export { SAPAILanguageModelV4 as SAPAILanguageModel } from "./sap-ai-language-model-v4.js";

/**
 * Provider options for per-call configuration.
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
 * Provider factory function implementing ProviderV4 interface.
 * Creates language and embedding model instances for SAP AI Core.
 */
export {
  createSAPAIProviderV4 as createSAPAIProvider,
  sapaiV4 as sapai,
} from "./sap-ai-provider-v4.js";
export type {
  SAPAIProviderV4 as SAPAIProvider,
  SAPAIProviderSettings,
} from "./sap-ai-provider-v4.js";

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
