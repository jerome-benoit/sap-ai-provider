# Change: Add Foundation Models API Support

## Why

The SAP AI SDK provides two distinct APIs for AI model access:

1. **Orchestration API** (`@sap-ai-sdk/orchestration`) - Full enterprise features including content filtering, data masking, grounding (RAG), and translation modules. Uses Jinja2 templates internally.

2. **Foundation Models API** (`@sap-ai-sdk/foundation-models`) - Direct Azure OpenAI access with lower latency and additional parameters (logprobs, seed, stop sequences). No orchestration modules.

Currently, our provider only supports the Orchestration API, limiting users who need:

- Simpler, faster direct model access
- Foundation Models-specific parameters (logprobs, deterministic seeding)
- To avoid Orchestration Service overhead
- Azure OpenAI On Your Data (`dataSources`) integration

## What Changes

### Core Architecture

- Add `@sap-ai-sdk/foundation-models` as a **runtime dependency**
- Introduce `api: 'orchestration' | 'foundation-models'` option at provider and model level
- Implement **Strategy Pattern** for API-agnostic model implementations
- Use **lazy loading** via dynamic `import()` to only load the selected SDK (zero-cost abstraction)
- Create **discriminated union types** for type-safe API-specific settings

### Option Handling

#### Orchestration-Only Options (rejected with Foundation Models API)

- `filtering` - Content safety filtering
- `grounding` - RAG document grounding
- `masking` - Data anonymization (SAP DPI)
- `translation` - Input/output translation
- `escapeTemplatePlaceholders: true` - Template delimiter escaping (only meaningful for Jinja2)

#### Foundation Models-Only Options

**`modelParams` fields** (silently ignored with Orchestration API):

- `modelParams.logprobs` - Return log probabilities
- `modelParams.top_logprobs` - Number of top log probs (0-20)
- `modelParams.logit_bias` - Token bias adjustment
- `modelParams.seed` - Deterministic sampling
- `modelParams.stop` - Stop sequences
- `modelParams.user` - End-user identifier for monitoring

**`dataSources` Option** (rejected with Orchestration API):

- `dataSources` - Azure OpenAI On Your Data
  - **Foundation Models API**: Enables Azure OpenAI On Your Data integration
  - **Orchestration API**: Throws `UnsupportedFeatureError`

#### Common Options (both APIs)

- `modelParams.temperature`, `maxTokens`, `topP`, `frequencyPenalty`, `presencePenalty`, `n`, `parallel_tool_calls`
- `responseFormat` - Structured output (json_schema, json_object, text)
- `modelVersion` - Model version selection
- `includeReasoning` - Include reasoning in response

### Special Behaviors

#### `escapeTemplatePlaceholders` Option

- **Orchestration API**: Defaults to `true`, escapes `{​{`, `{​%`, `{​#` delimiters to prevent Jinja2 template conflicts
- **Foundation Models API**:
  - Not specified → No escaping (FM has no Jinja2 templates)
  - Explicitly `true` → Throws `UnsupportedFeatureError` (not applicable)
  - Explicitly `false` → Allowed (no-op)

### Message and Tool Format Conversion

- **Orchestration**: `ChatMessage[]` format with `MessagesHistory`
- **Foundation Models**: `AzureOpenAiChatCompletionRequestMessage[]` format
- **Tools**: Convert Vercel AI SDK tools to appropriate format per API

### Error Handling

New `UnsupportedFeatureError` class with clear, actionable messages:

```text
"Content filtering is not supported with Foundation Models API. Use Orchestration API instead."
```

**Non-Breaking**: Existing code continues to work unchanged. Default API remains `'orchestration'`.

## Impact

- **Affected specs**: `dual-api-support` (new capability)
- **Affected code**:
  - `src/sap-ai-provider.ts` - Add API selection option, validation
  - `src/sap-ai-language-model.ts` - Strategy Pattern for chat completions
  - `src/sap-ai-embedding-model.ts` - Strategy Pattern for embeddings
  - `src/sap-ai-settings.ts` - Discriminated union types for API options
  - New: `src/strategies/` - Strategy implementations
  - New: `src/convert-to-azure-messages.ts` - FM message conversion
  - New: `src/errors/unsupported-feature-error.ts` - Error class

## References

- GitHub Issue: <https://github.com/jerome-benoit/sap-ai-provider/issues/22>
- SAP AI SDK Documentation: <https://sap.github.io/ai-sdk/>
- `@sap-ai-sdk/foundation-models@2.5.0`:
  - `AzureOpenAiChatClient` - Chat completions
  - `AzureOpenAiEmbeddingClient` - Embeddings
  - `AzureOpenAiChatCompletionParameters` - Request parameters
- `@sap-ai-sdk/orchestration`:
  - `OrchestrationClient` - Orchestration service client
  - `FilteringModule`, `MaskingModule`, `GroundingModule`, `TranslationModule` - Enterprise modules
