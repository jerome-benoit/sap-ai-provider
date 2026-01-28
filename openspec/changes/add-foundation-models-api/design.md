# Design: Foundation Models API Support

## Context

The SAP AI SDK provides two distinct APIs for AI model access:

1. **Orchestration API** (`@sap-ai-sdk/orchestration`) - Full enterprise features with orchestration modules
2. **Foundation Models API** (`@sap-ai-sdk/foundation-models`) - Direct Azure OpenAI access with lower latency

This design document specifies the detailed architecture for supporting both APIs while maintaining backward compatibility.

## SDK Dependencies

### Required Packages

Both SAP AI SDK packages are **runtime dependencies** (not peer dependencies) to ensure type availability and consistent versioning:

```json
{
  "dependencies": {
    "@sap-ai-sdk/orchestration": "^2.5.0",
    "@sap-ai-sdk/foundation-models": "^2.5.0"
  }
}
```

### Type Reuse Strategy

**Principle**: Maximize reuse of types from both SDKs instead of creating custom/placeholder types.

#### From `@sap-ai-sdk/orchestration`

Already used for Orchestration API types:

- `FilteringModule`, `GroundingModule`, `MaskingModule`, `TranslationModule`
- `ChatCompletionTool`, `ChatModel`
- `OrchestrationClient`, `OrchestrationEmbeddingClient`

#### From `@sap-ai-sdk/foundation-models`

Used for Foundation Models API types:

| SDK Type                                           | Usage                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `AzureOpenAiChatClient`                            | Chat completions client                                               |
| `AzureOpenAiEmbeddingClient`                       | Embeddings client                                                     |
| `AzureOpenAiChatCompletionParameters`              | Request parameters (extends `AzureOpenAiCreateChatCompletionRequest`) |
| `AzureOpenAiEmbeddingParameters`                   | Embedding request parameters                                          |
| `AzureOpenAiAzureChatExtensionConfiguration`       | Data sources ("On Your Data")                                         |
| `AzureOpenAiChatCompletionRequestMessage`          | Message union type                                                    |
| `AzureOpenAiChatCompletionRequestSystemMessage`    | System message                                                        |
| `AzureOpenAiChatCompletionRequestUserMessage`      | User message                                                          |
| `AzureOpenAiChatCompletionRequestAssistantMessage` | Assistant message                                                     |
| `AzureOpenAiChatCompletionRequestToolMessage`      | Tool result message                                                   |
| `AzureOpenAiChatCompletionTool`                    | Tool definition                                                       |
| `AzureOpenAiFunctionObject`                        | Function definition                                                   |
| `AzureOpenAiChatCompletionResponse`                | Response wrapper                                                      |
| `AzureOpenAiEmbeddingResponse`                     | Embedding response wrapper                                            |
| `AzureOpenAiChatCompletionStreamResponse`          | Streaming response                                                    |

#### Type Re-exports

Re-export SDK types for user convenience:

```typescript
// src/sap-ai-settings.ts - Foundation Models types
export type { AzureOpenAiAzureChatExtensionConfiguration, AzureOpenAiChatCompletionParameters, AzureOpenAiEmbeddingParameters, AzureOpenAiChatCompletionTool, AzureOpenAiFunctionObject } from "@sap-ai-sdk/foundation-models";
```

### Lazy Loading Consideration

Although both packages are dependencies, they are imported **dynamically** at runtime to avoid loading unused code:

```typescript
// Only loaded when api === "foundation-models"
const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");

// Only loaded when api === "orchestration" (default)
const { OrchestrationClient } = await import("@sap-ai-sdk/orchestration");
```

This ensures:

- Zero bundle impact when using only one API
- Types are available at compile time from both packages
- Runtime code is loaded on-demand

## Goals / Non-Goals

### Goals

- Support both APIs via a single provider interface
- Maintain 100% backward compatibility (existing code unchanged)
- Provide clear, actionable error messages for unsupported feature combinations
- Zero-cost abstraction via lazy loading (only load the SDK package in use)
- Type-safe API-specific options with compile-time checking
- **Support API override at invocation time via `providerOptions`**

### Non-Goals

- Automatic API selection based on features used (explicit selection required)
- Cross-API feature emulation (e.g., no filtering emulation for Foundation Models)
- Support for non-Azure models via Foundation Models API (Azure OpenAI only)

## Critical Design Consideration: API Selection Timing

### The Problem

The Vercel AI SDK allows overriding settings at multiple points:

1. **Provider creation**: `createSAPAIProvider({ api: 'orchestration' })`
2. **Model creation**: `provider('gpt-4o', { api: 'foundation-models' })`
3. **Invocation time**: `generateText({ model, providerOptions: { 'sap-ai': { api: 'orchestration' } } })`

The API selection can change at ANY of these points, including at invocation time. This means we CANNOT pre-create the strategy/client at model instantiation time.

### Solution: Late-Binding Strategy Resolution

The strategy must be resolved **at invocation time** (`doGenerate`/`doStream`/`doEmbed`), not at model creation time.

```typescript
class SAPAILanguageModel implements LanguageModelV3 {
  // Store configuration, NOT the strategy
  private readonly providerApi: SAPAIApiType | undefined;
  private readonly modelApi: SAPAIApiType | undefined;
  private readonly settings: SAPAISettings;
  private readonly config: SAPAILanguageModelConfig;

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    // 1. Parse providerOptions to get potential API override
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    // 2. Resolve final API with full precedence chain
    const api = resolveApi(
      this.providerApi, // Provider-level default
      this.modelApi, // Model-level setting
      sapOptions?.api, // Invocation-time override (highest priority)
    );

    // 3. Merge settings with correct precedence
    const effectiveSettings = mergeSettingsForApi(api, this.settings, sapOptions);

    // 4. Validate settings against the resolved API
    validateSettings(api, effectiveSettings);

    // 5. Create strategy for the resolved API (lazy loading)
    const strategy = await createLanguageModelStrategy(api, this.config);

    // 6. Execute with the strategy
    return strategy.doGenerate(effectiveSettings, options);
  }
}
```

### API Resolution Precedence (Highest to Lowest)

```typescript
function resolveApi(
  providerApi: SAPAIApiType | undefined, // From createSAPAIProvider()
  modelApi: SAPAIApiType | undefined, // From provider('model', { api })
  invocationApi: SAPAIApiType | undefined, // From providerOptions at call time
): SAPAIApiType {
  // Invocation-time override has HIGHEST priority
  if (invocationApi !== undefined) {
    return invocationApi;
  }
  // Model-level overrides provider-level
  if (modelApi !== undefined) {
    return modelApi;
  }
  // Provider-level default
  if (providerApi !== undefined) {
    return providerApi;
  }
  // System default for backward compatibility
  return "orchestration";
}
```

### Settings Merge Strategy

Settings must also be merged with correct precedence, and API-specific options must be filtered based on the resolved API.

**Merge Precedence (lowest to highest):**

1. Provider-level `defaultSettings` (merged at model creation time)
2. Model-level settings (from `provider('model', { ... })`)
3. Invocation-time `providerOptions['sap-ai']`

**Note:** Provider defaults are already merged into `modelSettings` during model creation, so `mergeSettingsForApi` only handles model → invocation merge.

```typescript
// Deep merge implementation - used for nested objects like modelParams
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideValue = override[key];
    // null explicitly overrides (user wants to clear the value)
    if (overrideValue === null) {
      result[key] = null as T[keyof T];
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue as T[keyof T];
    }
    // undefined is ignored (key not specified, keep base value)
  }
  return result;
}

function mergeSettingsForApi(api: SAPAIApiType, modelSettings: SAPAISettings, invocationOptions: SAPAIProviderOptions | undefined): EffectiveSettings {
  // Base settings from model creation (already includes provider defaults)
  // IMPORTANT: Create shallow copy to avoid mutating original settings
  const merged = { ...modelSettings };

  // Apply invocation-time overrides
  if (invocationOptions) {
    // Note: invocationOptions.api is used for API resolution, NOT stored in settings

    // Common options - always merge
    if (invocationOptions.modelParams) {
      merged.modelParams = deepMerge(merged.modelParams ?? {}, invocationOptions.modelParams);
    }
    if (invocationOptions.includeReasoning !== undefined) {
      merged.includeReasoning = invocationOptions.includeReasoning;
    }

    // API-specific options - only merge if API matches
    if (api === "orchestration") {
      if (invocationOptions.escapeTemplatePlaceholders !== undefined) {
        merged.escapeTemplatePlaceholders = invocationOptions.escapeTemplatePlaceholders;
      }
      // Note: filtering, masking, grounding, translation are NOT overridable at invocation time
      // (they require model re-creation)
    }
    // Foundation Models has no special per-call options currently
  }

  return merged;
}
```

## Architecture

### Strategy Pattern with Lazy Loading and Late Binding

Strategies are **stateless** - they hold only a reference to the SDK client class, not tenant-specific
configuration. All configuration (credentials, deployment, destination) flows through method parameters.

```typescript
interface LanguageModelAPIStrategy {
  // config contains tenant-specific info (deploymentId, destination, resourceGroup)
  // settings contains merged model settings
  // options contains Vercel AI SDK call options
  doGenerate(config: SAPAILanguageModelConfig, settings: EffectiveSettings, options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult>;

  doStream(config: SAPAILanguageModelConfig, settings: EffectiveSettings, options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult>;
}

interface EmbeddingModelAPIStrategy {
  doEmbed(config: SAPAIEmbeddingModelConfig, settings: EffectiveEmbeddingSettings, options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result>;
}
```

### Lazy Loading with Caching

To avoid re-importing on every call, we cache the strategy instances per API type.

**CRITICAL SECURITY DESIGN**: Strategies MUST be **stateless** and MUST NOT capture provider/tenant-specific
configuration (credentials, endpoints, deploymentId, destination). All such configuration MUST be passed
to each `doGenerate`/`doStream`/`doEmbed` call. This prevents cross-tenant credential leakage in multi-tenant
or multi-account setups.

```typescript
// Module-level cache for strategy PROMISES (not results) - prevents race conditions
// CRITICAL: Cache the Promise synchronously before any await to prevent duplicate imports
// SECURITY: Cache key is API type only - strategies are stateless, config passed per-call
const strategyPromiseCache = new Map<SAPAIApiType, Promise<LanguageModelAPIStrategy>>();

function getOrCreateStrategy(api: SAPAIApiType): Promise<LanguageModelAPIStrategy> {
  // Cache key is just the API type - strategies are stateless and API-specific
  // IMPORTANT: Provider/tenant-specific config MUST be passed to each doGenerate/doStream
  // call and MUST NOT be captured in the strategy instance itself.
  if (!strategyPromiseCache.has(api)) {
    // IMPORTANT: Set the promise SYNCHRONOUSLY before any await
    // This prevents race conditions where concurrent requests both create strategies
    strategyPromiseCache.set(api, createLanguageModelStrategy(api));
  }
  return strategyPromiseCache.get(api)!;
}

async function createLanguageModelStrategy(api: SAPAIApiType): Promise<LanguageModelAPIStrategy> {
  try {
    if (api === "foundation-models") {
      const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
      // Strategy MUST NOT capture tenant-specific config; it receives config per call instead.
      return new FoundationModelsLanguageModelStrategy(AzureOpenAiChatClient);
    }
    const { OrchestrationClient } = await import("@sap-ai-sdk/orchestration");
    // Strategy MUST NOT capture tenant-specific config; it receives config per call instead.
    return new OrchestrationLanguageModelStrategy(OrchestrationClient);
  } catch (error) {
    // If import fails, remove from cache so next attempt can retry
    strategyPromiseCache.delete(api);

    // Provide clear error message for missing SDK
    if (error instanceof Error && error.message.includes("Cannot find module")) {
      const packageName = api === "foundation-models" ? "@sap-ai-sdk/foundation-models" : "@sap-ai-sdk/orchestration";
      throw new Error(`Failed to load ${packageName}. Please install it: npm install ${packageName}`);
    }
    throw error;
  }
}
```

**Why cache Promises instead of results:**

1. **Race condition prevention**: If two concurrent requests trigger strategy creation for the same API, caching the result would cause both to `await createLanguageModelStrategy()`, importing the SDK twice. By caching the Promise synchronously, the second request immediately gets the same Promise.

2. **Error recovery**: If the import fails, we delete the cached Promise so subsequent requests can retry. This handles transient errors gracefully.

3. **Memory efficiency**: We only keep one Promise per API type, and Promises resolve to the same strategy instance.

4. **Security**: Strategies are stateless - they only hold a reference to the SDK client class, not credentials or deployment config. All tenant-specific configuration flows through method parameters.

### Strategy Lifecycle

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API Selection Flow                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  createSAPAIProvider({ api: 'X' })                                          │
│         │                                                                    │
│         ▼                                                                    │
│  ┌─────────────────────┐                                                    │
│  │ Store providerApi   │  (api='X' stored, no strategy created yet)        │
│  └─────────────────────┘                                                    │
│         │                                                                    │
│         ▼                                                                    │
│  provider('gpt-4o', { api: 'Y' })                                           │
│         │                                                                    │
│         ▼                                                                    │
│  ┌─────────────────────┐                                                    │
│  │ Store modelApi      │  (api='Y' stored, STILL no strategy)              │
│  │ Store settings      │                                                    │
│  └─────────────────────┘                                                    │
│         │                                                                    │
│         ▼                                                                    │
│  generateText({ providerOptions: { 'sap-ai': { api: 'Z' } } })             │
│         │                                                                    │
│         ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────┐                │
│  │  doGenerate() / doStream()                              │                │
│  │                                                          │                │
│  │  1. Parse providerOptions → invocationApi = 'Z'         │                │
│  │  2. resolveApi(X, Y, Z) → finalApi = 'Z'                │                │
│  │  3. mergeSettings(modelSettings, sapOptions)            │                │
│  │  4. validateSettings(finalApi, mergedSettings)          │                │
│  │  5. getOrCreateStrategy(finalApi, config)  ← LAZY LOAD  │                │
│  │  6. strategy.doGenerate(settings, options)              │                │
│  └─────────────────────────────────────────────────────────┘                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Type System

### API Type

```typescript
type SAPAIApiType = "orchestration" | "foundation-models";
```

### Provider Options Schema (Invocation-time)

```typescript
// Schema for providerOptions['sap-ai'] at invocation time
const sapAILanguageModelProviderOptions = z.object({
  // API override at invocation time
  api: z.enum(["orchestration", "foundation-models"]).optional(),

  // Common options (both APIs)
  modelParams: modelParamsSchema.optional(),
  includeReasoning: z.boolean().optional(),

  // Orchestration-only option (validated at runtime)
  escapeTemplatePlaceholders: z.boolean().optional(),
});

type SAPAILanguageModelProviderOptions = z.infer<typeof sapAILanguageModelProviderOptions>;
```

### Discriminated Union for Provider Settings

```typescript
interface OrchestrationProviderSettings {
  api?: "orchestration"; // Default, optional
  defaultSettings?: OrchestrationModelSettings;
}

interface FoundationModelsProviderSettings {
  api: "foundation-models"; // Required discriminant
  defaultSettings?: FoundationModelsModelSettings;
}

type SAPAIProviderSettings = OrchestrationProviderSettings | FoundationModelsProviderSettings;
```

### Discriminated Union for Model Settings

```typescript
// Import SDK types
import type { FilteringModule, GroundingModule, MaskingModule, TranslationModule, ChatCompletionTool } from "@sap-ai-sdk/orchestration";
import type { AzureOpenAiAzureChatExtensionConfiguration } from "@sap-ai-sdk/foundation-models";

interface OrchestrationModelSettings {
  api?: "orchestration";
  // === Orchestration-Only Options ===
  escapeTemplatePlaceholders?: boolean;
  filtering?: FilteringModule; // From @sap-ai-sdk/orchestration
  grounding?: GroundingModule; // From @sap-ai-sdk/orchestration
  masking?: MaskingModule; // From @sap-ai-sdk/orchestration
  translation?: TranslationModule; // From @sap-ai-sdk/orchestration
  tools?: ChatCompletionTool[]; // From @sap-ai-sdk/orchestration
  // === Common Options ===
  modelParams?: OrchestrationModelParams;
  modelVersion?: string;
  responseFormat?: ResponseFormat;
  includeReasoning?: boolean;
}

interface FoundationModelsModelSettings {
  api: "foundation-models";
  // === Foundation Models-Only Options ===
  dataSources?: AzureOpenAiAzureChatExtensionConfiguration[]; // From @sap-ai-sdk/foundation-models
  // === Common Options ===
  modelParams?: FoundationModelsModelParams;
  modelVersion?: string;
  responseFormat?: ResponseFormat;
  includeReasoning?: boolean;
}

type SAPAIModelSettings = OrchestrationModelSettings | FoundationModelsModelSettings;
```

### Model Parameters by API

Model parameters leverage the SDK types where possible. The `AzureOpenAiCreateChatCompletionRequest` from Foundation Models SDK defines all available parameters.

```typescript
// Common parameters (both APIs) - subset of AzureOpenAiCreateChatCompletionRequest
interface CommonModelParams {
  temperature?: number; // Maps to AzureOpenAiCreateChatCompletionRequest.temperature
  maxTokens?: number; // Maps to AzureOpenAiCreateChatCompletionRequest.max_tokens
  topP?: number; // Maps to AzureOpenAiCreateChatCompletionRequest.top_p
  frequencyPenalty?: number; // Maps to AzureOpenAiCreateChatCompletionRequest.frequency_penalty
  presencePenalty?: number; // Maps to AzureOpenAiCreateChatCompletionRequest.presence_penalty
  n?: number; // Maps to AzureOpenAiCreateChatCompletionRequest.n
  parallel_tool_calls?: boolean;
  [key: string]: unknown; // Index signature for deep merge compatibility
}

// Orchestration-specific parameters (no additional params exposed by SAP SDK)
interface OrchestrationModelParams extends CommonModelParams {
  // No additional params currently exposed
}

// Foundation Models-specific parameters - aligned with AzureOpenAiCreateChatCompletionRequest
interface FoundationModelsModelParams extends CommonModelParams {
  logit_bias?: Record<string, number>; // AzureOpenAiCreateChatCompletionRequest.logit_bias
  logprobs?: boolean; // AzureOpenAiCreateChatCompletionRequest.logprobs
  top_logprobs?: number; // AzureOpenAiCreateChatCompletionRequest.top_logprobs
  seed?: number; // AzureOpenAiCreateChatCompletionRequest.seed
  stop?: string | string[]; // AzureOpenAiCreateChatCompletionRequest.stop
  user?: string; // AzureOpenAiCreateChatCompletionRequest.user
}

// Embedding parameters - aligned with AzureOpenAiEmbeddingParameters
interface FoundationModelsEmbeddingParams {
  dimensions?: number; // AzureOpenAiEmbeddingParameters.dimensions
  encoding_format?: "float" | "base64"; // AzureOpenAiEmbeddingParameters.encoding_format
  user?: string; // AzureOpenAiEmbeddingParameters.user
}
```

## Validation Logic

### Validation Timing

Validation happens at **invocation time** after the final API is resolved:

```typescript
function validateSettings(api: SAPAIApiType, settings: EffectiveSettings, modelSettings: SAPAIModelSettings, invocationOptions?: SAPAIProviderOptions): void {
  if (api === "foundation-models") {
    // Check model-level Orchestration-only features
    if (settings.filtering) {
      throw new UnsupportedFeatureError("Content filtering", api, "orchestration");
    }
    if (settings.grounding) {
      throw new UnsupportedFeatureError("Grounding", api, "orchestration");
    }
    if (settings.masking) {
      throw new UnsupportedFeatureError("Data masking", api, "orchestration");
    }
    if (settings.translation) {
      throw new UnsupportedFeatureError("Translation", api, "orchestration");
    }

    // Check escapeTemplatePlaceholders - only error if EXPLICITLY set for FM context
    // We must distinguish between:
    // 1. Value inherited from provider defaults (should NOT error - see "API-specific settings apply after merge" scenario)
    // 2. Value explicitly set at model or invocation level for FM (SHOULD error)
    //
    // Solution: Pass raw (unmerged) modelSettings and invocationOptions separately to check
    // explicit usage, rather than relying solely on merged settings.
    const explicitlySetAtInvocation = invocationOptions?.escapeTemplatePlaceholders === true;
    const explicitlySetAtModel = modelSettings.escapeTemplatePlaceholders === true && modelSettings.api === "foundation-models";

    if (explicitlySetAtInvocation || explicitlySetAtModel) {
      throw new UnsupportedFeatureError("Template placeholder escaping", api, "orchestration");
    }
    // Note: escapeTemplatePlaceholders inherited from defaults or explicitly false/undefined is allowed with FM (no-op)
  }

  if (api === "orchestration") {
    if (settings.dataSources) {
      throw new UnsupportedFeatureError("Azure data sources (On Your Data)", api, "foundation-models");
    }
    // FM-only modelParams are silently ignored, not errored
  }
}
```

### Cross-API Switching Validation

When API is overridden at invocation time to a different API than model settings:

```typescript
function validateApiSwitch(resolvedApi: SAPAIApiType, modelSettings: SAPAIModelSettings): void {
  const modelApi = modelSettings.api ?? "orchestration";

  if (resolvedApi !== modelApi) {
    // Switching from Orchestration to Foundation Models
    if (resolvedApi === "foundation-models" && modelApi === "orchestration") {
      // Check if model was configured with Orchestration-only features
      if (modelSettings.filtering) {
        throw new ApiSwitchError("orchestration", "foundation-models", "filtering");
      }
      if (modelSettings.masking) {
        throw new ApiSwitchError("orchestration", "foundation-models", "masking");
      }
      if (modelSettings.grounding) {
        throw new ApiSwitchError("orchestration", "foundation-models", "grounding");
      }
      if (modelSettings.translation) {
        throw new ApiSwitchError("orchestration", "foundation-models", "translation");
      }
    }

    // Switching from Foundation Models to Orchestration
    if (resolvedApi === "orchestration" && modelApi === "foundation-models") {
      if (modelSettings.dataSources) {
        throw new ApiSwitchError("foundation-models", "orchestration", "dataSources");
      }
    }
  }
}
```

## Option Compatibility Matrix

### Language Model Settings

| Option                       | Orchestration | Foundation Models | Overridable at Invocation | Behavior when misused             |
| ---------------------------- | ------------- | ----------------- | ------------------------- | --------------------------------- |
| `api`                        | Yes           | Yes               | **Yes**                   | Switches strategy                 |
| `escapeTemplatePlaceholders` | Yes           | **No**            | **Yes** (Orch only)       | `UnsupportedFeatureError`         |
| `filtering`                  | Yes           | **No**            | No (model-level only)     | `UnsupportedFeatureError`         |
| `grounding`                  | Yes           | **No**            | No (model-level only)     | `UnsupportedFeatureError`         |
| `masking`                    | Yes           | **No**            | No (model-level only)     | `UnsupportedFeatureError`         |
| `translation`                | Yes           | **No**            | No (model-level only)     | `UnsupportedFeatureError`         |
| `tools` (SAP format)         | Yes           | **No**            | No (model-level only)     | Convert to Azure format           |
| `dataSources`                | **No**        | Yes               | No (model-level only)     | `UnsupportedFeatureError`         |
| `modelParams.*` (common)     | Yes           | Yes               | **Yes**                   | Merged with model settings        |
| `modelParams.*` (FM-only)    | **No**        | Yes               | **Yes**                   | Silently ignored in Orchestration |
| `responseFormat`             | Yes           | Yes               | **Yes** (via AI SDK)      | Common                            |
| `includeReasoning`           | Yes           | Yes               | **Yes**                   | Common                            |

### Why Some Options Are Not Overridable at Invocation Time

- **`filtering`, `masking`, `grounding`, `translation`**: These are complex module configurations that affect the entire request pipeline. Allowing them at invocation time would require:
  1. Complex validation logic
  2. Potential for inconsistent state
  3. Performance overhead of re-validating on every call

- **`tools` (SAP format)**: Tool definitions affect the model's understanding of available functions. Changing them mid-conversation could cause confusion.

- **`dataSources`**: Azure On Your Data requires specific deployment configuration that cannot be changed at call time.

## Message Format Conversion

### Unified Message Conversion (Key Finding)

**Both SDKs use structurally identical message formats.** After exhaustive type comparison:

| Message Type     | Orchestration SDK                              | Foundation Models SDK                         | Compatible? |
| ---------------- | ---------------------------------------------- | --------------------------------------------- | ----------- |
| SystemMessage    | `{ role: 'system', content }`                  | Same + `name?` + `& Record<string, any>`      | ✅ Yes      |
| UserMessage      | `{ role: 'user', content }`                    | Same + `name?` + `& Record<string, any>`      | ✅ Yes      |
| AssistantMessage | `{ role: 'assistant', content?, tool_calls? }` | Same + `name?`, `function_call?` (deprecated) | ✅ Yes      |
| ToolMessage      | `{ role: 'tool', tool_call_id, content }`      | Same + `& Record<string, any>`                | ✅ Yes      |

**Only differences** (no runtime impact):

1. FM SDK adds `& Record<string, any>` for extensibility
2. FM SDK has optional `name?: string` on messages (not used)
3. FM SDK has stricter `detail?: 'auto' | 'low' | 'high'` vs Orch `detail?: string`

**Result: Single `convertToSAPMessages()` function works for both APIs.**

### Key Difference: escapeTemplatePlaceholders

The `escapeTemplatePlaceholders` option ONLY applies to Orchestration API:

```typescript
// UNIFIED approach - single existing function for both APIs
function convertMessages(prompt: LanguageModelV3Prompt, api: SAPAIApiType, options: { escapeTemplatePlaceholders?: boolean; includeReasoning?: boolean }) {
  // Single implementation - existing convertToSAPMessages() from src/convert-to-sap-messages.ts
  return convertToSAPMessages(prompt, {
    // Default true for Orchestration (Jinja2 templates), false for FM (no Jinja2)
    escapeTemplatePlaceholders: api === "orchestration" ? (options.escapeTemplatePlaceholders ?? true) : false, // FM never escapes - validated elsewhere
    includeReasoning: options.includeReasoning ?? false,
  });
}
```

No separate `convertToAzureMessages()` function needed - the existing `convertToSAPMessages()` produces output compatible with both APIs.

## Error Handling

### UnsupportedFeatureError

```typescript
class UnsupportedFeatureError extends Error {
  constructor(
    public readonly feature: string,
    public readonly api: SAPAIApiType,
    public readonly suggestedApi: SAPAIApiType,
  ) {
    super(`${feature} is not supported with ${api === "foundation-models" ? "Foundation Models" : "Orchestration"} API. ` + `Use ${suggestedApi === "foundation-models" ? "Foundation Models" : "Orchestration"} API instead.`);
    this.name = "UnsupportedFeatureError";
  }
}
```

### ApiSwitchError

```typescript
class ApiSwitchError extends Error {
  constructor(
    public readonly fromApi: SAPAIApiType,
    public readonly toApi: SAPAIApiType,
    public readonly conflictingFeature: string,
  ) {
    super(`Cannot switch from ${fromApi} to ${toApi} API at invocation time because the model was ` + `configured with ${conflictingFeature}. Create a new model instance instead.`);
    this.name = "ApiSwitchError";
  }
}
```

## Complete doGenerate Flow

```typescript
async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
  // 1. Parse invocation-time provider options
  const providerName = getProviderName(this.config.provider);
  const sapOptions = await parseProviderOptions({
    provider: providerName,
    providerOptions: options.providerOptions,
    schema: sapAILanguageModelProviderOptions,
  });

  // 2. Resolve final API with full precedence chain
  const api = resolveApi(
    this.providerApi,      // From createSAPAIProvider()
    this.modelSettings.api, // From provider('model', { api })
    sapOptions?.api         // From providerOptions (highest priority)
  );

  // 3. Validate API switch if different from model settings
  if (sapOptions?.api !== undefined) {
    validateApiSwitch(api, this.modelSettings);
  }

  // 4. Merge settings with correct precedence
  const effectiveSettings = mergeSettingsForApi(api, this.modelSettings, sapOptions);

  // 5. Validate settings against the resolved API
  validateSettings(api, effectiveSettings, sapOptions);

  // 6. Get or create strategy (lazy loading with caching)
  const strategy = await getOrCreateStrategy(api, this.config);

  // 7. Execute with the strategy
  return strategy.doGenerate(effectiveSettings, options);
}
```

## Risks / Trade-offs

### Risk: Performance Overhead of Late Binding

- **Mitigation**: Strategy caching ensures import() only happens once per API
- **Measurement**: Benchmark first-call vs subsequent-call latency

### Risk: Increased Bundle Size

- **Mitigation**: Lazy loading ensures only the used SDK is loaded at runtime
- **Measurement**: Track bundle size delta in CI

### Risk: Complex Validation Logic

- **Mitigation**: Clear error messages, comprehensive test coverage
- **Documentation**: Detailed compatibility matrix

### Trade-off: API Switching Limitations

- **Decision**: Some options (filtering, masking, etc.) cannot be changed at invocation time
- **Rationale**: These require model re-creation; allowing them would create inconsistent state

## Open Questions

1. **Strategy caching invalidation**: Should we invalidate cache when deployment config changes?
2. **`modelParams.normalize` for embeddings**: Verify if Foundation Models API supports this parameter
3. **Tool calling format strict mode**: Should we expose Azure's `strict` parameter for tool definitions?

## Migration Plan

1. **Phase 1**: Add types, validation, and error classes (non-breaking)
2. **Phase 2**: Implement Strategy Pattern infrastructure with late binding
3. **Phase 3**: Refactor existing Orchestration code to strategy
4. **Phase 4**: Implement Foundation Models strategy
5. **Phase 5**: Add `api` option to providerOptions schema
6. **Phase 6**: Integration and testing
7. **Phase 7**: Documentation and examples

No breaking changes. Existing code continues to work unchanged.
