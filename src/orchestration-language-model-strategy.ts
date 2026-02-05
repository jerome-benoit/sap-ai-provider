/** Orchestration language model strategy using `@sap-ai-sdk/orchestration`. */
import type { LanguageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import type {
  ChatCompletionTool,
  ChatMessage,
  LlmModelParams,
  OrchestrationClient,
  OrchestrationModuleConfig,
} from "@sap-ai-sdk/orchestration";

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
  type AISDKTool,
  convertResponseFormat,
  convertToolsToSAPFormat,
  type ParamMapping,
  type SAPToolChoice,
  type SDKResponse,
  type SDKStreamChunk,
} from "./strategy-utils.js";

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
 * Type guard for template reference by ID.
 * @param ref - Template reference.
 * @returns True if reference is by ID.
 * @internal
 */
function isTemplateRefById(ref: PromptTemplateRef): ref is PromptTemplateRefByID {
  return "id" in ref;
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

  protected buildRequest(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): { readonly request: OrchestrationRequest; readonly warnings: SharedV3Warning[] } {
    const warnings: SharedV3Warning[] = [];

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

    // Template reference resolution
    const rawTemplateRef = commonParts.sapOptions?.promptTemplateRef ?? settings.promptTemplateRef;
    const promptTemplateRef: PromptTemplateRef | undefined =
      rawTemplateRef &&
      typeof rawTemplateRef === "object" &&
      ("id" in rawTemplateRef || "name" in rawTemplateRef)
        ? (rawTemplateRef as PromptTemplateRef)
        : undefined;

    // Build orchestration module configuration
    const orchestrationConfig = this.buildOrchestrationModuleConfig(config, settings, {
      modelParams: commonParts.modelParams as SAPModelParams,
      promptTemplateRef,
      responseFormat,
      tools,
    });

    // Placeholder values merging (settings < providerOptions)
    const mergedPlaceholderValues = deepMerge(
      settings.placeholderValues as Record<string, unknown> | undefined,
      commonParts.sapOptions?.placeholderValues as Record<string, unknown> | undefined,
    ) as Record<string, string>;

    const placeholderValues =
      Object.keys(mergedPlaceholderValues).length > 0 ? mergedPlaceholderValues : undefined;

    // Build final request body
    const request = this.buildRequestBody(
      commonParts.messages,
      orchestrationConfig,
      placeholderValues,
      toolChoice,
    );

    return { request, warnings };
  }

  protected createClient(
    config: LanguageModelStrategyConfig,
    settings: OrchestrationModelSettings,
  ): OrchestrationClientInstance {
    // Create a minimal config with just the model for client initialization
    // The full config will be passed with each request
    const minimalConfig: OrchestrationModuleConfig = {
      promptTemplating: {
        model: {
          name: config.modelId,
          ...(settings.modelVersion ? { version: settings.modelVersion } : {}),
        },
        prompt: { template: [] },
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
      readonly tools?: ChatCompletionTool[];
    },
  ): OrchestrationModuleConfig {
    const { modelParams, promptTemplateRef, responseFormat, tools } = params;

    // Build prompt configuration
    const promptConfig = promptTemplateRef
      ? this.buildTemplateRefConfig(promptTemplateRef, tools, responseFormat)
      : this.buildInlineTemplateConfig(tools, responseFormat);

    return {
      promptTemplating: {
        model: {
          name: config.modelId,
          params: modelParams,
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
   * @param toolChoice - Optional tool choice.
   * @returns Request body.
   * @internal
   */
  private buildRequestBody(
    messages: ChatMessage[],
    orchestrationConfig: OrchestrationModuleConfig,
    placeholderValues: Record<string, string> | undefined,
    toolChoice: SAPToolChoice | undefined,
  ): Record<string, unknown> {
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
   * Builds prompt configuration for template reference.
   * @param ref - Template reference.
   * @param tools - Optional tools.
   * @param responseFormat - Optional response format.
   * @returns Prompt configuration.
   * @internal
   */
  private buildTemplateRefConfig(
    ref: PromptTemplateRef,
    tools: ChatCompletionTool[] | undefined,
    responseFormat: unknown,
  ): Record<string, unknown> {
    return {
      template_ref: isTemplateRefById(ref)
        ? {
            id: ref.id,
            ...(ref.scope && { scope: ref.scope }),
          }
        : {
            name: ref.name,
            scenario: ref.scenario,
            version: ref.version,
            ...(ref.scope && { scope: ref.scope }),
          },
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
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
