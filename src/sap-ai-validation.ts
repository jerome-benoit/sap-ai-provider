/**
 * Validation functions for SAP AI API-specific features.
 *
 * Ensures that API-specific options are used correctly and provides clear error messages
 * for API-specific feature misconfigurations.
 */
import type {
  FoundationModelsModelSettings,
  OrchestrationModelSettings,
  SAPAIApiType,
  SAPAIModelSettings,
  SAPAISettings,
} from "./sap-ai-settings.js";

import { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error.js";

/**
 * Type guard to check if settings are for Foundation Models API.
 * @param settings - The settings to check
 * @returns True if settings are for Foundation Models API
 */
export function isFoundationModelsSettings(
  settings: SAPAIModelSettings | SAPAISettings,
): settings is FoundationModelsModelSettings {
  return settings.api === "foundation-models";
}

/**
 * Type guard to check if settings are for Orchestration API.
 * @param settings - The settings to check
 * @returns True if settings are for Orchestration API (api is undefined or "orchestration")
 */
export function isOrchestrationSettings(
  settings: SAPAIModelSettings | SAPAISettings,
): settings is OrchestrationModelSettings {
  return settings.api === undefined || settings.api === "orchestration";
}

/**
 * Validates escapeTemplatePlaceholders option based on API type.
 *
 * Rules:
 * - If api=foundation-models AND escapeTemplatePlaceholders=true explicitly -> throw error
 * - If api=foundation-models AND escapeTemplatePlaceholders=false explicitly -> no-op (allowed)
 * - If api=foundation-models AND escapeTemplatePlaceholders not set -> ignore (no escaping)
 * - If api=orchestration -> default to true, apply escaping
 * @param api - The selected API type
 * @param escapeTemplatePlaceholders - The explicit value (undefined if not set)
 * @throws {UnsupportedFeatureError} If escapeTemplatePlaceholders=true with Foundation Models API
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
 * Throws UnsupportedFeatureError if any Foundation Models-only feature is present.
 * @param settings - The model settings to validate
 * @throws {UnsupportedFeatureError} If Foundation Models-only features are used with Orchestration API
 */
export function validateFoundationModelsOnlyOptions(
  settings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (!settings) return;

  // Type guard: Check if settings could have FM-only options
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
 * Throws UnsupportedFeatureError if any Orchestration-only feature is present.
 * @param settings - The model settings to validate
 * @throws {UnsupportedFeatureError} If Orchestration-only features are used with Foundation Models API
 */
export function validateOrchestrationOnlyOptions(
  settings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  if (!settings) return;

  // Type guard: Check if settings could have orchestration-only options
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
 * Features that are specific to Orchestration API.
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
 * Features that are specific to Foundation Models API.
 * @internal
 */
const FOUNDATION_MODELS_ONLY_FEATURES = ["dataSources"] as const;

/**
 * Validates that switching APIs at invocation time is allowed.
 * Throws ApiSwitchError if the model was configured with features incompatible with the target API.
 * @param fromApi - The API the model was configured with
 * @param toApi - The API being switched to at invocation time
 * @param modelSettings - The model's configured settings
 * @throws {ApiSwitchError} If the model has features incompatible with the target API
 */
export function validateApiSwitch(
  fromApi: SAPAIApiType,
  toApi: SAPAIApiType,
  modelSettings: SAPAIModelSettings | SAPAISettings | undefined,
): void {
  // No switch happening
  if (fromApi === toApi) return;

  // No settings to conflict
  if (!modelSettings) return;

  // Switching from Orchestration to Foundation Models
  if (fromApi === "orchestration" && toApi === "foundation-models") {
    const orchSettings = modelSettings as OrchestrationModelSettings;

    for (const feature of ORCHESTRATION_ONLY_FEATURES) {
      if (orchSettings[feature] !== undefined) {
        throw new ApiSwitchError(fromApi, toApi, feature);
      }
    }
  }

  // Switching from Foundation Models to Orchestration
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
 * Valid API type values.
 * @internal
 */
const VALID_API_TYPES: readonly SAPAIApiType[] = ["orchestration", "foundation-models"];

/**
 * Options for the main validation function.
 */
export interface ValidateSettingsOptions {
  /** The resolved API type to use */
  readonly api: SAPAIApiType;
  /** Invocation-time settings (per-call overrides) */
  readonly invocationSettings?: {
    readonly api?: SAPAIApiType;
    readonly escapeTemplatePlaceholders?: boolean;
  };
  /** The API the model was originally configured with (for switch detection) */
  readonly modelApi?: SAPAIApiType;
  /** Model-level settings (configured at model creation) */
  readonly modelSettings?: SAPAIModelSettings | SAPAISettings;
}

/**
 * Gets the effective escapeTemplatePlaceholders value based on API and settings.
 * @param api - The selected API type
 * @param modelSettings - Model-level settings
 * @param invocationEscape - Invocation-level override
 * @returns The effective value to use for message conversion
 */
export function getEffectiveEscapeTemplatePlaceholders(
  api: SAPAIApiType,
  modelSettings: SAPAIModelSettings | SAPAISettings | undefined,
  invocationEscape: boolean | undefined,
): boolean {
  // Foundation Models API never escapes
  if (api === "foundation-models") {
    return false;
  }

  // Orchestration API: invocation > model > default (true)
  if (invocationEscape !== undefined) {
    return invocationEscape;
  }

  const modelValue = (modelSettings as OrchestrationModelSettings | undefined)
    ?.escapeTemplatePlaceholders;
  if (modelValue !== undefined) {
    return modelValue;
  }

  // Default for Orchestration
  return true;
}

/**
 * Resolves the effective API type using the full precedence chain.
 *
 * Precedence (highest to lowest):
 * 1. Invocation-time override (providerOptions.api)
 * 2. Model-level setting (settings.api at model creation)
 * 3. Provider-level setting (createSAPAIProvider({ api }))
 * 4. System default ('orchestration')
 * @param providerApi - Provider-level API setting
 * @param modelApi - Model-level API setting
 * @param invocationApi - Invocation-time API override
 * @returns The resolved API type to use
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
 * Treats undefined as unset (valid - will use default).
 * @param api - The API value to validate
 * @throws {Error} If the API value is invalid (not undefined and not a valid API type)
 */
export function validateApiInput(api: unknown): void {
  // undefined is valid - means "use default"
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
 * Call this before creating a strategy or making an API call.
 *
 * Validates:
 * 1. API input value is valid
 * 2. API switch is allowed (if invocation-time API differs from model API)
 * 3. API-specific options are compatible with selected API
 * 4. escapeTemplatePlaceholders is valid for selected API
 * @param options - Validation options including API, settings, and context
 * @throws {Error} If API value is invalid
 * @throws {ApiSwitchError} If API switch is not allowed due to conflicting features
 * @throws {UnsupportedFeatureError} If API-specific features are used with wrong API
 */
export function validateSettings(options: ValidateSettingsOptions): void {
  const { api, invocationSettings, modelApi, modelSettings } = options;

  validateApiInput(api);
  if (invocationSettings?.api !== undefined) {
    validateApiInput(invocationSettings.api);
  }

  // Treat modelApi === undefined as "orchestration" (the default) when checking for API switches
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
