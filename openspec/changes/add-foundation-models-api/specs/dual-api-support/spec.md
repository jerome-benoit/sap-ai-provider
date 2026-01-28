# Dual API Support

This capability enables users to choose between the SAP AI SDK Orchestration API and Foundation Models API.

## ADDED Requirements

### Requirement: API Selection at Provider Level

The provider SHALL allow users to select the API backend (`orchestration` or `foundation-models`) at provider creation time, defaulting to `orchestration` for backward compatibility.

#### Scenario: Default to Orchestration API

- **GIVEN** no `api` option is specified
- **WHEN** the provider is created with `createSAPAIProvider({})`
- **THEN** all models SHALL use the Orchestration API

#### Scenario: Select Foundation Models API for all models

- **GIVEN** `api: 'foundation-models'` is specified at provider level
- **WHEN** the provider is created with `createSAPAIProvider({ api: 'foundation-models' })`
- **THEN** all models created from this provider SHALL use the Foundation Models API

#### Scenario: Explicit Orchestration API selection

- **GIVEN** `api: 'orchestration'` is explicitly specified
- **WHEN** the provider is created
- **THEN** all models SHALL use the Orchestration API

### Requirement: API Selection at Model Level

The provider SHALL allow users to override the API backend on a per-model basis, taking precedence over provider-level settings.

#### Scenario: Override provider default at model level

- **GIVEN** a provider created with `api: 'orchestration'`
- **WHEN** a model is requested with `provider('gpt-4o', { api: 'foundation-models' })`
- **THEN** that specific model SHALL use the Foundation Models API

#### Scenario: Mixed API usage within same provider

- **GIVEN** a provider created with default settings
- **WHEN** multiple models are created with different `api` options
- **THEN** each model SHALL use its specified API backend independently

### Requirement: API Selection at Invocation Time

The provider SHALL allow users to override the API backend at invocation time via `providerOptions`, enabling dynamic API switching per request.

#### Scenario: Override model API at invocation time

- **GIVEN** a model created with `api: 'orchestration'`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** that specific request SHALL use the Foundation Models API
- **AND** subsequent requests without override SHALL use the model's configured API

#### Scenario: Override provider and model API at invocation time

- **GIVEN** a provider created with `api: 'orchestration'`
- **AND** a model created without explicit `api` option
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** that specific request SHALL use the Foundation Models API

#### Scenario: Invocation override with streaming

- **GIVEN** a model using Orchestration API by default
- **WHEN** `streamText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** the stream SHALL use the Foundation Models API

#### Scenario: No providerOptions defaults to configured API

- **GIVEN** a model created with `api: 'foundation-models'`
- **WHEN** `generateText()` is called without `providerOptions`
- **THEN** the request SHALL use the Foundation Models API

#### Scenario: providerOptions without sap-ai key

- **GIVEN** a model created with `api: 'orchestration'`
- **WHEN** `generateText()` is called with `providerOptions: { 'other-provider': { ... } }`
- **THEN** the request SHALL use the model's configured Orchestration API

#### Scenario: providerOptions with empty sap-ai object

- **GIVEN** a model created with `api: 'foundation-models'`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': {} }`
- **THEN** the request SHALL use the model's configured Foundation Models API
- **AND** no settings SHALL be overridden

#### Scenario: providerOptions with only modelParams (no api override)

- **GIVEN** a model created with `api: 'orchestration'`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { modelParams: { temperature: 0.9 } } }`
- **THEN** the request SHALL use the Orchestration API
- **AND** temperature SHALL be overridden to 0.9

### Requirement: API Resolution Precedence

The provider SHALL resolve the effective API using a strict precedence order: invocation-time override (highest) > model-level setting > provider-level setting > system default (`orchestration`).

#### Scenario: Invocation overrides model and provider

- **GIVEN** a provider created with `api: 'orchestration'`
- **AND** a model created with `api: 'foundation-models'`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'orchestration' } }`
- **THEN** the request SHALL use the Orchestration API (invocation wins)

#### Scenario: Model overrides provider when no invocation override

- **GIVEN** a provider created with `api: 'orchestration'`
- **AND** a model created with `api: 'foundation-models'`
- **WHEN** `generateText()` is called without `providerOptions`
- **THEN** the request SHALL use the Foundation Models API (model wins)

#### Scenario: Provider applies when no model or invocation override

- **GIVEN** a provider created with `api: 'foundation-models'`
- **AND** a model created without explicit `api` option
- **WHEN** `generateText()` is called without `providerOptions`
- **THEN** the request SHALL use the Foundation Models API (provider applies)

#### Scenario: System default when nothing specified

- **GIVEN** a provider created without `api` option
- **AND** a model created without explicit `api` option
- **WHEN** `generateText()` is called without `providerOptions`
- **THEN** the request SHALL use the Orchestration API (system default)

### Requirement: Settings Merge Strategy

The provider SHALL merge settings from provider defaults, model settings, and invocation-time options with correct precedence, where later settings override earlier ones for the same key.

#### Scenario: Model settings override provider defaults

- **GIVEN** a provider created with `defaultSettings: { modelParams: { temperature: 0.5 } }`
- **AND** a model created with `modelParams: { temperature: 0.7 }`
- **WHEN** `generateText()` is called
- **THEN** the effective temperature SHALL be `0.7`

#### Scenario: Invocation options override model settings

- **GIVEN** a model created with `modelParams: { temperature: 0.7 }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { modelParams: { temperature: 0.9 } } }`
- **THEN** the effective temperature SHALL be `0.9`

#### Scenario: Deep merge for nested modelParams

- **GIVEN** a model created with `modelParams: { temperature: 0.7, topP: 0.9 }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { modelParams: { temperature: 0.5 } } }`
- **THEN** the effective settings SHALL be `{ temperature: 0.5, topP: 0.9 }`

#### Scenario: Deep merge with null value override

- **GIVEN** a model created with `modelParams: { temperature: 0.7 }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { modelParams: { temperature: null } } }`
- **THEN** the effective temperature SHALL be `null` (explicit null overrides)

#### Scenario: Deep merge does not modify original settings

- **GIVEN** a model created with `modelParams: { temperature: 0.7 }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { modelParams: { temperature: 0.5 } } }`
- **AND** a second call is made without providerOptions
- **THEN** the second call SHALL use temperature `0.7` (original unchanged)

#### Scenario: Provider defaults merge into model settings

- **GIVEN** a provider created with `defaultSettings: { modelParams: { temperature: 0.5 }, includeReasoning: true }`
- **AND** a model created with `modelParams: { topP: 0.9 }` (no temperature specified)
- **WHEN** `generateText()` is called
- **THEN** the effective settings SHALL include both `temperature: 0.5` and `topP: 0.9` and `includeReasoning: true`

#### Scenario: API-specific settings apply after merge

- **GIVEN** a provider created with `defaultSettings: { escapeTemplatePlaceholders: true }`
- **AND** a model using Orchestration API
- **WHEN** API is switched to Foundation Models at invocation time
- **THEN** `escapeTemplatePlaceholders` SHALL NOT cause an error (it's from defaults, not explicitly set for FM)

### Requirement: API Switch Validation

The provider SHALL validate API switches at invocation time and throw an `ApiSwitchError` when a model configured with API-specific features attempts to switch to an incompatible API.

#### Scenario: Switch from Orchestration with filtering to FM fails

- **GIVEN** a model created with `api: 'orchestration'` and `filtering: { ... }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** an `ApiSwitchError` SHALL be thrown
- **AND** the message SHALL explain that filtering is incompatible with Foundation Models API
- **AND** the message SHALL suggest creating a new model instance

#### Scenario: Switch from Orchestration with masking to FM fails

- **GIVEN** a model created with `api: 'orchestration'` and `masking: { ... }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** an `ApiSwitchError` SHALL be thrown

#### Scenario: Switch from Orchestration with grounding to FM fails

- **GIVEN** a model created with `api: 'orchestration'` and `grounding: { ... }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** an `ApiSwitchError` SHALL be thrown

#### Scenario: Switch from Orchestration with translation to FM fails

- **GIVEN** a model created with `api: 'orchestration'` and `translation: { ... }`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** an `ApiSwitchError` SHALL be thrown

#### Scenario: Switch from FM with dataSources to Orchestration fails

- **GIVEN** a model created with `api: 'foundation-models'` and `dataSources: [...]`
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'orchestration' } }`
- **THEN** an `ApiSwitchError` SHALL be thrown
- **AND** the message SHALL explain that dataSources is incompatible with Orchestration API

#### Scenario: Switch allowed when no conflicting features

- **GIVEN** a model created with `api: 'orchestration'` and only common options
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** the switch SHALL succeed
- **AND** the request SHALL use the Foundation Models API

### Requirement: Lazy Loading of SDK Packages

The provider SHALL only import the SDK package (`@sap-ai-sdk/orchestration` or `@sap-ai-sdk/foundation-models`) when it is actually used, ensuring zero overhead for unused APIs.

#### Scenario: Foundation Models only usage

- **GIVEN** a provider configured with `api: 'foundation-models'`
- **WHEN** the application runs and makes API calls
- **THEN** only `@sap-ai-sdk/foundation-models` SHALL be dynamically imported
- **AND** `@sap-ai-sdk/orchestration` SHALL NOT be loaded

#### Scenario: Orchestration only usage

- **GIVEN** a provider configured with `api: 'orchestration'` (or default)
- **WHEN** the application runs and makes API calls
- **THEN** only `@sap-ai-sdk/orchestration` SHALL be dynamically imported
- **AND** `@sap-ai-sdk/foundation-models` SHALL NOT be loaded

#### Scenario: Both APIs used via invocation override

- **GIVEN** a provider configured with default Orchestration API
- **WHEN** some requests use `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** both SDK packages SHALL be lazily imported as needed
- **AND** subsequent requests to the same API SHALL reuse cached imports

### Requirement: Strategy Caching

The provider SHALL cache strategy instances to avoid repeated dynamic imports and improve performance for subsequent requests.

#### Scenario: Same API reuses cached strategy

- **GIVEN** a model making multiple requests with the same API
- **WHEN** the second request is made
- **THEN** the strategy from the first request SHALL be reused
- **AND** no new dynamic import SHALL occur

#### Scenario: Different APIs have separate cached strategies

- **GIVEN** a model alternating between Orchestration and Foundation Models APIs
- **WHEN** requests are made
- **THEN** each API SHALL have its own cached strategy instance
- **AND** switching APIs SHALL not require re-importing already-loaded SDKs

#### Scenario: Concurrent first requests for same API

- **GIVEN** no strategy is yet cached for Foundation Models API
- **WHEN** two concurrent requests both require Foundation Models API
- **THEN** only ONE dynamic import SHALL occur
- **AND** both requests SHALL use the same strategy instance
- **AND** no race condition SHALL cause duplicate imports

#### Scenario: Strategy creation failure allows retry

- **GIVEN** a strategy creation fails due to transient error
- **WHEN** a subsequent request is made for the same API
- **THEN** the provider SHALL retry strategy creation
- **AND** SHALL not return a cached failed Promise

### Requirement: Concurrent Request Safety

The provider SHALL handle concurrent requests safely, including requests that use different APIs simultaneously.

#### Scenario: Parallel requests with same API

- **GIVEN** a model making multiple concurrent requests
- **WHEN** all requests use the same API
- **THEN** all requests SHALL complete successfully
- **AND** the strategy SHALL be shared safely

#### Scenario: Parallel requests with different APIs

- **GIVEN** a model instance
- **WHEN** two concurrent requests are made, one with Orchestration and one with Foundation Models
- **THEN** both requests SHALL complete successfully
- **AND** each SHALL use its respective API

### Requirement: Type-Safe API-Specific Options

The provider SHALL use discriminated union types to ensure API-specific options are only available for the correct API, with compile-time type checking where possible and runtime validation for all cases.

#### Scenario: Orchestration-specific options with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** the user provides orchestration-specific options (`filtering`, `masking`, `grounding`, `translation`)
- **THEN** the options SHALL be accepted and applied

#### Scenario: Orchestration-specific options rejected with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** the user attempts to use orchestration-specific options (`filtering`, `masking`, `grounding`, `translation`)
- **THEN** the provider SHALL throw an `UnsupportedFeatureError` with a descriptive message
- **AND** the message SHALL explain which API supports the feature

### Requirement: Template Placeholder Escaping Behavior

The `escapeTemplatePlaceholders` option SHALL only be applicable when using the Orchestration API, since Foundation Models API does not use Jinja2 templates.

#### Scenario: Template escaping enabled with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **AND** `escapeTemplatePlaceholders: true` (default)
- **WHEN** messages contain template delimiters (`{{`, `{%`, `{#`)
- **THEN** the delimiters SHALL be escaped with zero-width spaces to prevent template conflicts

#### Scenario: Template escaping disabled with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **AND** `escapeTemplatePlaceholders: false`
- **WHEN** messages contain template delimiters
- **THEN** the delimiters SHALL NOT be escaped (raw pass-through)

#### Scenario: Template escaping ignored with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `escapeTemplatePlaceholders` is not specified
- **THEN** no escaping SHALL be applied (Foundation Models has no Jinja2 templates)

#### Scenario: Template escaping explicitly enabled with Foundation Models API throws error

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `escapeTemplatePlaceholders: true` is explicitly specified
- **THEN** an `UnsupportedFeatureError` SHALL be thrown
- **AND** the message SHALL explain that template escaping is not applicable with Foundation Models API

#### Scenario: Template escaping explicitly disabled with Foundation Models API allowed

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `escapeTemplatePlaceholders: false` is explicitly specified
- **THEN** no error SHALL be thrown
- **AND** no escaping SHALL be applied (no-op)

### Requirement: Chat Completions with Foundation Models API

The provider SHALL support chat completions through the Foundation Models API using `AzureOpenAiChatClient`.

#### Scenario: Basic chat completion

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `generateText()` is called with a prompt
- **THEN** the request SHALL be processed via `AzureOpenAiChatClient`
- **AND** the response SHALL conform to Vercel AI SDK `LanguageModelV3` interface

#### Scenario: Streaming chat completion

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `streamText()` is called with a prompt
- **THEN** the response SHALL stream via `AzureOpenAiChatClient.stream()`
- **AND** chunks SHALL conform to Vercel AI SDK streaming interface

#### Scenario: Tool calling with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** tools are provided in the request
- **THEN** tool calls SHALL be processed via `AzureOpenAiChatClient`
- **AND** tool results SHALL be handled correctly

### Requirement: Embeddings with Foundation Models API

The provider SHALL support text embeddings through the Foundation Models API using `AzureOpenAiEmbeddingClient`.

#### Scenario: Generate embeddings via Foundation Models

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `embed()` is called with text input
- **THEN** the request SHALL be processed via `AzureOpenAiEmbeddingClient`
- **AND** the response SHALL conform to Vercel AI SDK `EmbeddingModelV3` interface

#### Scenario: Embedding type mapping

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `type: 'query'` is specified in embedding settings
- **WHEN** `embed()` is called
- **THEN** the `type` SHALL be mapped to `input_type` parameter in the Foundation Models request

#### Scenario: Embedding API override at invocation time

- **GIVEN** an embedding model created with `api: 'orchestration'`
- **WHEN** `embed()` is called with `providerOptions: { 'sap-ai': { api: 'foundation-models' } }`
- **THEN** the request SHALL use the Foundation Models API

#### Scenario: Embedding dimensions parameter with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `modelParams.dimensions: 256` is specified
- **WHEN** `embed()` is called
- **THEN** the dimensions parameter SHALL be passed to the Foundation Models API
- **AND** embeddings SHALL be returned with the specified dimensions

#### Scenario: Embedding encoding_format with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `modelParams.encoding_format: 'base64'` is specified
- **WHEN** `embed()` is called
- **THEN** the encoding_format parameter SHALL be passed to the Foundation Models API
- **AND** base64-encoded embeddings SHALL be normalized to number arrays in the response

#### Scenario: Embedding user parameter with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `modelParams.user: 'user-123'` is specified
- **WHEN** `embed()` is called
- **THEN** the user identifier SHALL be passed for monitoring purposes

#### Scenario: maxEmbeddingsPerCall applies to Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `maxEmbeddingsPerCall: 100` is configured
- **WHEN** `embed()` is called with more than 100 values
- **THEN** a `TooManyEmbeddingValuesForCallError` SHALL be thrown

### Requirement: Common Model Parameters

The provider SHALL support common model parameters identically across both APIs.

#### Scenario: Temperature parameter with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** `modelParams.temperature: 0.7` is specified
- **THEN** the temperature SHALL be passed to the Orchestration API

#### Scenario: Temperature parameter with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.temperature: 0.7` is specified
- **THEN** the temperature SHALL be passed to the Foundation Models API

#### Scenario: All common parameters supported

- **GIVEN** any `api` selection
- **WHEN** common parameters are specified (`temperature`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`, `n`, `parallel_tool_calls`)
- **THEN** all parameters SHALL be passed to the selected API

### Requirement: Foundation Models-Only Parameters

The provider SHALL support Foundation Models-specific parameters when using that API, and silently ignore them when using Orchestration API.

#### Scenario: Logprobs parameter with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.logprobs: true` is specified
- **THEN** the parameter SHALL be passed to the Foundation Models API
- **AND** log probabilities SHALL be returned in the response

#### Scenario: Logprobs parameter ignored with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** `modelParams.logprobs: true` is specified
- **THEN** the parameter SHALL be silently ignored
- **AND** no error SHALL be thrown

#### Scenario: Stop sequences with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.stop: ['END', 'STOP']` is specified
- **THEN** the stop sequences SHALL be passed to the Foundation Models API

#### Scenario: User identifier with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.user: 'user-123'` is specified
- **THEN** the user identifier SHALL be passed for monitoring purposes

#### Scenario: Seed for deterministic output with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.seed: 42` is specified
- **THEN** the seed SHALL be passed for deterministic sampling

#### Scenario: Logit bias with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.logit_bias: { '1234': -100 }` is specified
- **THEN** the logit bias SHALL be passed to the Foundation Models API

#### Scenario: Top logprobs with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `modelParams.top_logprobs: 5` is specified
- **THEN** the top_logprobs parameter SHALL be passed to the Foundation Models API

### Requirement: Reasoning Content Support

The provider SHALL support the `includeReasoning` option identically across both APIs for models that support reasoning (e.g., o1, o3).

#### Scenario: Include reasoning with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **AND** a reasoning-capable model (e.g., `o1`)
- **WHEN** `includeReasoning: true` is specified
- **THEN** reasoning content SHALL be included in the response

#### Scenario: Include reasoning with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** a reasoning-capable model (e.g., `o1`)
- **WHEN** `includeReasoning: true` is specified
- **THEN** reasoning content SHALL be included in the response

#### Scenario: Include reasoning at invocation time

- **GIVEN** a model without `includeReasoning` configured
- **WHEN** `generateText()` is called with `providerOptions: { 'sap-ai': { includeReasoning: true } }`
- **THEN** reasoning content SHALL be included in the response

### Requirement: Backward Compatibility

The provider SHALL maintain full backward compatibility with existing code that uses the Orchestration API, requiring no changes for users who do not opt into Foundation Models API.

#### Scenario: Existing code works unchanged

- **GIVEN** existing code using `createSAPAIProvider()` without `api` option
- **WHEN** the code is run with the updated provider version
- **THEN** all functionality SHALL work identically to before
- **AND** no deprecation warnings SHALL be emitted

#### Scenario: Orchestration features remain available

- **GIVEN** existing code using filtering, masking, or grounding features
- **WHEN** the code is run with the updated provider version
- **THEN** all orchestration features SHALL continue to work as documented

#### Scenario: Default settings inheritance unchanged

- **GIVEN** a provider created with `defaultSettings` including orchestration options
- **WHEN** models are created without explicit `api` option
- **THEN** the default settings SHALL be applied as before

### Requirement: Clear Error Messages for Unsupported Features

The provider SHALL provide clear, actionable error messages when users attempt to use features not supported by the selected API.

#### Scenario: Filtering with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `filtering` configuration is provided
- **THEN** an `UnsupportedFeatureError` SHALL be thrown
- **AND** the message SHALL contain "Content filtering is not supported with Foundation Models API"
- **AND** the message SHALL suggest using Orchestration API

#### Scenario: Grounding with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `grounding` configuration is provided
- **THEN** an `UnsupportedFeatureError` SHALL be thrown
- **AND** the message SHALL contain "Grounding is not supported with Foundation Models API"
- **AND** the message SHALL suggest using Orchestration API

#### Scenario: Masking with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `masking` configuration is provided
- **THEN** an `UnsupportedFeatureError` SHALL be thrown
- **AND** the message SHALL contain "Data masking is not supported with Foundation Models API"
- **AND** the message SHALL suggest using Orchestration API

#### Scenario: Translation with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `translation` configuration is provided
- **THEN** an `UnsupportedFeatureError` SHALL be thrown
- **AND** the message SHALL contain "Translation is not supported with Foundation Models API"
- **AND** the message SHALL suggest using Orchestration API

#### Scenario: DataSources with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** `dataSources` configuration is provided
- **THEN** an `UnsupportedFeatureError` SHALL be thrown
- **AND** the message SHALL contain "Azure data sources (On Your Data) is not supported with Orchestration API"
- **AND** the message SHALL suggest using Foundation Models API

### Requirement: Input Validation

The provider SHALL validate inputs and provide clear error messages for invalid configurations.

#### Scenario: Invalid API value

- **GIVEN** an invalid `api` value is provided (e.g., `api: 'invalid'`)
- **WHEN** the provider or model is created or invoked
- **THEN** a validation error SHALL be thrown
- **AND** the message SHALL list valid API values (`orchestration`, `foundation-models`)

#### Scenario: Undefined API value treated as unset

- **GIVEN** `api: undefined` is explicitly passed
- **WHEN** the API is resolved
- **THEN** the undefined value SHALL be treated as if `api` was not specified
- **AND** the next level in precedence SHALL apply

### Requirement: SDK Import Error Handling

The provider SHALL handle SDK package import errors gracefully and provide clear error messages.

#### Scenario: Foundation Models SDK not installed

- **GIVEN** `@sap-ai-sdk/foundation-models` is not installed
- **WHEN** a request is made with `api: 'foundation-models'`
- **THEN** a clear error SHALL be thrown
- **AND** the message SHALL indicate the missing package name
- **AND** the message SHALL suggest installing the package

#### Scenario: Orchestration SDK not installed

- **GIVEN** `@sap-ai-sdk/orchestration` is not installed
- **WHEN** a request is made with `api: 'orchestration'`
- **THEN** a clear error SHALL be thrown
- **AND** the message SHALL indicate the missing package name

### Requirement: Message Format Conversion

The provider SHALL convert Vercel AI SDK prompt format to the appropriate message format based on the selected API.

#### Scenario: System message conversion for Orchestration

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** a prompt contains a system message
- **THEN** it SHALL be converted to `ChatMessage` format for Orchestration API

#### Scenario: System message conversion for Foundation Models

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** a prompt contains a system message
- **THEN** it SHALL be converted to `AzureOpenAiChatCompletionRequestSystemMessage` format

#### Scenario: Multi-modal messages with images

- **GIVEN** any `api` selection
- **WHEN** a prompt contains image content
- **THEN** images SHALL be converted to the appropriate format for the selected API

#### Scenario: User message with multiple content parts

- **GIVEN** any `api` selection
- **WHEN** a user message contains both text and image content parts
- **THEN** all content parts SHALL be converted and included in the message

#### Scenario: Assistant message with tool calls

- **GIVEN** any `api` selection
- **WHEN** an assistant message contains tool calls
- **THEN** tool calls SHALL be converted to the appropriate format for the selected API

#### Scenario: Tool result message conversion

- **GIVEN** any `api` selection
- **WHEN** a prompt contains tool result messages
- **THEN** they SHALL be converted to `tool` role messages with correct `tool_call_id`

#### Scenario: Empty message content handling

- **GIVEN** any `api` selection
- **WHEN** a message has empty or whitespace-only content
- **THEN** the message SHALL be included with empty content (not filtered out)

#### Scenario: Reasoning content in assistant messages

- **GIVEN** `includeReasoning: true` is configured
- **AND** the assistant message contains reasoning content
- **WHEN** converting messages
- **THEN** reasoning content SHALL be preserved in the converted format

### Requirement: Tool Definition Format Conversion

The provider SHALL convert Vercel AI SDK tool definitions to the appropriate format based on the selected API.

#### Scenario: Tool conversion for Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** tools are provided in Vercel AI SDK format
- **THEN** tools SHALL be converted to `ChatCompletionTool` format (SAP format)

#### Scenario: Tool conversion for Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** tools are provided in Vercel AI SDK format
- **THEN** tools SHALL be converted to `AzureOpenAiChatCompletionTool` format (Azure format)

#### Scenario: Tool with no parameters

- **GIVEN** any `api` selection
- **WHEN** a tool has no parameters defined
- **THEN** it SHALL be converted with an empty parameters schema

#### Scenario: Tool with complex nested parameters

- **GIVEN** any `api` selection
- **WHEN** a tool has nested object parameters with required fields
- **THEN** all nested structure and required fields SHALL be preserved in conversion

#### Scenario: Tool call response conversion back to Vercel format

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** the model returns tool calls in Azure format
- **THEN** they SHALL be converted back to Vercel AI SDK format
- **AND** `toolCallId`, `toolName`, and `args` SHALL be correctly mapped

#### Scenario: Multiple tool calls in single response

- **GIVEN** any `api` selection
- **WHEN** the model returns multiple tool calls in a single response
- **THEN** all tool calls SHALL be converted and returned

#### Scenario: Tool choice mode conversion

- **GIVEN** any `api` selection
- **WHEN** tool choice is specified (`auto`, `required`, `none`, or specific tool)
- **THEN** it SHALL be converted to the appropriate format for the selected API

### Requirement: Response Format Support

The provider SHALL support structured output response formats (`json_schema`, `json_object`, `text`) with both APIs.

#### Scenario: JSON schema response with Orchestration API

- **GIVEN** `api: 'orchestration'` is selected
- **WHEN** `responseFormat: { type: 'json_schema', json_schema: {...} }` is specified
- **THEN** the response SHALL conform to the provided schema

#### Scenario: JSON schema response with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **WHEN** `responseFormat: { type: 'json_schema', json_schema: {...} }` is specified
- **THEN** the response SHALL conform to the provided schema

### Requirement: Deployment Configuration Compatibility

The provider SHALL support both `deploymentId` and `resourceGroup` based deployment resolution with both APIs.

#### Scenario: DeploymentId with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `deploymentId` is specified
- **WHEN** a model is created
- **THEN** the specified deployment SHALL be used

#### Scenario: ResourceGroup with Foundation Models API

- **GIVEN** `api: 'foundation-models'` is selected
- **AND** `resourceGroup` is specified (without `deploymentId`)
- **WHEN** a model is created
- **THEN** the deployment SHALL be resolved by model name within the resource group
