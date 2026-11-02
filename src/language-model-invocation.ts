/** Shared API selection and validation before specification-specific prompt conversion. */
import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { SAPAIApiType, SAPAIModelId, SAPAISettings } from "./sap-ai-settings.js";

import { getProviderName, sapAILanguageModelProviderOptions } from "./sap-ai-provider-options.js";
import { getOrCreateLanguageModelStrategy } from "./sap-ai-strategy.js";
import { resolveApi, validateSettings } from "./sap-ai-validation.js";

/**
 * Immutable model configuration shared by the V3 and V4 entrypoints.
 * @internal
 */
export interface LanguageModelInvocationConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
  readonly providerApi?: SAPAIApiType;
  readonly requestConfig?: CustomRequestConfig;
}

/**
 * Resolves and validates the API once for each invocation before prompt conversion.
 * @param modelId - Model identifier.
 * @param settings - Model defaults.
 * @param config - Immutable provider configuration.
 * @param providerOptions - Invocation provider options.
 * @returns The cached strategy descriptor and invocation configuration.
 * @internal
 */
export async function prepareLanguageModelInvocation(
  modelId: SAPAIModelId,
  settings: SAPAISettings,
  config: LanguageModelInvocationConfig,
  providerOptions: SharedV4ProviderOptions | undefined,
) {
  const providerName = getProviderName(config.provider);
  const sapOptions = await parseProviderOptions({
    provider: providerName,
    providerOptions,
    schema: sapAILanguageModelProviderOptions,
  });
  const effectiveApi = resolveApi(config.providerApi, settings.api, sapOptions?.api);
  validateSettings({
    api: effectiveApi,
    invocationSettings: sapOptions
      ? {
          api: sapOptions.api,
          dropUnsupportedParams: sapOptions.dropUnsupportedParams,
          escapeTemplatePlaceholders: sapOptions.escapeTemplatePlaceholders,
          orchestrationConfigRef: sapOptions.orchestrationConfigRef,
          placeholderValues: sapOptions.placeholderValues,
          promptTemplateRef: sapOptions.promptTemplateRef,
          responses: sapOptions.responses,
        }
      : undefined,
    modelApi: settings.api,
    modelSettings: settings,
  });
  const selected = await getOrCreateLanguageModelStrategy(effectiveApi);
  return {
    selected,
    strategyConfig: {
      deploymentConfig: config.deploymentConfig,
      destination: config.destination,
      modelId,
      parsedProviderOptions: sapOptions,
      provider: config.provider,
      requestConfig: config.requestConfig,
    },
  };
}
