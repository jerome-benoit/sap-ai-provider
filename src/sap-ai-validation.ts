/** Validation and resolution functions for SAP AI API-specific features. */
import type {
  FoundationModelsModelSettings,
  OrchestrationModelSettings,
  SAPAIApiType,
  SAPAIEmbeddingSettings,
  SAPAIModelSettings,
  SAPAISettings,
} from "./sap-ai-settings.js";

import { deepMerge } from "./deep-merge.js";
import { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error.js";

/**
 * Type guard for Foundation Models API settings.
 * @param settings - Settings to check.
 * @returns True if settings are for Foundation Models API.
 */
export function isFoundationModelsSettings(
  settings: SAPAIModelSettings | SAPAISettings,
): settings is FoundationModelsModelSettings {
  return settings.api === "foundation-models";
}

/**
 * Type guard for Orchestration API settings.
 * @param settings - Settings to check.
 * @returns True if settings are for Orchestration API.
 */
export function isOrchestrationSettings(
  settings: SAPAIModelSettings | SAPAISettings,
): settings is OrchestrationModelSettings {
  return settings.api === undefined || settings.api === "orchestration";
}

/**
 * Validates escapeTemplatePlaceholders option based on API type.
 *
 * Jinja2 template escaping is only supported by the Orchestration API.
 * @param api - SAP AI API type.
 * @param escapeTemplatePlaceholders - Whether to escape template placeholders.
 * @throws {UnsupportedFeatureError} When escapeTemplatePlaceholders is true with Foundation Models API.
 * @internal
 */
function validateEscapeTemplatePlaceholders(
  api: SAPAIApiType,
  escapeTemplatePlaceholders: boolean | undefined,
): void {
  if (api === "foundation-models" && escapeTemplatePlaceholders === true) {
    throw new UnsupportedFeatureError(
      ESCAPE_TEMPLATE_PLACEHOLDERS_DESCRIPTION,
      "foundation-models",
      "orchestration",
    );
  }
}

/**
 * Validates that Foundation Models-only options are not used with Orchestration API.
 *
 * Foundation Models-only features:
 * - `dataSources` - Azure On Your Data configuration
 * @param settings - Settings to validate.
 * @throws {UnsupportedFeatureError} When dataSources is set with Orchestration API.
 * @internal
 */
function validateFoundationModelsOnlyOptions(
  settings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (!settings) return;

  const fmSettings = settings as FoundationModelsModelSettings;

  for (const feature of FOUNDATION_MODELS_ONLY_FEATURE_KEYS) {
    if (fmSettings[feature] !== undefined) {
      throw new UnsupportedFeatureError(
        FOUNDATION_MODELS_ONLY_FEATURES[feature],
        "orchestration",
        "foundation-models",
      );
    }
  }
}

/**
 * Validates that Orchestration-only embedding options are not used with Foundation Models API.
 *
 * Orchestration-only embedding features:
 * - `masking` - Data masking module
 * @param settings - Embedding settings to validate.
 * @throws {UnsupportedFeatureError} When masking is set with Foundation Models API.
 * @internal
 */
function validateOrchestrationOnlyEmbeddingOptions(
  settings: SAPAIEmbeddingSettings | undefined,
): void {
  if (!settings) return;

  for (const feature of ORCHESTRATION_ONLY_EMBEDDING_FEATURE_KEYS) {
    if (settings[feature] !== undefined) {
      throw new UnsupportedFeatureError(
        ORCHESTRATION_ONLY_EMBEDDING_FEATURES[feature],
        "foundation-models",
        "orchestration",
      );
    }
  }
}

/**
 * Validates that Orchestration-only options are not used with Foundation Models API.
 *
 * Orchestration-only features:
 * - `filtering` - Content filtering module
 * - `grounding` - Document grounding module
 * - `masking` - Data masking module
 * - `orchestrationConfigRef` - Prompt Registry configuration reference
 * - `placeholderValues` - Jinja2 template placeholder values
 * - `promptTemplateRef` - Prompt Registry template reference
 * - `tools` - SAP-format tool definitions (use AI SDK tools instead)
 * - `translation` - Translation module
 * @param settings - Settings to validate.
 * @throws {UnsupportedFeatureError} When any Orchestration-only feature is set with Foundation Models API.
 * @internal
 */
function validateOrchestrationOnlyOptions(
  settings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (!settings) return;

  const orchSettings = settings as OrchestrationModelSettings;

  for (const feature of ORCHESTRATION_ONLY_FEATURE_KEYS) {
    if (orchSettings[feature] !== undefined) {
      throw new UnsupportedFeatureError(
        ORCHESTRATION_ONLY_FEATURES[feature],
        "foundation-models",
        "orchestration",
      );
    }
  }
}

/**
 * Keys for Orchestration-only features.
 * @internal
 */
const ORCHESTRATION_ONLY_FEATURE_KEYS = [
  "filtering",
  "grounding",
  "masking",
  "orchestrationConfigRef",
  "placeholderValues",
  "promptTemplateRef",
  "streamOptions",
  "tools",
  "translation",
] as const;

/**
 * Mapping of Orchestration-only feature keys to human-readable descriptions.
 * Used for generating consistent error messages.
 * @internal
 */
const ORCHESTRATION_ONLY_FEATURES: Readonly<
  Record<(typeof ORCHESTRATION_ONLY_FEATURE_KEYS)[number], string>
> = {
  filtering: "Content filtering",
  grounding: "Document grounding",
  masking: "Data masking",
  orchestrationConfigRef: "Orchestration config reference (orchestrationConfigRef)",
  placeholderValues: "Placeholder values (placeholderValues)",
  promptTemplateRef: "Prompt template reference (promptTemplateRef)",
  streamOptions: "Stream options for post-LLM modules",
  tools: "SAP-format tool definitions (use AI SDK tools instead)",
  translation: "Translation",
} as const;

/**
 * Keys for Foundation Models-only features.
 * @internal
 */
const FOUNDATION_MODELS_ONLY_FEATURE_KEYS = ["dataSources"] as const;

/**
 * Mapping of Foundation Models-only feature keys to human-readable descriptions.
 * Used for generating consistent error messages.
 * @internal
 */
const FOUNDATION_MODELS_ONLY_FEATURES: Readonly<
  Record<(typeof FOUNDATION_MODELS_ONLY_FEATURE_KEYS)[number], string>
> = {
  dataSources: "Azure On Your Data (dataSources)",
} as const;

/**
 * Subset of Orchestration-only features that can be set at invocation level.
 * @internal
 */
const ORCHESTRATION_ONLY_INVOCATION_FEATURE_KEYS = [
  "orchestrationConfigRef",
  "placeholderValues",
  "promptTemplateRef",
] as const;

/**
 * Keys for Orchestration-only embedding features.
 * @internal
 */
const ORCHESTRATION_ONLY_EMBEDDING_FEATURE_KEYS = ["masking"] as const;

/**
 * Mapping of Orchestration-only embedding feature keys to human-readable descriptions.
 * Uses the same descriptions as the main ORCHESTRATION_ONLY_FEATURES for consistency.
 * @internal
 */
const ORCHESTRATION_ONLY_EMBEDDING_FEATURES: Readonly<
  Record<(typeof ORCHESTRATION_ONLY_EMBEDDING_FEATURE_KEYS)[number], string>
> = {
  masking: ORCHESTRATION_ONLY_FEATURES.masking,
} as const;

/**
 * Human-readable description for escapeTemplatePlaceholders feature.
 * Used for generating consistent error messages.
 * @internal
 */
const ESCAPE_TEMPLATE_PLACEHOLDERS_DESCRIPTION =
  "escapeTemplatePlaceholders (Jinja2 template escaping)";

/**
 * Validates that switching APIs at invocation time is allowed.
 *
 * API switching is blocked when the model was configured with features
 * that are specific to one API and incompatible with the target API.
 * @param fromApi - Source API type (configured at model creation).
 * @param toApi - Target API type (requested at invocation time).
 * @param modelSettings - Model settings to validate for conflicts.
 * @throws {ApiSwitchError} When the model has features incompatible with the target API.
 * @internal
 */
function validateApiSwitch(
  fromApi: SAPAIApiType,
  toApi: SAPAIApiType,
  modelSettings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (fromApi === toApi) return;
  if (!modelSettings) return;

  if (fromApi === "orchestration" && toApi === "foundation-models") {
    const orchSettings = modelSettings as OrchestrationModelSettings;

    for (const feature of ORCHESTRATION_ONLY_FEATURE_KEYS) {
      if (orchSettings[feature] !== undefined) {
        throw new ApiSwitchError(fromApi, toApi, feature);
      }
    }
  }

  if (fromApi === "foundation-models" && toApi === "orchestration") {
    const fmSettings = modelSettings as FoundationModelsModelSettings;

    for (const feature of FOUNDATION_MODELS_ONLY_FEATURE_KEYS) {
      if (fmSettings[feature] !== undefined) {
        throw new ApiSwitchError(fromApi, toApi, feature);
      }
    }
  }
}

/**
 * @internal
 */
const VALID_API_TYPES: readonly SAPAIApiType[] = ["orchestration", "foundation-models"];

/** Options for the main validation function. */
export interface ValidateSettingsOptions {
  readonly api: SAPAIApiType;
  readonly embeddingSettings?: SAPAIEmbeddingSettings;
  readonly invocationSettings?: {
    readonly api?: SAPAIApiType;
    readonly escapeTemplatePlaceholders?: boolean;
    readonly orchestrationConfigRef?: unknown;
    readonly placeholderValues?: unknown;
    readonly promptTemplateRef?: unknown;
  };
  readonly modelApi?: SAPAIApiType;
  readonly modelSettings?: SAPAIModelSettings | SAPAISettings;
}

/**
 * Gets the effective escapeTemplatePlaceholders value based on API and settings.
 * @param api - SAP AI API type.
 * @param modelSettings - Model settings.
 * @param invocationEscape - Invocation-level escape setting.
 * @returns Effective escapeTemplatePlaceholders value.
 */
export function getEffectiveEscapeTemplatePlaceholders(
  api: SAPAIApiType,
  modelSettings: SAPAIModelSettings | SAPAISettings | undefined,
  invocationEscape: boolean | undefined,
): boolean {
  if (api === "foundation-models") {
    return false;
  }

  if (invocationEscape !== undefined) {
    return invocationEscape;
  }

  const modelValue = (modelSettings as OrchestrationModelSettings | undefined)
    ?.escapeTemplatePlaceholders;
  if (modelValue !== undefined) {
    return modelValue;
  }

  return true;
}

/**
 * Merges settings with proper API precedence (callSettings > defaultSettings > fallbackApi).
 * @param defaultSettings - Provider-level default settings.
 * @param callSettings - Per-call settings that override defaults.
 * @param fallbackApi - Fallback API type when neither settings specify one.
 * @returns Merged settings with correct API precedence.
 * @internal
 */
export function mergeSettingsWithApi<T extends { api?: string }>(
  defaultSettings: Record<string, unknown> | undefined,
  callSettings: Partial<T>,
  fallbackApi: string,
): T {
  return {
    ...deepMerge(defaultSettings, callSettings as Record<string, unknown>),
    api: callSettings.api ?? (defaultSettings?.api as string | undefined) ?? fallbackApi,
  } as T;
}

/**
 * Resolves the effective API type using the full precedence chain.
 * @param providerApi - Provider-level API type.
 * @param modelApi - Model-level API type.
 * @param invocationApi - Invocation-level API type.
 * @returns Resolved API type.
 */
export function resolveApi(
  providerApi: SAPAIApiType | undefined,
  modelApi: SAPAIApiType | undefined,
  invocationApi: SAPAIApiType | undefined,
): SAPAIApiType {
  return invocationApi ?? modelApi ?? providerApi ?? "orchestration";
}

/**
 * Validates that the API value is a valid SAPAIApiType.
 * @param api - API value to validate.
 */
export function validateApiInput(api: unknown): void {
  if (api === undefined) return;

  if (typeof api !== "string" || !VALID_API_TYPES.includes(api as SAPAIApiType)) {
    throw new Error(
      `Invalid API type: ${JSON.stringify(api)}. ` +
        `Valid values are: ${VALID_API_TYPES.map((t) => `"${t}"`).join(", ")}`,
    );
  }
}

/**
 * Main validation function that performs all API-specific validations.
 *
 * This function orchestrates all validation checks:
 * 1. Validates API type inputs
 * 2. Checks for API switching conflicts
 * 3. Validates API-specific feature usage
 * 4. Validates template placeholder escaping
 * @param options - Validation options.
 * @throws {Error} When an invalid API type is provided.
 * @throws {ApiSwitchError} When attempting to switch APIs with incompatible settings.
 * @throws {UnsupportedFeatureError} When using features not supported by the current API.
 * @see {@link ApiSwitchError}
 * @see {@link UnsupportedFeatureError}
 */
export function validateSettings(options: ValidateSettingsOptions): void {
  const { api, embeddingSettings, invocationSettings, modelApi, modelSettings } = options;

  validateApiInput(api);
  if (invocationSettings?.api !== undefined) {
    validateApiInput(invocationSettings.api);
  }

  if (invocationSettings?.api !== undefined) {
    const effectiveModelApi = modelApi ?? "orchestration";
    if (effectiveModelApi !== invocationSettings.api) {
      validateApiSwitch(effectiveModelApi, invocationSettings.api, modelSettings);
    }
  }

  if (api === "foundation-models") {
    validateOrchestrationOnlyOptions(modelSettings);
    validateOrchestrationOnlyInvocationOptions(invocationSettings);
    validateOrchestrationOnlyEmbeddingOptions(embeddingSettings);
  } else {
    validateFoundationModelsOnlyOptions(modelSettings);
  }

  const modelEscape = (modelSettings as OrchestrationModelSettings | undefined)
    ?.escapeTemplatePlaceholders;
  const invocationEscape = invocationSettings?.escapeTemplatePlaceholders;
  const effectiveEscape = invocationEscape ?? modelEscape;
  validateEscapeTemplatePlaceholders(api, effectiveEscape);
}

/**
 * Validates that Orchestration-only options are not passed at invocation level with Foundation Models API.
 * @param invocationSettings - Invocation-level settings to validate.
 * @throws {UnsupportedFeatureError} When any Orchestration-only feature is set at invocation level.
 * @internal
 */
function validateOrchestrationOnlyInvocationOptions(
  invocationSettings: ValidateSettingsOptions["invocationSettings"],
): void {
  if (!invocationSettings) return;

  for (const feature of ORCHESTRATION_ONLY_INVOCATION_FEATURE_KEYS) {
    if (invocationSettings[feature] !== undefined) {
      throw new UnsupportedFeatureError(
        ORCHESTRATION_ONLY_FEATURES[feature],
        "foundation-models",
        "orchestration",
      );
    }
  }
}
