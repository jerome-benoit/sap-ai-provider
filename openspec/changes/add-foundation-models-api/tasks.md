# Tasks: Add Foundation Models API Support

## 1. Types and Core Infrastructure

- [ ] 1.1 Define `SAPAIApiType` union type (`'orchestration' | 'foundation-models'`)
- [ ] 1.2 Create `UnsupportedFeatureError` class with feature, api, suggestedApi properties
- [ ] 1.3 Create `ApiSwitchError` class with fromApi, toApi, conflictingFeature properties
- [ ] 1.4 Create discriminated union type `OrchestrationProviderSettings`
- [ ] 1.5 Create discriminated union type `FoundationModelsProviderSettings`
- [ ] 1.6 Create union type `SAPAIProviderSettings = OrchestrationProviderSettings | FoundationModelsProviderSettings`
- [ ] 1.7 Create discriminated union type `OrchestrationModelSettings` (with all orchestration-only options)
- [ ] 1.8 Create discriminated union type `FoundationModelsModelSettings` (with FM-only options)
- [ ] 1.9 Create union type `SAPAIModelSettings = OrchestrationModelSettings | FoundationModelsModelSettings`
- [ ] 1.10 Create `CommonModelParams` interface (shared parameters)
- [ ] 1.11 Create `OrchestrationModelParams` interface (extends CommonModelParams)
- [ ] 1.12 Create `FoundationModelsModelParams` interface (extends CommonModelParams with logprobs, seed, stop, user, logit_bias, top_logprobs)
- [ ] 1.13 Create `FoundationModelsEmbeddingParams` interface (with user parameter)
- [ ] 1.14 Create `SAPAILanguageModelProviderOptions` schema for invocation-time options
- [ ] 1.15 Update `sap-ai-settings.ts` exports with new types

## 2. Validation Logic

- [ ] 2.1 Implement `validateOrchestrationOnlyOptions()` function
  - Check for: filtering, grounding, masking, translation
  - Throw `UnsupportedFeatureError` with clear message for each
- [ ] 2.2 Implement `validateFoundationModelsOnlyOptions()` function
  - Check for: dataSources
  - Throw `UnsupportedFeatureError` if used with Orchestration
- [ ] 2.3 Implement `validateEscapeTemplatePlaceholders()` logic
  - If api=foundation-models AND escapeTemplatePlaceholders=true explicitly → throw error
  - If api=foundation-models AND escapeTemplatePlaceholders=false explicitly → no-op (allowed)
  - If api=foundation-models AND escapeTemplatePlaceholders not set → ignore (no escaping)
  - If api=orchestration → default to true, apply escaping
- [ ] 2.4 Implement `validateApiSwitch()` function
  - Check model was configured with conflicting features when switching APIs
  - Throw `ApiSwitchError` with fromApi, toApi, conflictingFeature
- [ ] 2.5 Implement `validateInputs()` function for invalid API values
  - Throw validation error listing valid API values for invalid input
  - Treat `undefined` as unset (apply precedence rules)
- [ ] 2.6 Implement `validateSettings(api, settings, invocationOptions)` main validation function
- [ ] 2.7 Add unit tests for all validation scenarios (Orchestration options with FM, FM options with Orch, escapeTemplatePlaceholders cases, API switch validation, invalid inputs)

## 3. Strategy Pattern Infrastructure

- [ ] 3.1 Define `LanguageModelAPIStrategy` interface
  - `doGenerate(settings, options): Promise<DoGenerateResult>`
  - `doStream(settings, options): Promise<DoStreamResult>`
- [ ] 3.2 Define `EmbeddingModelAPIStrategy` interface
  - `doEmbed(settings, options): Promise<DoEmbedResult>`
- [ ] 3.3 Define `StrategyConfig` type (deploymentConfig, destination, modelId, settings)
- [ ] 3.4 Implement `createLanguageModelStrategy(api, config)` factory with lazy loading
- [ ] 3.5 Implement `createEmbeddingModelStrategy(api, config)` factory with lazy loading
- [ ] 3.6 Implement `getOrCreateStrategy(api, config)` with Promise-based caching (module-level Map)
  - CRITICAL: Cache the Promise synchronously before await to prevent race conditions
  - Delete cached Promise on import failure to allow retry
- [ ] 3.7 Implement SDK import error handling with clear messages
  - Detect "Cannot find module" errors
  - Provide package name and npm install command in error message
- [ ] 3.8 Add unit tests verifying lazy loading behavior (mock dynamic imports)
- [ ] 3.9 Add unit tests verifying strategy caching (same API reuses strategy)
- [ ] 3.10 Add unit tests for concurrent first requests (verify only one import occurs)
- [ ] 3.11 Add unit tests for strategy creation failure and retry behavior

## 4. Orchestration Strategy (Refactor Existing Code)

- [ ] 4.1 Extract `OrchestrationLanguageModelStrategy` class from `SAPAILanguageModel`
  - Move `doGenerate` implementation
  - Move `doStream` implementation
  - Move message conversion logic (with escapeTemplatePlaceholders)
  - Move tool conversion logic
- [ ] 4.2 Extract `OrchestrationEmbeddingModelStrategy` class from `SAPAIEmbeddingModel`
  - Move `doEmbed` implementation
- [ ] 4.3 Ensure all existing tests pass after refactoring
- [ ] 4.4 Verify escapeTemplatePlaceholders logic still works correctly

## 5. Foundation Models Message Conversion

- [ ] 5.1 Create `convert-to-azure-messages.ts` module
- [ ] 5.2 Implement system message conversion to `AzureOpenAiChatCompletionRequestSystemMessage`
- [ ] 5.3 Implement user message conversion to `AzureOpenAiChatCompletionRequestUserMessage`
  - Handle text content
  - Handle image content (URL and base64)
- [ ] 5.4 Implement assistant message conversion to `AzureOpenAiChatCompletionRequestAssistantMessage`
  - Handle text content
  - Handle tool calls
  - Handle reasoning content (includeReasoning option)
- [ ] 5.5 Implement tool message conversion to `AzureOpenAiChatCompletionRequestToolMessage`
- [ ] 5.6 Add unit tests for all message type conversions
- [ ] 5.7 Add snapshot tests comparing converted formats

## 6. Foundation Models Tool Conversion

- [ ] 6.1 Implement `convertToolsToAzureFormat()` function
  - Convert Vercel AI SDK tool definitions to `AzureOpenAiChatCompletionTool[]`
- [ ] 6.2 Implement `convertToolCallsFromAzureFormat()` function
  - Convert Azure tool call responses back to Vercel AI SDK format
- [ ] 6.3 Add unit tests for tool conversion (both directions)

## 7. Foundation Models Language Model Strategy

- [ ] 7.1 Create `FoundationModelsLanguageModelStrategy` class
- [ ] 7.2 Implement `doGenerate()` method using `AzureOpenAiChatClient.run()`
  - Build `AzureOpenAiChatCompletionParameters` request
  - Convert messages using `convert-to-azure-messages.ts`
  - Map modelParams (common + FM-specific: logprobs, seed, stop, user, logit_bias, top_logprobs)
  - Handle responseFormat
  - Convert response to `DoGenerateResult`
- [ ] 7.3 Implement `doStream()` method using `AzureOpenAiChatClient.stream()`
  - Handle streaming chunks
  - Convert chunks to Vercel AI SDK streaming format
  - Handle tool calls in streaming mode
- [ ] 7.4 Implement error handling and response mapping
- [ ] 7.5 Add unit tests for doGenerate with various parameter combinations
- [ ] 7.6 Add unit tests for doStream
- [ ] 7.7 Add unit tests for tool calling flow

## 8. Foundation Models Embedding Strategy

- [ ] 8.1 Create `FoundationModelsEmbeddingModelStrategy` class
- [ ] 8.2 Implement `doEmbed()` method using `AzureOpenAiEmbeddingClient.run()`
  - Build `AzureOpenAiEmbeddingParameters` request
  - Map `type` to `input_type`
  - Map embedding modelParams (dimensions, encoding_format, user)
  - Handle maxEmbeddingsPerCall batching
  - Convert response to `DoEmbedResult`
- [ ] 8.3 Add unit tests for embedding generation
- [ ] 8.4 Add unit tests for type mapping

## 9. Provider Integration

- [ ] 9.1 Add `api?: SAPAIApiType` to `SAPAIProviderSettings` interface
- [ ] 9.2 Add `api?: SAPAIApiType` to model creation settings
- [ ] 9.3 Implement `resolveApi(providerApi, modelApi, invocationApi)` function with full precedence logic
  - Invocation-time override (highest priority)
  - Model-level setting
  - Provider-level setting
  - System default ('orchestration')
- [ ] 9.4 Implement `mergeSettingsForApi(api, modelSettings, invocationOptions)` function
  - Deep merge for nested modelParams
  - API-specific option filtering
- [ ] 9.5 Update `createSAPAIProvider()` to accept and store `api` option
- [ ] 9.6 Update language model factory to pass `api` to strategy creation
- [ ] 9.7 Update embedding model factory to pass `api` to strategy creation
- [ ] 9.8 Call `validateApiSwitch()` when invocationApi differs from modelApi
- [ ] 9.9 Call `validateSettings()` before strategy creation
- [ ] 9.10 Add unit tests for API selection at provider level
- [ ] 9.11 Add unit tests for API selection at model level (override)
- [ ] 9.12 Add unit tests for API selection at invocation level (providerOptions)
- [ ] 9.13 Add unit tests for mixed API usage within same provider
- [ ] 9.14 Add unit tests for API resolution precedence (all 4 levels)

## 10. Model Classes Update

- [ ] 10.1 Update `SAPAILanguageModel` to store providerApi, modelApi, settings, config (NOT strategy)
- [ ] 10.2 Update `doGenerate()` to implement late-binding flow:
  - Parse providerOptions for invocation-time API override
  - Call resolveApi() with full precedence chain
  - Call validateApiSwitch() if API differs
  - Call mergeSettingsForApi()
  - Call validateSettings()
  - Call getOrCreateStrategy() (lazy loading)
  - Delegate to strategy.doGenerate()
- [ ] 10.3 Update `doStream()` with same late-binding flow as doGenerate
- [ ] 10.4 Update `SAPAIEmbeddingModel` to store providerApi, modelApi, settings, config
- [ ] 10.5 Update `doEmbed()` to implement late-binding flow (same pattern)
- [ ] 10.6 Ensure model capabilities reflect selected API

## 11. Per-Call Provider Options

- [ ] 11.1 Add `api` to `sapAILanguageModelProviderOptions` zod schema
- [ ] 11.2 Add `modelParams` to `sapAILanguageModelProviderOptions` zod schema
- [ ] 11.3 Add `includeReasoning` to `sapAILanguageModelProviderOptions` zod schema
- [ ] 11.4 Add `escapeTemplatePlaceholders` to `sapAILanguageModelProviderOptions` (validated at runtime per API)
- [ ] 11.5 Add `api` to `sapAIEmbeddingModelProviderOptions` zod schema
- [ ] 11.6 Ensure per-call options respect API selection
- [ ] 11.7 Add unit tests for per-call option validation
- [ ] 11.8 Add unit tests for includeReasoning override at invocation time

## 12. Testing - Unit Tests

- [ ] 12.1 Unit tests for `UnsupportedFeatureError` class
- [ ] 12.2 Unit tests for `ApiSwitchError` class
- [ ] 12.3 Unit tests for validation functions (all edge cases)
- [ ] 12.4 Unit tests for `validateApiSwitch()` (all API switching scenarios)
- [ ] 12.5 Unit tests for `validateInputs()` (invalid API values, undefined handling)
- [ ] 12.6 Unit tests for lazy loading (verify correct SDK imported)
- [ ] 12.7 Unit tests for strategy caching (same API reuses, different APIs separate)
- [ ] 12.8 Unit tests for message conversion (Orchestration format)
- [ ] 12.9 Unit tests for message conversion (Foundation Models format)
- [ ] 12.10 Unit tests for tool conversion (both directions)
- [ ] 12.11 Unit tests for `resolveApi()` precedence (all 4 levels)
- [ ] 12.12 Unit tests for `mergeSettingsForApi()` (deep merge, API filtering)
- [ ] 12.13 Unit tests for escapeTemplatePlaceholders behavior with both APIs
- [ ] 12.14 Unit tests for includeReasoning with both APIs

## 13. Testing - Integration Tests

- [ ] 13.1 Integration test: generateText with Foundation Models API
- [ ] 13.2 Integration test: streamText with Foundation Models API
- [ ] 13.3 Integration test: embed with Foundation Models API
- [ ] 13.4 Integration test: tool calling with Foundation Models API
- [ ] 13.5 Integration test: mixed API usage (same provider, different models)
- [ ] 13.6 Integration test: API override at invocation time (generateText)
- [ ] 13.7 Integration test: API override at invocation time (streamText)
- [ ] 13.8 Integration test: API override at invocation time (embed)
- [ ] 13.9 Integration test: backward compatibility (existing code unchanged)
- [ ] 13.10 Verify all existing tests pass (no regressions)

## 14. Testing - Edge Cases

- [ ] 14.1 Test: FM-only params silently ignored with Orchestration API
- [ ] 14.2 Test: escapeTemplatePlaceholders=true with FM throws error
- [ ] 14.3 Test: escapeTemplatePlaceholders=false with FM is allowed (no-op)
- [ ] 14.4 Test: filtering with FM throws UnsupportedFeatureError
- [ ] 14.5 Test: grounding with FM throws UnsupportedFeatureError
- [ ] 14.6 Test: masking with FM throws UnsupportedFeatureError
- [ ] 14.7 Test: translation with FM throws UnsupportedFeatureError
- [ ] 14.8 Test: dataSources with Orchestration throws UnsupportedFeatureError
- [ ] 14.9 Test: responseFormat works with both APIs
- [ ] 14.10 Test: API switch from Orch with filtering to FM throws ApiSwitchError
- [ ] 14.11 Test: API switch from Orch with masking to FM throws ApiSwitchError
- [ ] 14.12 Test: API switch from Orch with grounding to FM throws ApiSwitchError
- [ ] 14.13 Test: API switch from Orch with translation to FM throws ApiSwitchError
- [ ] 14.14 Test: API switch from FM with dataSources to Orch throws ApiSwitchError
- [ ] 14.15 Test: API switch allowed when no conflicting features
- [ ] 14.16 Test: Concurrent requests with same API succeed
- [ ] 14.17 Test: Concurrent requests with different APIs succeed
- [ ] 14.18 Test: Invalid API value throws validation error with valid values listed
- [ ] 14.19 Test: API=undefined treated as unset (precedence applies)
- [ ] 14.20 Test: Deep merge for modelParams at invocation time
- [ ] 14.21 Test: includeReasoning with both APIs

## 15. Documentation

Follow conventions: H2/H3/H4 hierarchy, `typescript` code blocks with `import "dotenv/config"` first, ✅/⚠️/❌ in tables, `> **Note:**` for callouts, Mermaid diagrams with colored subgraphs.

- [ ] 15.1 README.md: Add `api` option to Provider Creation section
  - Document default behavior (orchestration)
  - Show Option 1: Provider-level selection
  - Show Option 2: Model-level override
  - Add note about Foundation Models API
- [ ] 15.2 README.md: Update Features list with API support note
- [ ] 15.3 API_REFERENCE.md: Add "Foundation Models API" to Terminology section
- [ ] 15.4 API_REFERENCE.md: Update `SAPAIProviderSettings` table with `api` property
- [ ] 15.5 API_REFERENCE.md: Add comprehensive feature matrix table (Orchestration vs Foundation Models)
  - Include all options with ✅/❌ symbols
  - Document escapeTemplatePlaceholders behavior
  - Document FM-only parameters
- [ ] 15.6 API_REFERENCE.md: Document `UnsupportedFeatureError` in Error Types section
  - Signature, parameters, example
- [ ] 15.7 API_REFERENCE.md: Document FM-only model parameters (logprobs, seed, stop, user, logit_bias, top_logprobs)
- [ ] 15.8 ARCHITECTURE.md: Add Strategy Pattern section with Mermaid diagram
- [ ] 15.9 ARCHITECTURE.md: Add Foundation Models flow to Component Interaction Map
- [ ] 15.10 Update JSDoc comments in `sap-ai-settings.ts` for all new types
- [ ] 15.11 Update JSDoc comments in `sap-ai-provider.ts` for `api` option
- [ ] 15.12 Create `examples/example-foundation-models.ts` with:
  - Basic chat completion
  - Streaming
  - Tool calling
  - Embeddings
  - Mixed API usage example

## 16. Package Configuration

- [ ] 16.1 Add `@sap-ai-sdk/foundation-models` as runtime dependency in package.json
- [ ] 16.2 Verify peer dependency version ranges are compatible
- [ ] 16.3 Update exports in `src/index.ts` for new types and error class
- [ ] 16.4 Verify TypeScript compilation succeeds
- [ ] 16.5 Verify build output includes all new files
- [ ] 16.6 Run full test suite (node and edge runtimes)

## 17. Final Validation

- [ ] 17.1 Run `npm run prepublishOnly` (type-check, lint, test, build)
- [ ] 17.2 Verify no breaking changes in public API
- [ ] 17.3 Test with real SAP AI Core credentials (manual):
  - Orchestration API chat
  - Orchestration API streaming
  - Foundation Models API chat
  - Foundation Models API streaming
  - Foundation Models API embeddings
- [ ] 17.4 Verify bundle size impact is minimal (lazy loading working)
- [ ] 17.5 Review all error messages for clarity
- [ ] 17.6 Validate OpenSpec: `openspec validate add-foundation-models-api --strict --no-interactive`

## Summary

| Phase                     | Tasks   | Description                                    |
| ------------------------- | ------- | ---------------------------------------------- |
| 1. Types                  | 15      | Type definitions and infrastructure            |
| 2. Validation             | 7       | Feature and API switch validation              |
| 3. Strategy               | 11      | Strategy pattern with caching + error handling |
| 4. Orchestration Refactor | 4       | Extract existing code to strategy              |
| 5. FM Messages            | 7       | Message format conversion                      |
| 6. FM Tools               | 3       | Tool format conversion                         |
| 7. FM Language Model      | 7       | Chat completion strategy                       |
| 8. FM Embeddings          | 4       | Embedding strategy                             |
| 9. Provider               | 14      | Provider integration with late-binding         |
| 10. Model Classes         | 6       | Model class updates                            |
| 11. Per-Call Options      | 8       | Per-call option handling                       |
| 12. Unit Tests            | 14      | Unit test coverage                             |
| 13. Integration Tests     | 10      | Integration test coverage                      |
| 14. Edge Cases            | 21      | Edge case test coverage                        |
| 15. Documentation         | 12      | Documentation updates                          |
| 16. Package               | 6       | Package configuration                          |
| 17. Final                 | 6       | Final validation                               |
| **Total**                 | **155** |                                                |
