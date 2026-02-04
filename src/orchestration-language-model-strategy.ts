/** Orchestration language model strategy using `@sap-ai-sdk/orchestration`. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
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
  SAPAIModelSettings,
} from "./sap-ai-settings.js";
import type { LanguageModelAPIStrategy, LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToSAPMessages } from "./convert-to-sap-messages.js";
import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import {
  getProviderName,
  orchestrationConfigRefSchema,
  sapAILanguageModelProviderOptions,
} from "./sap-ai-provider-options.js";
import {
  buildGenerateResult,
  buildModelParams,
  convertResponseFormat,
  convertToolsToSAPFormat,
  createAISDKRequestBodySummary,
  createStreamTransformer,
  mapToolChoice,
  type ParamMapping,
  type SAPToolChoice,
  type SDKResponse,
  type SDKStreamChunk,
  StreamIdGenerator,
} from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
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

/**
 * @internal
 */
type SAPModelParams = LlmModelParams & {
  parallel_tool_calls?: boolean;
  seed?: number;
  stop?: string[];
  top_k?: number;
};

/**
 * @param ref - Prompt template reference.
 * @returns True if template reference is by ID.
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
 * Checks if a value is a valid OrchestrationConfigRef.
 * @param value - The value to check.
 * @returns True if the value is a valid OrchestrationConfigRef.
 * @internal
 */
function isOrchestrationConfigRef(value: unknown): value is OrchestrationConfigRef {
  return orchestrationConfigRefSchema.safeParse(value).success;
}

/**
 * @internal
 */
const PARAM_MAPPINGS: readonly ParamMapping[] = [
  { camelCaseKey: "maxTokens", optionKey: "maxOutputTokens", outputKey: "max_tokens" },
  { camelCaseKey: "temperature", optionKey: "temperature", outputKey: "temperature" },
  { camelCaseKey: "topP", optionKey: "topP", outputKey: "top_p" },
  { camelCaseKey: "topK", optionKey: "topK", outputKey: "top_k" },
  {
    camelCaseKey: "frequencyPenalty",
    optionKey: "frequencyPenalty",
    outputKey: "frequency_penalty",
  },
  { camelCaseKey: "presencePenalty", optionKey: "presencePenalty", outputKey: "presence_penalty" },
  { camelCaseKey: "seed", optionKey: "seed", outputKey: "seed" },
  { camelCaseKey: "parallel_tool_calls", outputKey: "parallel_tool_calls" },
] as const;

/**
 * @internal
 */
type OrchestrationClientClass = typeof OrchestrationClient;

/**
 * @internal
 */
export class OrchestrationLanguageModelStrategy implements LanguageModelAPIStrategy {
  private readonly ClientClass: OrchestrationClientClass;

  constructor(ClientClass: OrchestrationClientClass) {
    this.ClientClass = ClientClass;
  }

  async doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    // Check for orchestrationConfigRef - use dedicated code path if present
    const configRef = await this.resolveConfigRef(config, settings, options);
    if (configRef) {
      return this.doGenerateWithConfigRef(config, settings, options, configRef);
    }

    try {
      const { messages, orchestrationConfig, placeholderValues, toolChoice, warnings } =
        await this.buildOrchestrationConfig(config, settings, options);

      const client = this.createClient(config, orchestrationConfig);

      const requestBody = this.buildRequestBody(
        messages,
        orchestrationConfig,
        placeholderValues,
        toolChoice,
      );

      const response = await client.chatCompletion(
        requestBody,
        options.abortSignal ? { signal: options.abortSignal } : undefined,
      );

      return buildGenerateResult({
        modelId: config.modelId,
        providerName: getProviderName(config.provider),
        requestBody,
        response: response as SDKResponse,
        responseHeaders: normalizeHeaders(response.rawResponse.headers),
        version: VERSION,
        warnings,
      });
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doGenerate",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:orchestration",
      });
    }
  }

  async doGenerateWithConfigRef(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
    configRef: OrchestrationConfigRef,
  ): Promise<LanguageModelV3GenerateResult> {
    try {
      const { messages, placeholderValues, requestBody, warnings } =
        await this.buildConfigRefRequest(config, settings, options, configRef);

      const client = this.createClientWithConfigRef(config, configRef);

      const response = await client.chatCompletion(
        { messages, ...(placeholderValues ? { placeholderValues } : {}) },
        options.abortSignal ? { signal: options.abortSignal } : undefined,
      );

      return buildGenerateResult({
        modelId: config.modelId,
        providerName: getProviderName(config.provider),
        requestBody,
        response: response as SDKResponse,
        responseHeaders: normalizeHeaders(response.rawResponse.headers),
        version: VERSION,
        warnings,
      });
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doGenerate",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:orchestration",
      });
    }
  }

  async doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    // Check for orchestrationConfigRef - use dedicated code path if present
    const configRef = await this.resolveConfigRef(config, settings, options);
    if (configRef) {
      return this.doStreamWithConfigRef(config, settings, options, configRef);
    }

    try {
      const { messages, orchestrationConfig, placeholderValues, toolChoice, warnings } =
        await this.buildOrchestrationConfig(config, settings, options);

      const client = this.createClient(config, orchestrationConfig);

      const requestBody = this.buildRequestBody(
        messages,
        orchestrationConfig,
        placeholderValues,
        toolChoice,
      );

      const streamResponse = await client.stream(requestBody, options.abortSignal, {
        promptTemplating: { include_usage: true },
      });

      const idGenerator = new StreamIdGenerator();
      const responseId = idGenerator.generateResponseId();

      const transformedStream = createStreamTransformer({
        convertToAISDKError,
        idGenerator,
        includeRawChunks: options.includeRawChunks ?? false,
        modelId: config.modelId,
        options,
        providerName: getProviderName(config.provider),
        responseId,
        sdkStream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
        streamResponseGetFinishReason: () => streamResponse.getFinishReason(),
        streamResponseGetTokenUsage: () => streamResponse.getTokenUsage(),
        url: "sap-ai:orchestration",
        version: VERSION,
        warnings,
      });

      return {
        request: {
          body: requestBody as unknown,
        },
        stream: transformedStream,
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doStream",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:orchestration",
      });
    }
  }

  async doStreamWithConfigRef(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
    configRef: OrchestrationConfigRef,
  ): Promise<LanguageModelV3StreamResult> {
    try {
      const { messages, placeholderValues, requestBody, warnings } =
        await this.buildConfigRefRequest(config, settings, options, configRef);

      const client = this.createClientWithConfigRef(config, configRef);

      const streamResponse = await client.stream(
        { messages, ...(placeholderValues ? { placeholderValues } : {}) },
        options.abortSignal,
        { promptTemplating: { include_usage: true } },
      );

      const idGenerator = new StreamIdGenerator();
      const responseId = idGenerator.generateResponseId();

      const transformedStream = createStreamTransformer({
        convertToAISDKError,
        idGenerator,
        includeRawChunks: options.includeRawChunks ?? false,
        modelId: config.modelId,
        options,
        providerName: getProviderName(config.provider),
        responseId,
        sdkStream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
        streamResponseGetFinishReason: () => streamResponse.getFinishReason(),
        streamResponseGetTokenUsage: () => streamResponse.getTokenUsage(),
        url: "sap-ai:orchestration",
        version: VERSION,
        warnings,
      });

      return {
        request: {
          body: requestBody as unknown,
        },
        stream: transformedStream,
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doStream",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:orchestration",
      });
    }
  }

  /**
   * Builds configuration for configRef mode - only messages and placeholderValues are passed.
   * @param config - The strategy configuration.
   * @param settings - The model settings.
   * @param options - The call options.
   * @param configRef - The orchestration config reference.
   * @returns The request configuration for configRef mode.
   */
  private async buildConfigRefRequest(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
    configRef: OrchestrationConfigRef,
  ): Promise<{
    configRef: OrchestrationConfigRef;
    messages: ChatMessage[];
    placeholderValues?: Record<string, string>;
    requestBody: Record<string, unknown>;
    warnings: SharedV3Warning[];
  }> {
    const providerName = getProviderName(config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const orchSettings = settings as OrchestrationModelSettings;
    const warnings = this.collectConfigRefIgnoredWarnings(orchSettings, options);

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders:
        sapOptions?.escapeTemplatePlaceholders ?? orchSettings.escapeTemplatePlaceholders ?? true,
      includeReasoning: sapOptions?.includeReasoning ?? orchSettings.includeReasoning ?? false,
    });

    // Merge placeholder values from settings and provider options
    const mergedPlaceholderValues =
      orchSettings.placeholderValues || sapOptions?.placeholderValues
        ? {
            ...orchSettings.placeholderValues,
            ...sapOptions?.placeholderValues,
          }
        : undefined;
    const placeholderValues =
      mergedPlaceholderValues && Object.keys(mergedPlaceholderValues).length > 0
        ? mergedPlaceholderValues
        : undefined;

    // Build minimal request body for configRef mode
    const requestBody: Record<string, unknown> = {
      configRef,
      messages,
      ...(placeholderValues ? { placeholderValues } : {}),
    };

    return {
      configRef,
      messages,
      placeholderValues,
      requestBody,
      warnings,
    };
  }

  private async buildOrchestrationConfig(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<{
    messages: ChatMessage[];
    orchestrationConfig: OrchestrationModuleConfig;
    placeholderValues?: Record<string, string>;
    toolChoice?: SAPToolChoice;
    warnings: SharedV3Warning[];
  }> {
    const providerName = getProviderName(config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const warnings: SharedV3Warning[] = [];

    const orchSettings = settings as OrchestrationModelSettings;

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders:
        sapOptions?.escapeTemplatePlaceholders ?? orchSettings.escapeTemplatePlaceholders ?? true,
      includeReasoning: sapOptions?.includeReasoning ?? orchSettings.includeReasoning ?? false,
    });

    let tools: ChatCompletionTool[] | undefined;
    const settingsTools = orchSettings.tools;
    const optionsTools = options.tools;

    if (settingsTools && settingsTools.length > 0 && optionsTools && optionsTools.length > 0) {
      warnings.push({
        message:
          "Both settings.tools and call options.tools were provided; preferring call options.tools.",
        type: "other",
      });
    }

    if (settingsTools && settingsTools.length > 0 && (!optionsTools || optionsTools.length === 0)) {
      tools = settingsTools;
    } else if (optionsTools && optionsTools.length > 0) {
      const toolsResult = convertToolsToSAPFormat<ChatCompletionTool>(optionsTools);
      tools = toolsResult.tools;
      warnings.push(...toolsResult.warnings);
    }

    const { modelParams: baseModelParams, warnings: paramWarnings } = buildModelParams({
      options,
      paramMappings: PARAM_MAPPINGS,
      providerModelParams: sapOptions?.modelParams as Record<string, unknown> | undefined,
      settingsModelParams: orchSettings.modelParams as Record<string, unknown> | undefined,
    });
    const modelParams = baseModelParams as SAPModelParams;
    warnings.push(...paramWarnings);

    const toolChoice = mapToolChoice(options.toolChoice);

    const { responseFormat, warning: responseFormatWarning } = convertResponseFormat(
      options.responseFormat,
      orchSettings.responseFormat,
    );
    if (responseFormatWarning) {
      warnings.push(responseFormatWarning);
    }

    const promptTemplateRef = sapOptions?.promptTemplateRef ?? orchSettings.promptTemplateRef;

    // Type assertion: SDK's Xor type doesn't allow tools/response_format alongside template_ref
    const promptConfig: Record<string, unknown> = promptTemplateRef
      ? {
          template_ref: isTemplateRefById(promptTemplateRef)
            ? {
                id: promptTemplateRef.id,
                ...(promptTemplateRef.scope && { scope: promptTemplateRef.scope }),
              }
            : {
                name: promptTemplateRef.name,
                scenario: promptTemplateRef.scenario,
                version: promptTemplateRef.version,
                ...(promptTemplateRef.scope && { scope: promptTemplateRef.scope }),
              },
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }
      : {
          template: [],
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
        };

    const orchestrationConfig: OrchestrationModuleConfig = {
      promptTemplating: {
        model: {
          name: config.modelId,
          params: modelParams,
          ...(orchSettings.modelVersion ? { version: orchSettings.modelVersion } : {}),
        },
        prompt: promptConfig as OrchestrationModuleConfig["promptTemplating"]["prompt"],
      },
      ...(orchSettings.masking && Object.keys(orchSettings.masking as object).length > 0
        ? { masking: orchSettings.masking }
        : {}),
      ...(orchSettings.filtering && Object.keys(orchSettings.filtering as object).length > 0
        ? { filtering: orchSettings.filtering }
        : {}),
      ...(orchSettings.grounding && Object.keys(orchSettings.grounding as object).length > 0
        ? { grounding: orchSettings.grounding }
        : {}),
      ...(orchSettings.translation && Object.keys(orchSettings.translation as object).length > 0
        ? { translation: orchSettings.translation }
        : {}),
    };

    const mergedPlaceholderValues =
      orchSettings.placeholderValues || sapOptions?.placeholderValues
        ? {
            ...orchSettings.placeholderValues,
            ...sapOptions?.placeholderValues,
          }
        : undefined;
    const placeholderValues =
      mergedPlaceholderValues && Object.keys(mergedPlaceholderValues).length > 0
        ? mergedPlaceholderValues
        : undefined;

    return {
      messages,
      orchestrationConfig,
      placeholderValues,
      toolChoice,
      warnings,
    };
  }

  private buildRequestBody(
    messages: ChatMessage[],
    orchestrationConfig: OrchestrationModuleConfig,
    placeholderValues?: Record<string, string>,
    toolChoice?: SAPToolChoice,
  ): Record<string, unknown> {
    // Type assertion: SDK type doesn't expose prompt.tools/response_format/template_ref properties
    const promptTemplating = orchestrationConfig.promptTemplating as ExtendedPromptTemplating;

    return {
      messages,
      model: {
        ...orchestrationConfig.promptTemplating.model,
      },
      ...(placeholderValues ? { placeholderValues } : {}),
      ...(promptTemplating.prompt.template_ref
        ? { template_ref: promptTemplating.prompt.template_ref }
        : {}),
      ...(promptTemplating.prompt.tools ? { tools: promptTemplating.prompt.tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
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
   * Collects warnings for settings that will be ignored when using orchestrationConfigRef.
   * @param settings - The orchestration model settings.
   * @param options - The call options (for tools and responseFormat).
   * @returns Array of warnings for ignored settings.
   */
  private collectConfigRefIgnoredWarnings(
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
  ): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = [];
    const ignoredSettings: string[] = [];

    // Check settings-level configurations
    for (const key of CONFIG_REF_IGNORED_MODULES) {
      const value = settings[key as keyof OrchestrationModelSettings];
      if (value !== undefined) {
        if (typeof value === "object" && Object.keys(value as object).length === 0) {
          continue; // Skip empty objects
        }
        ignoredSettings.push(key);
      }
    }

    // Check call-level options
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

  private createClient(
    config: LanguageModelStrategyConfig,
    orchConfig: OrchestrationModuleConfig,
  ): InstanceType<OrchestrationClientClass> {
    return new this.ClientClass(orchConfig, config.deploymentConfig, config.destination);
  }

  private createClientWithConfigRef(
    config: LanguageModelStrategyConfig,
    configRef: OrchestrationConfigRef,
  ): InstanceType<OrchestrationClientClass> {
    return new this.ClientClass(configRef, config.deploymentConfig, config.destination);
  }

  /**
   * Resolves the orchestrationConfigRef from provider options or settings.
   * Provider options take priority over settings.
   * @param config - The strategy configuration.
   * @param settings - The model settings.
   * @param options - The call options.
   * @returns The resolved config reference or undefined.
   */
  private async resolveConfigRef(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<OrchestrationConfigRef | undefined> {
    const providerName = getProviderName(config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const orchSettings = settings as OrchestrationModelSettings;

    // Provider options take priority
    const configRefCandidate =
      sapOptions?.orchestrationConfigRef ?? orchSettings.orchestrationConfigRef;

    if (configRefCandidate && isOrchestrationConfigRef(configRefCandidate)) {
      return configRefCandidate;
    }

    return undefined;
  }
}
