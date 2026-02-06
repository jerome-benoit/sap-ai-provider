/** Orchestration language model strategy using `@sap-ai-sdk/orchestration`. */
import type { LanguageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import type {
  ChatCompletionTool,
  ChatMessage,
  LlmModelParams,
  OrchestrationClient,
  OrchestrationConfigRef,
  OrchestrationModuleConfig,
} from "@sap-ai-sdk/orchestration";

import { parseProviderOptions } from "@ai-sdk/provider-utils";

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
import { convertToSAPMessages } from "./convert-to-sap-messages.js";
import { deepMerge } from "./deep-merge.js";
import {
  getProviderName,
  orchestrationConfigRefSchema,
  sapAILanguageModelProviderOptions,
} from "./sap-ai-provider-options.js";
import {
  type AISDKTool,
  buildModelParams,
  convertResponseFormat,
  convertToolsToSAPFormat,
  mapToolChoice,
  type ParamMapping,
  type SAPToolChoice,
  type SDKResponse,
  type SDKStreamChunk,
} from "./strategy-utils.js";

/**
 * Internal key for storing resolved configRef in sapOptions.
 * @internal
 */
const RESOLVED_CONFIG_REF_KEY = "_resolvedConfigRef" as const;

/**
 * Internal key for storing resolved promptTemplateRef in sapOptions.
 * @internal
 */
const RESOLVED_PROMPT_TEMPLATE_REF_KEY = "_resolvedPromptTemplateRef" as const;

/**
 * Extended prompt templating interface for type-safe access.
 * @internal
 */
interface ExtendedPromptTemplating {
  prompt: {
    response_format?: unknown;
    template?: unknown[];
    template_ref?: unknown;
    tools?: unknown;
  };
}

/** @internal */
type OrchestrationClientInstance = InstanceType<typeof OrchestrationClient>;

/**
 * Orchestration request body type.
 * @internal
 */
type OrchestrationRequest = Record<string, unknown>;

/**
 * SAP model parameters with orchestration-specific fields.
 * @internal
 */
type SAPModelParams = LlmModelParams & {
  parallel_tool_calls?: boolean;
  seed?: number;
  stop?: string[];
  top_k?: number;
};

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
 * Module settings that are ignored when using orchestrationConfigRef.
 * @internal
 */
const CONFIG_REF_IGNORED_MODULES = [
  "filtering",
  "grounding",
  "masking",
  "translation",
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
 * Checks if a value is a valid OrchestrationConfigRef.
 * @param value - The value to check.
 * @returns True if the value is a valid OrchestrationConfigRef.
 * @internal
 */
function isOrchestrationConfigRef(value: unknown): value is OrchestrationConfigRef {
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
  OrchestrationRequest,
  OrchestrationModelSettings
> {
  private readonly ClientClass: typeof OrchestrationClient;

  constructor(ClientClass: typeof OrchestrationClient) {
    super();
    this.ClientClass = ClientClass;
  }

  /**
   * Builds common parts with orchestration-specific configRef resolution.
   *
   * Resolves configRef once and stores it in sapOptions for use by
   * createClient and buildRequest, avoiding duplicate resolution.
   * @param config - Strategy configuration.
   * @param settings - Model settings.
   * @param options - AI SDK call options.
   * @returns Common build result with resolved configRef in sapOptions.
   * @internal
   */
  protected override async buildCommonParts(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>> {
    const providerName = getProviderName(config.provider);

    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const configRef = this.resolveConfigRef(sapOptions, settings);
    const promptTemplateRef = this.resolvePromptTemplateRef(sapOptions, settings);

    const warnings: SharedV3Warning[] = [];

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders: this.getEscapeTemplatePlaceholders(sapOptions, settings),
      includeReasoning: this.getIncludeReasoning(sapOptions, settings),
    });

    // In configRef mode, modelParams from settings/options are ignored (server-side config)
    // But we still build them to generate warnings for ignored settings
    const { modelParams, warnings: paramWarnings } = buildModelParams({
      options,
      paramMappings: this.getParamMappings(),
      providerModelParams: sapOptions?.modelParams as Record<string, unknown> | undefined,
      settingsModelParams: settings.modelParams as Record<string, unknown> | undefined,
    });
    warnings.push(...paramWarnings);

    const toolChoice = mapToolChoice(options.toolChoice);

    return {
      messages,
      modelParams,
      providerName,
      sapOptions: {
        ...sapOptions,
        [RESOLVED_CONFIG_REF_KEY]: configRef,
        [RESOLVED_PROMPT_TEMPLATE_REF_KEY]: promptTemplateRef,
      },
      toolChoice,
      warnings,
    };
  }

  protected buildRequest(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): { readonly request: OrchestrationRequest; readonly warnings: SharedV3Warning[] } {
    const warnings: SharedV3Warning[] = [];

    const configRef = commonParts.sapOptions?.[RESOLVED_CONFIG_REF_KEY] as
      | OrchestrationConfigRef
      | undefined;

    if (configRef) {
      return this.buildConfigRefRequest(settings, options, commonParts, configRef, warnings);
    }

    return this.buildStandardRequest(config, settings, options, commonParts, warnings);
  }

  protected createClient(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): OrchestrationClientInstance {
    const configRef = commonParts.sapOptions?.[RESOLVED_CONFIG_REF_KEY] as
      | OrchestrationConfigRef
      | undefined;

    if (configRef) {
      return new this.ClientClass(configRef, config.deploymentConfig, config.destination);
    }

    const promptTemplateRef = commonParts.sapOptions?.[RESOLVED_PROMPT_TEMPLATE_REF_KEY] as
      | PromptTemplateRef
      | undefined;

    const promptConfig = promptTemplateRef
      ? this.buildTemplateRefPromptConfig(promptTemplateRef)
      : { template: [] as ChatMessage[] };

    const minimalConfig: OrchestrationModuleConfig = {
      promptTemplating: {
        model: {
          name: config.modelId,
          ...(settings.modelVersion ? { version: settings.modelVersion } : {}),
        },
        prompt: promptConfig as OrchestrationModuleConfig["promptTemplating"]["prompt"],
      },
    };
    return new this.ClientClass(minimalConfig, config.deploymentConfig, config.destination);
  }

  protected async executeApiCall(
    client: OrchestrationClientInstance,
    request: OrchestrationRequest,
    abortSignal: AbortSignal | undefined,
  ): Promise<SDKResponse> {
    const response = await client.chatCompletion(
      request,
      abortSignal ? { signal: abortSignal } : undefined,
    );

    return {
      getContent: () => response.getContent(),
      getFinishReason: () => response.getFinishReason(),
      getTokenUsage: () => response.getTokenUsage(),
      getToolCalls: () => response.getToolCalls(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- SAP SDK types headers as any
      rawResponse: { headers: response.rawResponse.headers },
    };
  }

  protected async executeStreamCall(
    client: OrchestrationClientInstance,
    request: OrchestrationRequest,
    abortSignal: AbortSignal | undefined,
  ): Promise<StreamCallResponse> {
    const streamResponse = await client.stream(request, abortSignal, {
      promptTemplating: { include_usage: true },
    });

    return {
      getFinishReason: () => streamResponse.getFinishReason(),
      getTokenUsage: () => streamResponse.getTokenUsage(),
      stream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
    };
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

  protected getUrl(): string {
    return "sap-ai:orchestration";
  }

  /**
   * Builds request for orchestrationConfigRef mode.
   *
   * In configRef mode, the full configuration is managed server-side.
   * We only send messages and placeholderValues.
   * @param settings - Model settings.
   * @param options - Call options.
   * @param commonParts - Common build result.
   * @param _configRef - The config reference (unused, passed for signature consistency).
   * @param warnings - Warnings array to populate.
   * @returns Request body and warnings.
   * @internal
   */
  private buildConfigRefRequest(
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
    _configRef: OrchestrationConfigRef,
    warnings: SharedV3Warning[],
  ): { readonly request: OrchestrationRequest; readonly warnings: SharedV3Warning[] } {
    warnings.push(
      ...this.collectConfigRefIgnoredWarnings(settings, options, commonParts.sapOptions),
    );

    // Merge placeholder values (settings < providerOptions)
    const mergedPlaceholderValues = deepMerge(
      settings.placeholderValues as Record<string, unknown> | undefined,
      commonParts.sapOptions?.placeholderValues as Record<string, unknown> | undefined,
    ) as Record<string, string>;

    const placeholderValues =
      Object.keys(mergedPlaceholderValues).length > 0 ? mergedPlaceholderValues : undefined;

    // In configRef mode, SDK uses messagesHistory (not messages)
    const request: OrchestrationRequest = {
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
      readonly modelParams: SAPModelParams;
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

    // Include tool_choice in model.params because the SDK filters request-level options
    // See: https://github.com/SAP/ai-sdk-js/issues/1500
    const effectiveModelParams = toolChoice
      ? { ...modelParams, tool_choice: toolChoice }
      : modelParams;

    return {
      promptTemplating: {
        model: {
          name: config.modelId,
          params: effectiveModelParams,
          ...(settings.modelVersion ? { version: settings.modelVersion } : {}),
        },
        prompt: promptConfig as OrchestrationModuleConfig["promptTemplating"]["prompt"],
      },
      ...(settings.masking && Object.keys(settings.masking as object).length > 0
        ? { masking: settings.masking }
        : {}),
      ...(settings.filtering && Object.keys(settings.filtering as object).length > 0
        ? { filtering: settings.filtering }
        : {}),
      ...(settings.grounding && Object.keys(settings.grounding as object).length > 0
        ? { grounding: settings.grounding }
        : {}),
      ...(settings.translation && Object.keys(settings.translation as object).length > 0
        ? { translation: settings.translation }
        : {}),
    };
  }

  /**
   * Builds the final request body for the orchestration API.
   * @param messages - Chat messages.
   * @param orchestrationConfig - Module configuration.
   * @param placeholderValues - Optional placeholder values.
   * @param hasTemplateRef - Whether template_ref mode is active.
   * @returns Request body.
   * @internal
   */
  private buildRequestBody(
    messages: ChatMessage[],
    orchestrationConfig: OrchestrationModuleConfig,
    placeholderValues: Record<string, string> | undefined,
    hasTemplateRef: boolean,
  ): Record<string, unknown> {
    const promptTemplating = orchestrationConfig.promptTemplating as ExtendedPromptTemplating;

    // In template_ref mode, SDK uses messagesHistory (not messages)
    // In inline template mode, SDK adds messages to the template array
    const messagesField = hasTemplateRef ? { messagesHistory: messages } : { messages };

    // Note: tool_choice is passed via model.params (not request level) because the SDK
    // filters out request-level options. See: https://github.com/SAP/ai-sdk-js/issues/1500
    return {
      ...messagesField,
      model: {
        ...orchestrationConfig.promptTemplating.model,
      },
      ...(placeholderValues ? { placeholderValues } : {}),
      ...(promptTemplating.prompt.tools ? { tools: promptTemplating.prompt.tools } : {}),
      ...(promptTemplating.prompt.response_format
        ? { response_format: promptTemplating.prompt.response_format }
        : {}),
      ...(orchestrationConfig.masking && Object.keys(orchestrationConfig.masking).length > 0
        ? { masking: orchestrationConfig.masking }
        : {}),
      ...(orchestrationConfig.filtering && Object.keys(orchestrationConfig.filtering).length > 0
        ? { filtering: orchestrationConfig.filtering }
        : {}),
      ...(orchestrationConfig.grounding && Object.keys(orchestrationConfig.grounding).length > 0
        ? { grounding: orchestrationConfig.grounding }
        : {}),
      ...(orchestrationConfig.translation && Object.keys(orchestrationConfig.translation).length > 0
        ? { translation: orchestrationConfig.translation }
        : {}),
    };
  }

  /**
   * Builds request for standard (non-configRef) mode.
   * @param config - Strategy configuration.
   * @param settings - Model settings.
   * @param options - Call options.
   * @param commonParts - Common build result.
   * @param warnings - Warnings array to populate.
   * @returns Request body and warnings.
   * @internal
   */
  private buildStandardRequest(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
    warnings: SharedV3Warning[],
  ): { readonly request: OrchestrationRequest; readonly warnings: SharedV3Warning[] } {
    // Resolve tools with orchestration-specific priority (settings.tools can override)
    const tools = this.resolveTools(settings, options, warnings);

    // Response format conversion
    const { responseFormat, warning: responseFormatWarning } = convertResponseFormat(
      options.responseFormat,
      settings.responseFormat,
    );
    if (responseFormatWarning) {
      warnings.push(responseFormatWarning);
    }

    const { toolChoice } = commonParts;

    const promptTemplateRef = commonParts.sapOptions?.[RESOLVED_PROMPT_TEMPLATE_REF_KEY] as
      | PromptTemplateRef
      | undefined;

    const orchestrationConfig = this.buildOrchestrationModuleConfig(config, settings, {
      modelParams: commonParts.modelParams as SAPModelParams,
      promptTemplateRef,
      responseFormat,
      toolChoice,
      tools,
    });

    // Placeholder values merging (settings < providerOptions)
    const mergedPlaceholderValues = deepMerge(
      settings.placeholderValues as Record<string, unknown> | undefined,
      commonParts.sapOptions?.placeholderValues as Record<string, unknown> | undefined,
    ) as Record<string, string>;

    const placeholderValues =
      Object.keys(mergedPlaceholderValues).length > 0 ? mergedPlaceholderValues : undefined;

    const request = this.buildRequestBody(
      commonParts.messages,
      orchestrationConfig,
      placeholderValues,
      Boolean(promptTemplateRef),
    );

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
        if (typeof value === "object" && Object.keys(value as object).length === 0) {
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
   * Provider options take priority over settings.
   * @param sapOptions - Parsed provider options from commonParts.
   * @param settings - The model settings.
   * @returns The resolved config reference or undefined.
   * @internal
   */
  private resolveConfigRef(
    sapOptions: Record<string, unknown> | undefined,
    settings: OrchestrationModelSettings,
  ): OrchestrationConfigRef | undefined {
    // Provider options take priority over settings
    const configRefCandidate =
      sapOptions?.orchestrationConfigRef ?? settings.orchestrationConfigRef;

    if (configRefCandidate && isOrchestrationConfigRef(configRefCandidate)) {
      return configRefCandidate;
    }

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

    // Convert optionsTools from AI SDK format to SAP format
    if (optionsTools && optionsTools.length > 0) {
      const result = convertToolsToSAPFormat<ChatCompletionTool>(optionsTools as AISDKTool[]);
      warnings.push(...result.warnings);
      return result.tools;
    }

    return undefined;
  }
}
