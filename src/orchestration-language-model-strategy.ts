/** Orchestration language model strategy using `@sap-ai-sdk/orchestration`. */
import type { LanguageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";
import type {
  ChatCompletionRequest,
  ChatCompletionTool,
  ChatMessage,
  OrchestrationClient,
  OrchestrationModuleConfig,
  OrchestrationModuleConfigList,
} from "@sap-ai-sdk/orchestration";

import type { ParsePartProviderOptions } from "./sap-ai-provider-options.js";
import type {
  OrchestrationModelSettings,
  PromptTemplateRef,
  PromptTemplateRefByID,
} from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import {
  BaseLanguageModelStrategy,
  type CommonBuildResult,
  type StreamCallResponse,
} from "./base-language-model-strategy.js";
import { deepMerge } from "./deep-merge.js";
import {
  orchestrationConfigRefSchema,
  parseSAPPartProviderOptions,
} from "./sap-ai-provider-options.js";
import { validateMaskingProvidersDeprecation } from "./sap-ai-validation.js";
import {
  convertResponseFormat,
  convertToolsToSAPFormat,
  hasKeys,
  type ParamMapping,
  type SAPResponseFormat,
  type SAPToolChoice,
  type SDKResponse,
  type SDKStreamChunk,
} from "./strategy-utils.js";

/** @internal */
type OrchestrationClientInstance = InstanceType<typeof OrchestrationClient>;

/**
 * Typed resolved state for values computed in buildCommonParts and consumed in buildRequest/createClient.
 * @internal
 */
interface OrchestrationResolvedState {
  readonly configRef: OrchestrationModelSettings["orchestrationConfigRef"];
  readonly promptTemplateRef: PromptTemplateRef | undefined;
  readonly responseFormat: SAPResponseFormat | undefined;
  readonly tools: ChatCompletionTool[] | undefined;
}

/**
 * Builds the template_ref object from a PromptTemplateRef.
 * @param ref - Template reference (by ID or by name/scenario/version).
 * @returns The template_ref object for SDK consumption.
 * @internal
 */
function buildTemplateRefObject(ref: PromptTemplateRef): Record<string, unknown> {
  return isTemplateRefById(ref)
    ? {
        id: ref.id,
        ...(ref.scope && { scope: ref.scope }),
      }
    : {
        name: ref.name,
        scenario: ref.scenario,
        version: ref.version,
        ...(ref.scope && { scope: ref.scope }),
      };
}

/**
 * Type guard for template reference by ID.
 * @param ref - Template reference.
 * @returns True if reference is by ID.
 * @internal
 */
function isTemplateRefById(ref: PromptTemplateRef): ref is PromptTemplateRefByID {
  return "id" in ref;
}

/**
 * Merges and resolves placeholder values from settings and provider options.
 * @param settings - Model settings containing placeholderValues.
 * @param sapOptions - Provider options containing placeholderValues.
 * @returns Merged placeholder values or undefined if empty.
 * @internal
 */
function resolvePlaceholderValues(
  settings: OrchestrationModelSettings,
  sapOptions: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const merged = deepMerge(
    settings.placeholderValues as Record<string, unknown> | undefined,
    sapOptions?.placeholderValues as Record<string, unknown> | undefined,
  ) as Record<string, string>;

  return hasKeys(merged) ? merged : undefined;
}

/**
 * Module keys for orchestration configuration.
 * @internal
 */
const ORCHESTRATION_MODULE_KEYS = ["masking", "filtering", "grounding", "translation"] as const;

/**
 * Module settings that are ignored when using orchestrationConfigRef.
 * @internal
 */
const CONFIG_REF_IGNORED_MODULES = [
  ...ORCHESTRATION_MODULE_KEYS,
  "fallbackModuleConfigs",
  "promptTemplateRef",
  "responseFormat",
  "tools",
  "modelParams",
  "modelVersion",
] as const;

/**
 * Provider options that are ignored when using orchestrationConfigRef.
 * Subset of CONFIG_REF_IGNORED_MODULES that can be passed via providerOptions.
 * @internal
 */
const CONFIG_REF_IGNORED_PROVIDER_OPTIONS = ["promptTemplateRef", "modelParams"] as const;

/**
 * Copies non-empty orchestration modules from source to target.
 * @param target - Target object to copy modules into.
 * @param source - Source object containing module configurations.
 * @internal
 */
function copyOrchestrationModules(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of ORCHESTRATION_MODULE_KEYS) {
    const value = source[key];
    if (value && hasKeys(value)) {
      target[key] = value;
    }
  }
}

/**
 * Checks if a value is a valid orchestration configuration reference.
 * @param value - The value to check.
 * @returns True if the value is a valid orchestration configuration reference.
 * @internal
 */
function isOrchestrationConfigRef(
  value: unknown,
): value is NonNullable<OrchestrationModelSettings["orchestrationConfigRef"]> {
  return orchestrationConfigRefSchema.safeParse(value).success;
}

/**
 * Orchestration API parameter mappings.
 * @internal
 */
const ORCHESTRATION_PARAM_MAPPINGS: readonly ParamMapping[] = [
  ...BaseLanguageModelStrategy.COMMON_PARAM_MAPPINGS,
  { camelCaseKey: "topK", optionKey: "topK", outputKey: "top_k" },
] as const;

/**
 * Language model strategy for the Orchestration API.
 *
 * Provides support for:
 * - Content filtering
 * - Data masking
 * - Document grounding
 * - Translation
 * - Prompt templates
 * - Orchestration config references
 * @internal
 */
export class OrchestrationLanguageModelStrategy extends BaseLanguageModelStrategy<
  OrchestrationClientInstance,
  ChatCompletionRequest,
  OrchestrationModelSettings
> {
  private readonly ClientClass: typeof OrchestrationClient;

  constructor(ClientClass: typeof OrchestrationClient) {
    super();
    this.ClientClass = ClientClass;
  }

  protected buildRequest(
    _config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): { readonly request: ChatCompletionRequest; readonly warnings: SharedV3Warning[] } {
    const warnings: SharedV3Warning[] = [];

    const { configRef } = commonParts.resolvedState as OrchestrationResolvedState;

    if (configRef) {
      return this.buildConfigRefRequest(settings, options, commonParts, warnings);
    }

    return this.buildStandardRequest(settings, commonParts, warnings);
  }

  /**
   * Collects stream-specific warnings for orchestration.
   * @param settings - Model settings.
   * @param sapOptions - Provider options.
   * @returns Array of warnings for streaming operations.
   * @internal
   */
  protected override collectStreamWarnings(
    settings: OrchestrationModelSettings,
    sapOptions?: Record<string, unknown>,
  ): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = [];

    // Skip warning if a valid orchestrationConfigRef is set in settings or providerOptions
    // (local module settings are ignored when using server-side config)
    const configRefCandidate =
      sapOptions?.orchestrationConfigRef ?? settings.orchestrationConfigRef;
    if (configRefCandidate && isOrchestrationConfigRef(configRefCandidate)) {
      return warnings;
    }

    if (settings.translation && hasKeys(settings.translation)) {
      if (!settings.streamOptions?.delimiters || settings.streamOptions.delimiters.length === 0) {
        warnings.push({
          message:
            "Translation module is configured but streamOptions.delimiters is not set. " +
            "For proper sentence boundary detection during streaming with translation, " +
            "consider setting delimiters (e.g., ['.', '!', '?', '\\n']).",
          type: "other",
        });
      }
    }

    return warnings;
  }

  protected createClient(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): OrchestrationClientInstance {
    const { configRef, promptTemplateRef, responseFormat, tools } =
      commonParts.resolvedState as OrchestrationResolvedState;

    if (configRef) {
      return new this.ClientClass(configRef, config.deploymentConfig, config.destination);
    }

    const clientConfig = this.buildOrchestrationModuleConfig(config, settings, {
      modelParams: commonParts.modelParams,
      promptTemplateRef,
      responseFormat,
      toolChoice: commonParts.toolChoice,
      tools,
    });

    if (settings.fallbackModuleConfigs && settings.fallbackModuleConfigs.length > 0) {
      const configList = [
        clientConfig,
        ...settings.fallbackModuleConfigs,
      ] as OrchestrationModuleConfigList;
      return new this.ClientClass(configList, config.deploymentConfig, config.destination);
    }

    return new this.ClientClass(clientConfig, config.deploymentConfig, config.destination);
  }

  protected async executeApiCall(
    client: OrchestrationClientInstance,
    request: ChatCompletionRequest,
    requestConfig: CustomRequestConfig | undefined,
  ): Promise<SDKResponse> {
    const response = await client.chatCompletion(request, requestConfig);

    const { requestId, responseMetadata } = this.extractMetadata(response);

    return {
      getCitations: () => response.getCitations(),
      getContent: () => response.getContent(),
      getFinishReason: () => response.getFinishReason(),
      getIntermediateFailures: () => response.getIntermediateFailures(),
      getTokenUsage: () => response.getTokenUsage(),
      getToolCalls: () => response.getToolCalls(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- SAP SDK types headers as any
      rawResponse: { headers: response.rawResponse.headers },
      requestId,
      responseMetadata,
    };
  }

  protected async executeStreamCall(
    client: OrchestrationClientInstance,
    request: ChatCompletionRequest,
    abortSignal: AbortSignal | undefined,
    settings: OrchestrationModelSettings,
    requestConfig: CustomRequestConfig | undefined,
  ): Promise<StreamCallResponse> {
    const sdkStreamOptions = this.buildSdkStreamOptions(settings.streamOptions);
    const streamResponse = await client.stream(
      request,
      abortSignal,
      sdkStreamOptions,
      requestConfig,
    );

    const { requestId, responseHeaders, responseMetadata } = this.extractMetadata(streamResponse);

    return {
      cancel: () => {
        streamResponse.stream.controller.abort();
      },
      getCitations: () => streamResponse.getCitations(),
      getFinishReason: () => streamResponse.getFinishReason(),
      getIntermediateFailures: () => streamResponse.getIntermediateFailures(),
      requestId,
      responseHeaders,
      responseMetadata,
      stream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
    };
  }

  protected getCompletionDataPath(): readonly string[] {
    return ["final_result"];
  }

  protected getEscapeTemplatePlaceholders(
    sapOptions: Record<string, unknown> | undefined,
    settings: OrchestrationModelSettings,
  ): boolean {
    return (
      (sapOptions?.escapeTemplatePlaceholders as boolean | undefined) ??
      settings.escapeTemplatePlaceholders ??
      true
    );
  }

  protected getParamMappings(): readonly ParamMapping[] {
    return ORCHESTRATION_PARAM_MAPPINGS;
  }

  protected override getPartProviderOptionsParser(): ParsePartProviderOptions | undefined {
    return parseSAPPartProviderOptions;
  }

  protected getUrl(): string {
    return "sap-ai:orchestration";
  }

  /**
   * Resolves orchestration-specific extra state: `configRef`, `promptTemplateRef`,
   * and `tools`. Pushes the masking-providers deprecation warning when masking
   * is locally configured (skipped under `configRef` because the server-side
   * configuration overrides it).
   * @param _config - Strategy configuration (unused).
   * @param settings - Model settings.
   * @param sapOptions - Parsed provider options.
   * @param options - AI SDK call options.
   * @param warnings - Shared warnings sink.
   * @returns Resolved orchestration state.
   * @internal
   */
  protected override resolveAdditionalState(
    _config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    sapOptions: Record<string, unknown> | undefined,
    options: LanguageModelV3CallOptions,
    warnings: SharedV3Warning[],
  ): OrchestrationResolvedState {
    const configRef = this.resolveConfigRef(sapOptions, settings, warnings);
    const promptTemplateRef = this.resolvePromptTemplateRef(sapOptions, settings);

    let responseFormat: SAPResponseFormat | undefined;
    if (configRef === undefined) {
      validateMaskingProvidersDeprecation(settings, warnings);
      const converted = convertResponseFormat(options.responseFormat, settings.responseFormat);
      responseFormat = converted.responseFormat;
      if (converted.warning) warnings.push(converted.warning);
    }

    const tools = this.resolveTools(settings, options, warnings);

    return { configRef, promptTemplateRef, responseFormat, tools };
  }

  /**
   * Builds request for orchestrationConfigRef mode.
   *
   * In configRef mode, the full configuration is managed server-side.
   * This request contains messages and placeholderValues; createClient separately
   * passes the reference, including overrideConfig, to the SAP SDK.
   * @param settings - Model settings.
   * @param options - Call options.
   * @param commonParts - Common build result.
   * @param warnings - Warnings array to populate.
   * @returns Request body and warnings.
   * @internal
   */
  private buildConfigRefRequest(
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
    warnings: SharedV3Warning[],
  ): { readonly request: ChatCompletionRequest; readonly warnings: SharedV3Warning[] } {
    warnings.push(
      ...this.collectConfigRefIgnoredWarnings(settings, options, commonParts.sapOptions),
    );

    const placeholderValues = resolvePlaceholderValues(settings, commonParts.sapOptions);

    // In configRef mode, SDK uses messagesHistory (not messages)
    const request: ChatCompletionRequest = {
      messagesHistory: commonParts.messages,
      ...(placeholderValues ? { placeholderValues } : {}),
    };

    return { request, warnings };
  }

  /**
   * Builds inline template configuration.
   * @param tools - Optional tools.
   * @param responseFormat - Optional response format.
   * @returns Prompt configuration.
   * @internal
   */
  private buildInlineTemplateConfig(
    tools: ChatCompletionTool[] | undefined,
    responseFormat: unknown,
  ): Record<string, unknown> {
    return {
      template: [],
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
  }

  /**
   * Builds the orchestration module configuration.
   * @param config - Strategy configuration.
   * @param settings - Model settings.
   * @param params - Build parameters.
   * @param params.modelParams - LLM model parameters.
   * @param params.promptTemplateRef - Optional prompt template reference.
   * @param params.responseFormat - Optional response format specification.
   * @param params.toolChoice - Optional tool choice specification.
   * @param params.tools - Optional tools for function calling.
   * @returns Orchestration module configuration.
   * @internal
   */
  private buildOrchestrationModuleConfig(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    params: {
      readonly modelParams: Record<string, unknown>;
      readonly promptTemplateRef?: PromptTemplateRef;
      readonly responseFormat?: unknown;
      readonly toolChoice?: SAPToolChoice;
      readonly tools?: ChatCompletionTool[];
    },
  ): OrchestrationModuleConfig {
    const { modelParams, promptTemplateRef, responseFormat, toolChoice, tools } = params;

    const promptConfig = promptTemplateRef
      ? this.buildTemplateRefPromptConfig(promptTemplateRef, tools, responseFormat)
      : this.buildInlineTemplateConfig(tools, responseFormat);

    // The SDK accepts model-specific options such as tool_choice only in model.params.
    const effectiveModelParams = toolChoice
      ? { ...modelParams, tool_choice: toolChoice }
      : modelParams;

    const moduleConfig: OrchestrationModuleConfig = {
      promptTemplating: {
        model: {
          name: config.modelId,
          params: effectiveModelParams,
          ...(settings.modelVersion ? { version: settings.modelVersion } : {}),
        },
        prompt: promptConfig,
      },
    };

    copyOrchestrationModules(
      moduleConfig as unknown as Record<string, unknown>,
      settings as unknown as Record<string, unknown>,
    );

    return moduleConfig;
  }

  /**
   * Builds SAP SDK stream options from user-facing stream options.
   * @param streamOptions - User-provided stream options.
   * @returns SDK-compatible stream options object.
   * @internal
   */
  private buildSdkStreamOptions(streamOptions: OrchestrationModelSettings["streamOptions"]): {
    global?: { chunk_size?: number; delimiters?: string[] };
    outputFiltering?: { overlap: number };
    promptTemplating: { include_usage: boolean };
  } {
    const delimiters = streamOptions?.delimiters;
    const hasNonEmptyDelimiters = Array.isArray(delimiters) && delimiters.length > 0;
    const hasGlobalOptions = streamOptions?.chunkSize !== undefined || hasNonEmptyDelimiters;

    return {
      promptTemplating: { include_usage: true },
      ...(hasGlobalOptions && {
        global: {
          ...(streamOptions?.chunkSize !== undefined && { chunk_size: streamOptions.chunkSize }),
          ...(hasNonEmptyDelimiters && {
            delimiters: Array.from(delimiters),
          }),
        },
      }),
      ...(streamOptions?.outputFilteringOverlap !== undefined && {
        outputFiltering: { overlap: streamOptions.outputFilteringOverlap },
      }),
    };
  }

  /**
   * Builds request for standard (non-configRef) mode.
   * @param settings - Model settings.
   * @param commonParts - Common build result.
   * @param warnings - Warnings array to populate.
   * @returns Request body and warnings.
   * @internal
   */
  private buildStandardRequest(
    settings: OrchestrationModelSettings,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
    warnings: SharedV3Warning[],
  ): { readonly request: ChatCompletionRequest; readonly warnings: SharedV3Warning[] } {
    const { promptTemplateRef } = commonParts.resolvedState as OrchestrationResolvedState;
    const placeholderValues = resolvePlaceholderValues(settings, commonParts.sapOptions);
    const request: ChatCompletionRequest = {
      ...(promptTemplateRef
        ? { messagesHistory: commonParts.messages }
        : { messages: commonParts.messages }),
      ...(placeholderValues ? { placeholderValues } : {}),
    };

    return { request, warnings };
  }

  /**
   * Builds prompt configuration for template reference with optional tools/response_format.
   * @param ref - Template reference.
   * @param tools - Optional tools.
   * @param responseFormat - Optional response format.
   * @returns Prompt configuration.
   * @internal
   */
  private buildTemplateRefPromptConfig(
    ref: PromptTemplateRef,
    tools?: ChatCompletionTool[],
    responseFormat?: unknown,
  ): Record<string, unknown> {
    return {
      template_ref: buildTemplateRefObject(ref),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
  }

  /**
   * Collects warnings for settings that will be ignored when using orchestrationConfigRef.
   * @param settings - The orchestration model settings.
   * @param options - The call options (for tools and responseFormat).
   * @param sapOptions - Parsed provider options (for promptTemplateRef in providerOptions).
   * @returns Array of warnings for ignored settings.
   * @internal
   */
  private collectConfigRefIgnoredWarnings(
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    sapOptions: Record<string, unknown> | undefined,
  ): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = [];
    const ignoredSettings: string[] = [];

    for (const key of CONFIG_REF_IGNORED_MODULES) {
      const value = settings[key as keyof OrchestrationModelSettings];
      if (value !== undefined) {
        if (typeof value === "object" && Object.keys(value).length === 0) {
          continue; // Skip empty objects
        }
        ignoredSettings.push(key);
      }
    }

    for (const key of CONFIG_REF_IGNORED_PROVIDER_OPTIONS) {
      if (sapOptions?.[key] && !settings[key as keyof OrchestrationModelSettings]) {
        ignoredSettings.push(`providerOptions.${key}`);
      }
    }

    const optionValues: Record<string, unknown> = options;
    for (const { optionKey } of this.getParamMappings()) {
      if (optionKey && optionValues[optionKey] !== undefined) {
        ignoredSettings.push(`options.${optionKey}`);
      }
    }
    if (options.stopSequences && options.stopSequences.length > 0) {
      ignoredSettings.push("options.stopSequences");
    }

    if (options.tools && options.tools.length > 0) {
      ignoredSettings.push("options.tools");
    }
    if (options.responseFormat) {
      ignoredSettings.push("options.responseFormat");
    }
    if (options.toolChoice) {
      ignoredSettings.push("options.toolChoice");
    }

    if (ignoredSettings.length > 0) {
      warnings.push({
        message: `orchestrationConfigRef is set; the following local settings are ignored: ${ignoredSettings.join(", ")}. The full configuration is managed by the referenced config.`,
        type: "other",
      });
    }

    return warnings;
  }

  /**
   * Resolves the orchestrationConfigRef from provider options or settings.
   * Parsed provider options take priority over settings. An invalid settings reference
   * is ignored with a warning; invalid per-call references fail schema parsing earlier.
   * @param sapOptions - Parsed provider options from commonParts.
   * @param settings - The model settings.
   * @param warnings - Shared warnings sink for degradation signals.
   * @returns The resolved config reference or undefined.
   * @internal
   */
  private resolveConfigRef(
    sapOptions: Record<string, unknown> | undefined,
    settings: OrchestrationModelSettings,
    warnings: SharedV3Warning[],
  ): OrchestrationModelSettings["orchestrationConfigRef"] {
    const configRefCandidate =
      sapOptions?.orchestrationConfigRef ?? settings.orchestrationConfigRef;

    if (!configRefCandidate) {
      return undefined;
    }

    if (isOrchestrationConfigRef(configRefCandidate)) {
      return configRefCandidate;
    }

    warnings.push({
      message:
        "orchestrationConfigRef is invalid and was ignored; falling back to local module settings.",
      type: "other",
    });
    return undefined;
  }

  /**
   * Resolves promptTemplateRef from provider options or settings.
   *
   * Provider options take priority over settings.
   * @param sapOptions - Parsed provider options from commonParts.
   * @param settings - The model settings.
   * @returns The resolved prompt template reference or undefined.
   * @internal
   */
  private resolvePromptTemplateRef(
    sapOptions: Record<string, unknown> | undefined,
    settings: OrchestrationModelSettings,
  ): PromptTemplateRef | undefined {
    const rawTemplateRef = sapOptions?.promptTemplateRef ?? settings.promptTemplateRef;

    if (
      rawTemplateRef &&
      typeof rawTemplateRef === "object" &&
      ("id" in rawTemplateRef || "name" in rawTemplateRef)
    ) {
      return rawTemplateRef as PromptTemplateRef;
    }

    return undefined;
  }

  /**
   * Resolves tools from settings or options with orchestration-specific priority.
   *
   * Orchestration allows tools to be defined in settings (unlike Foundation Models),
   * with options.tools taking priority.
   * @param settings - Model settings.
   * @param options - Call options.
   * @param warnings - Warnings array to populate.
   * @returns Resolved tools or undefined.
   * @internal
   */
  private resolveTools(
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    warnings: SharedV3Warning[],
  ): ChatCompletionTool[] | undefined {
    const settingsTools = settings.tools;
    const optionsTools = options.tools;

    if (settingsTools && settingsTools.length > 0 && optionsTools && optionsTools.length > 0) {
      warnings.push({
        message:
          "Both settings.tools and call options.tools were provided; preferring call options.tools.",
        type: "other",
      });
    }

    // Use settingsTools directly if available and no optionsTools
    // (settingsTools are already in SAP format)
    if (settingsTools && settingsTools.length > 0 && (!optionsTools || optionsTools.length === 0)) {
      return settingsTools;
    }

    if (optionsTools && optionsTools.length > 0) {
      const result = convertToolsToSAPFormat<ChatCompletionTool>(optionsTools, {
        parser: parseSAPPartProviderOptions,
        warnings,
      });
      warnings.push(...result.warnings);
      return result.tools;
    }

    return undefined;
  }
}
