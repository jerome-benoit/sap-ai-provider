/** Validation functions for SAP AI API-specific features. */
import type {
  FoundationModelsModelSettings,
  OrchestrationModelSettings,
  SAPAIApiType,
  SAPAIModelSettings,
  SAPAISettings,
} from "./sap-ai-settings.js";

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
 * @see {@link UnsupportedFeatureError}
 */
export function validateEscapeTemplatePlaceholders(
  api: SAPAIApiType,
  escapeTemplatePlaceholders: boolean | undefined,
): void {
  if (api === "foundation-models" && escapeTemplatePlaceholders === true) {
    throw new UnsupportedFeatureError(
      "escapeTemplatePlaceholders (Jinja2 template escaping)",
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
 * @see {@link UnsupportedFeatureError}
 */
export function validateFoundationModelsOnlyOptions(
  settings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (!settings) return;

  const fmSettings = settings as FoundationModelsModelSettings;

  if (fmSettings.dataSources !== undefined) {
    throw new UnsupportedFeatureError(
      "Azure On Your Data (dataSources)",
      "orchestration",
      "foundation-models",
    );
  }
}

/**
 * Validates that Orchestration-only options are not used with Foundation Models API.
 *
 * Orchestration-only features:
 * - `filtering` - Content filtering module
 * - `grounding` - Document grounding module
 * - `masking` - Data masking module
 * - `translation` - Translation module
 * - `tools` - SAP-format tool definitions (use AI SDK tools instead)
 * @param settings - Settings to validate.
 * @throws {UnsupportedFeatureError} When any Orchestration-only feature is set with Foundation Models API.
 * @see {@link UnsupportedFeatureError}
 */
export function validateOrchestrationOnlyOptions(
  settings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (!settings) return;

  const orchSettings = settings as OrchestrationModelSettings;

  if (orchSettings.filtering !== undefined) {
    throw new UnsupportedFeatureError("Content filtering", "foundation-models", "orchestration");
  }

  if (orchSettings.grounding !== undefined) {
    throw new UnsupportedFeatureError("Document grounding", "foundation-models", "orchestration");
  }

  if (orchSettings.masking !== undefined) {
    throw new UnsupportedFeatureError("Data masking", "foundation-models", "orchestration");
  }

  if (orchSettings.translation !== undefined) {
    throw new UnsupportedFeatureError("Translation", "foundation-models", "orchestration");
  }

  if (orchSettings.tools !== undefined) {
    throw new UnsupportedFeatureError(
      "SAP-format tool definitions (use AI SDK tools instead)",
      "foundation-models",
      "orchestration",
    );
  }
}

/**
 * @internal
 */
const ORCHESTRATION_ONLY_FEATURES = [
  "filtering",
  "grounding",
  "masking",
  "translation",
  "tools",
] as const;

/**
 * @internal
 */
const FOUNDATION_MODELS_ONLY_FEATURES = ["dataSources"] as const;

/**
 * Validates that switching APIs at invocation time is allowed.
 *
 * API switching is blocked when the model was configured with features
 * that are specific to one API and incompatible with the target API.
 * @param fromApi - Source API type (configured at model creation).
 * @param toApi - Target API type (requested at invocation time).
 * @param modelSettings - Model settings to validate for conflicts.
 * @throws {ApiSwitchError} When the model has features incompatible with the target API.
 * @see {@link ApiSwitchError}
 */
export function validateApiSwitch(
  fromApi: SAPAIApiType,
  toApi: SAPAIApiType,
  modelSettings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (fromApi === toApi) return;
  if (!modelSettings) return;

  if (fromApi === "orchestration" && toApi === "foundation-models") {
    const orchSettings = modelSettings as OrchestrationModelSettings;

    for (const feature of ORCHESTRATION_ONLY_FEATURES) {
      if (orchSettings[feature] !== undefined) {
        throw new ApiSwitchError(fromApi, toApi, feature);
      }
    }
  }

  if (fromApi === "foundation-models" && toApi === "orchestration") {
    const fmSettings = modelSettings as FoundationModelsModelSettings;

    for (const feature of FOUNDATION_MODELS_ONLY_FEATURES) {
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
  readonly invocationSettings?: {
    readonly api?: SAPAIApiType;
    readonly escapeTemplatePlaceholders?: boolean;
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
  const { api, invocationSettings, modelApi, modelSettings } = options;

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
  } else {
    validateFoundationModelsOnlyOptions(modelSettings);
  }

  const modelEscape = (modelSettings as OrchestrationModelSettings | undefined)
    ?.escapeTemplatePlaceholders;
  const invocationEscape = invocationSettings?.escapeTemplatePlaceholders;
  const effectiveEscape = invocationEscape ?? modelEscape;
  validateEscapeTemplatePlaceholders(api, effectiveEscape);
}
