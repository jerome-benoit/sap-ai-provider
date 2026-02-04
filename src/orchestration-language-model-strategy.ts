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
import { getProviderName, sapAILanguageModelProviderOptions } from "./sap-ai-provider-options.js";
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

  async doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
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

  private createClient(
    config: LanguageModelStrategyConfig,
    orchConfig: OrchestrationModuleConfig,
  ): InstanceType<OrchestrationClientClass> {
    return new this.ClientClass(orchConfig, config.deploymentConfig, config.destination);
  }
}
