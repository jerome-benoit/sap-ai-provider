# API Reference

Complete API documentation for the SAP AI Provider.

## Terminology

Unless a section specifies a facade, examples use the root V3 entrypoint with
AI SDK 6. Use `/v2` for AI SDK 5 (also supported by AI SDK 6 compatibility),
and `/v4` for AI SDK 7. Package release versions are independent of provider
specification versions and AI SDK majors.

To avoid confusion, this documentation uses the following terminology
consistently:

- **SAP AI Core** - The SAP BTP service that provides AI model hosting and
  orchestration (the cloud service)
- **SAP AI SDK** - The official SAP npm packages (`@sap-ai-sdk/orchestration`
  and `@sap-ai-sdk/foundation-models`) used for API communication
- **Orchestration API** - SAP AI Core's full-featured API with data masking,
  content filtering, document grounding, and translation capabilities
- **Foundation Models API** - SAP AI Core's direct model access API with
  additional parameters like `logprobs`, `seed`, and `logit_bias`
- **SAP AI Provider** or **this provider** - This npm package
  (`@jerome-benoit/sap-ai-provider`)
- **Tool calling** - The capability of models to invoke external functions
  (equivalent to "function calling")

## Table of Contents

- [Terminology](#terminology)
- [Provider Factory Functions](#provider-factory-functions)
  - [`createSAPAIProvider(options?)`](#createsapaiprovideroptions-1)
  - [`sapai`](#sapai)
- [Models](#models)
  - [Supported Models](#supported-models)
- [Tool Calling (Function Calling)](#tool-calling-function-calling)
  - [Overview](#overview)
  - [Basic Tool Calling Example](#basic-tool-calling-example)
  - [Model-Specific Tool Limitations](#model-specific-tool-limitations)
  - [Tool Definition Format](#tool-definition-format)
  - [Parallel Tool Calls](#parallel-tool-calls)
  - [Multi-Turn Tool Conversations](#multi-turn-tool-conversations)
  - [Error Handling with Tools](#error-handling-with-tools)
  - [Streaming with Tools](#streaming-with-tools)
  - [Advanced: Tool Choice Control](#advanced-tool-choice-control)
  - [Best Practices](#best-practices)
  - [Related Documentation](#related-documentation)
- [Embeddings](#embeddings)
  - [Overview](#overview-1)
  - [Basic Usage](#basic-usage)
  - [Embedding Settings](#embedding-settings)
  - [SAPAIEmbeddingModel](#sapaiembeddingmodel)
  - [SAPAIEmbeddingSettings](#sapaiembeddingsettings)
  - [SAPAIEmbeddingModelId](#sapaiembeddingmodelid)
- [Interfaces](#interfaces)
  - [`SAPAIProvider`](#sapaiprovider)
    - [`provider(modelId, settings?)`](#providermodelid-settings-1)
    - [`provider.chat(modelId, settings?)`](#providerchatmodelid-settings-1)
    - [`provider.embedding(modelId, settings?)`](#providerembeddingmodelid-settings)
    - [`provider.textEmbeddingModel(modelId, settings?)`](#providertextembeddingmodelmodelid-settings-1)
    - [`provider.languageModel(modelId, settings?)`](#providerlanguagemodelmodelid-settings-1)
    - [`provider.embeddingModel(modelId, settings?)`](#providerembeddingmodelmodelid-settings)
    - [`provider.imageModel(modelId)`](#providerimagemodelmodelid-1)
    - [`provider.specificationVersion`](#providerspecificationversion)
  - [API Comparison: Orchestration vs Foundation Models](#api-comparison-orchestration-vs-foundation-models)
  - [`SAPAIProviderSettings`](#sapaiprovidersettings)
  - [`SAPAISettings`](#sapaisettings)
  - [`ModelParams`](#modelparams)
  - [`OrchestrationStreamOptions`](#orchestrationstreamoptions)
  - [`SAPAIServiceKey`](#sapaiservicekey)
  - [`MaskingModuleConfig`](#maskingmoduleconfig)
  - [`DpiConfig`](#dpiconfig)
- [Provider Options](#provider-options)
  - [`SAP_AI_PROVIDER_NAME`](#sap-ai-provider-name-constant)
  - [Per-message-part Provider Options (Anthropic prompt caching)](#per-message-part-provider-options-anthropic-prompt-caching)
  - [File Parts](#file-parts)
  - [`sapAILanguageModelProviderOptions`](#sapailanguagemodelprovideroptions)
  - [`sapAIEmbeddingProviderOptions`](#sapaiembeddingprovideroptions)
  - [`SAPAILanguageModelProviderOptions` (Type)](#sapailanguagemodelprovideroptions-type)
  - [`SAPAIEmbeddingProviderOptions` (Type)](#sapaiembeddingprovideroptions-type)
- [Types](#types)
  - [`SAPAIModelId`](#sapaimodelid)
  - [`SAPAIApiType`](#sapaiapitype)
  - [`PromptTemplateRef`](#prompttemplateref)
  - [Orchestration configuration reference types](#orchestration-configuration-reference-types)
  - [`DpiEntities`](#dpientities)
  - [API-Specific Settings Types](#api-specific-settings-types)
  - [Model Parameters Types](#model-parameters-types)
  - [Default Settings Configuration Types](#default-settings-configuration-types)
- [Classes](#classes)
  - [`SAPAILanguageModel`](#sapailanguagemodel)
    - [`doGenerate(options)`](#dogenerateoptions)
    - [`doStream(options)`](#dostreamoptions)
  - [Error Handling & Reference](#error-handling--reference)
    - [Error Types](#error-types)
    - [SAP-Specific Error Details](#sap-specific-error-details)
    - [Error Handling Examples](#error-handling-examples)
    - [HTTP Status Code Reference](#http-status-code-reference)
    - [Error Handling Strategy](#error-handling-strategy)
  - [`OrchestrationErrorResponse`](#orchestrationerrorresponse)
  - [Provider Metadata in Responses](#provider-metadata-in-responses)
  - [Re-exported SAP AI SDK Classes](#re-exported-sap-ai-sdk-classes)
  - [Re-exported SAP AI SDK Types](#re-exported-sap-ai-sdk-types)
  - [`DeploymentConfig`](#deploymentconfig)
- [Utility Functions](#utility-functions)
  - [`getProviderName(providerIdentifier)`](#getprovidernameprovideridentifier)
  - [`buildDpiMaskingProvider(config)`](#builddpimaskingproviderconfig)
  - [`buildAzureContentSafetyFilter(type, config?)`](#buildazurecontentsafetyfiltertype-config)
  - [`buildLlamaGuard38BFilter(type, categories)`](#buildllamaguard38bfiltertype-categories)
  - [`buildDocumentGroundingConfig(config)`](#builddocumentgroundingconfigconfig)
  - [`buildTranslationConfig(type, config)`](#buildtranslationconfigtype-config)
  - [`resolveApi(providerApi, modelApi, invocationApi)`](#resolveapiproviderapi-modelapi-invocationapi)
  - [`validateSettings(options)`](#validatesettingsoptions)
  - [`escapeOrchestrationPlaceholders(text)`](#escapeorchestrationplaceholderstext)
  - [`unescapeOrchestrationPlaceholders(text)`](#unescapeorchestrationplaceholderstext)
- [Response Formats](#response-formats)
  - [Text Response](#text-response)
  - [JSON Object Response](#json-object-response)
  - [JSON Schema Response](#json-schema-response)
- [Environment Variables](#environment-variables)
- [Version Information](#version-information)
  - [Dependencies](#dependencies)
  - [`VERSION`](#version)
- [V4 Facade API (AI SDK 7)](#v4-facade-api-ai-sdk-7)
- [V2 Facade Package API](#v2-facade-package-api)
- [Related Documentation](#related-documentation-1)

## V4 Facade API (AI SDK 7)

Import the V4 facade from the main package's `v4` subpath when using AI SDK 7:

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v4";

const provider = createSAPAIProvider();
const languageModel = provider("gpt-4.1");
const embeddingModel = provider.embedding("text-embedding-3-small");
```

The subpath exports `SAPAILanguageModel`, `SAPAIEmbeddingModel`, and
`SAPAIProvider` as V4 facades over the shared V3 core. The provider exposes
`chat()`, `languageModel()`, `embedding()`, `embeddingModel()`, and the
deprecated `textEmbeddingModel()` alias. Version-independent settings, SAP SDK
clients, builders, validation helpers, error types, and `VERSION` match the root
entrypoint.

The standardized V4 `reasoning` option is forwarded as SAP's harmonized
`reasoning_effort` model parameter. An explicit level overrides
`providerOptions["sap-ai"].modelParams.reasoning_effort`, which overrides the
model setting. `provider-default` adds no override: it preserves an explicitly
configured `modelParams.reasoning_effort`, or leaves the parameter unset when
none is configured. Support for each level depends on the selected model.

For locally configured Orchestration calls, resolved model parameters, tools,
response format, and modules are supplied to the SAP SDK client configuration
for both generation and streaming. When `orchestrationConfigRef` is set, the
referenced server configuration owns these settings instead; local generation
options, including explicit `reasoning`, are ignored with a warning.

V4 tagged file data is normalized before it reaches the shared core:

- Full media types such as `image/png` are preserved.
- Bare and wildcard media types such as `image` and `image/*` are resolved
  from detectable inline bytes.
- Remote image URLs with `image` or `image/*` remain remote and normalize
  case-insensitively to lower-case `image/*`; they are never downloaded for detection.
- Ambiguous inline bytes and other incomplete URL media types throw instead of
  producing an invalid SAP payload.
- Top-level provider references are rejected explicitly and never fetched.
  References nested in tool-result content map to the equivalent V3 `file-id`
  representation and are serialized as JSON tool output by the shared core;
  they do not trigger native file lookup.
- Text file variants become V3 text parts and retain provider options.

V4 assistant `reasoning-file` and `custom` parts throw
`UnsupportedFunctionalityError`. Custom items nested in tool-result content
are instead preserved and serialized as JSON by the shared SAP converter.

## V2 Facade Package API

The V2 facade is available from the main package's `@jerome-benoit/sap-ai-provider/v2` subpath and from the standalone `@jerome-benoit/sap-ai-provider-v2` package. Both wrap the internal V3 implementation to expose `LanguageModelV2` and `EmbeddingModelV2` interfaces for AI SDK 5/6 or other V2-compatible consumers. AI SDK 7 integrations must use the [V4 facade](#v4-facade-api-ai-sdk-7) instead.

### Export Aliases

The V2 package exports classes with simplified names for convenience:

| Internal Class          | Public Export         |
| ----------------------- | --------------------- |
| `SAPAILanguageModelV2`  | `SAPAILanguageModel`  |
| `SAPAIEmbeddingModelV2` | `SAPAIEmbeddingModel` |
| `SAPAIProviderV2`       | `SAPAIProvider`       |

**Example:**

```typescript
// Main-package subpath:
import { SAPAILanguageModel } from "@jerome-benoit/sap-ai-provider/v2";
// Standalone-package alternative:
// import { SAPAILanguageModel } from "@jerome-benoit/sap-ai-provider-v2";
```

---

### `createSAPAIProvider(options?)`

Creates an SAP AI Provider instance that returns V2-compatible models.

**Signature:**

```typescript
function createSAPAIProvider(options?: SAPAIProviderSettings): SAPAIProviderV2;
```

**Parameters:**

- `options` (optional): `SAPAIProviderSettings` - Configuration options (same as V3 package).

**Returns:** `SAPAIProviderV2` - Configured provider instance.

**Example:**

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v2";
import { generateText, embed } from "ai";
import { APICallError } from "@ai-sdk/provider";

const provider = createSAPAIProvider({
  resourceGroup: "default",
  deploymentId: "d65d81e7c077e583",
});

const languageModel = provider("gpt-4.1"); // Implements LanguageModelV2

const embeddingModel = provider.textEmbeddingModel("text-embedding-3-small"); // Implements EmbeddingModelV2

try {
  const result = await generateText({
    model: languageModel,
    prompt: "Explain quantum computing in simple terms.",
  });

  console.log(result.text);

  const { embedding } = await embed({
    model: embeddingModel,
    value: "What is machine learning?",
  });

  console.log("Embedding dimensions:", embedding.length);
} catch (error) {
  if (error instanceof APICallError) {
    console.error("SAP AI Core API error:", error.message);
    console.error("Status:", error.statusCode);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

---

### `SAPAIProviderV2`

This interface extends Vercel AI SDK's `ProviderV2`. It wraps the V3 internal implementation to provide V2-compatible models.

**Properties:**

- **Note**: `SAPAIProviderV2` does NOT expose `specificationVersion` because it is not part of `ProviderV2` (V3 and V4 providers expose it).

**Methods:**

#### `provider(modelId, settings?)`

Creates a V2-compatible language model instance.

**Signature:**

```typescript
(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV2
```

**Returns:** `SAPAILanguageModelV2` - A language model instance implementing `LanguageModelV2`.

#### `provider.chat(modelId, settings?)`

Explicit method for creating V2-compatible chat models (equivalent to calling the provider function).

**Signature:**

```typescript
chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV2
```

#### `provider.languageModel(modelId, settings?)`

ProviderV2-compliant method for creating V2-compatible language model instances.

**Signature:**

```typescript
languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModelV2
```

#### `provider.textEmbeddingModel(modelId, settings?)`

Creates a V2-compatible embedding model instance.

**Signature:**

```typescript
textEmbeddingModel(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModelV2
```

**Parameters:**

- `modelId`: Embedding model identifier (e.g., 'text-embedding-3-small')
- `settings`: Optional embedding model configuration

**Returns:** `SAPAIEmbeddingModelV2` - An embedding model instance implementing `EmbeddingModelV2`.

**Note**: The `SAPAIProviderV2` only exposes `textEmbeddingModel()` for embeddings. It does NOT have `embedding()` or `embeddingModel()` methods, as these belong to the V3 and V4 provider surfaces.

#### `provider.imageModel(modelId)`

Always throws `NoSuchModelError` because SAP AI Core does not support image generation models.

**Signature:**

```typescript
imageModel(modelId: string): ImageModelV2
```

---

### `SAPAILanguageModelV2`

This class implements the Vercel AI SDK's `LanguageModelV2` interface, wrapping the internal V3 language model implementation.

Direct generation results and stream `finish` events expose a string
`finishReason` and flat `usage.inputTokens`, `usage.outputTokens`, and
`usage.totalTokens`. SAP provider metadata is preserved, including the V3-shaped
`finishReasonMapped` object; it does not become a V2 finish-reason string.

---

### `SAPAIEmbeddingModelV2`

This class implements the Vercel AI SDK's `EmbeddingModelV2` interface, wrapping the internal V3 embedding model implementation.

Unlike V3/V4, its `doEmbed` result has no `warnings` property. Warnings from the
shared core are logged with `console.warn`; embeddings, usage, response headers,
and SAP provider metadata are returned.

---

## Provider Factory Functions

> **Architecture Context:** For provider factory pattern implementation details,
> see [Architecture - Provider Pattern](./ARCHITECTURE.md#provider-pattern).

### `createSAPAIProvider(options?)`

Creates an SAP AI Provider instance.

**Signature:**

```typescript
function createSAPAIProvider(options?: SAPAIProviderSettings): SAPAIProvider;
```

**Parameters:**

- `options` (optional): `SAPAIProviderSettings` - Configuration options

**Returns:** `SAPAIProvider` - Configured provider instance

**Example:**

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider({
  resourceGroup: "default",
  deploymentId: "d65d81e7c077e583",
});

const model = provider("gpt-4.1");
```

---

### `sapai`

Default SAP AI provider instance with automatic configuration.

**Type:**

```typescript
const sapai: SAPAIProvider;
```

**Description:**

A pre-configured provider instance that uses automatic authentication from:

- `AICORE_SERVICE_KEY` environment variable (local development)
- `VCAP_SERVICES` service binding (SAP BTP Cloud Foundry)

This is the quickest way to get started without explicit provider creation.

**Example:**

```typescript
import "dotenv/config"; // Load environment variables
import { sapai } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";
import { APICallError } from "@ai-sdk/provider";

try {
  // Use directly without creating a provider
  const result = await generateText({
    model: sapai("gpt-4.1"),
    prompt: "Explain quantum computing",
  });

  console.log(result.text);
} catch (error) {
  if (error instanceof APICallError) {
    console.error("API error:", error.message, "- Status:", error.statusCode);
  }
  throw error;
}
```

**When to use:**

- ✅ Quick prototypes and simple applications
- ✅ Default configuration is sufficient
- ✅ No need for custom resource groups or deployment IDs

**When to use `createSAPAIProvider()` instead:**

- Need custom `resourceGroup` or `deploymentId`
- Want explicit configuration control
- Need multiple provider instances with different settings

---

## Models

> **Architecture Context:** For model integration and message conversion
> details, see [Architecture - Component Architecture](./ARCHITECTURE.md#component-architecture).

### Supported Models

The SAP AI Provider supports all models available through SAP AI Core
via the `@sap-ai-sdk/orchestration` and `@sap-ai-sdk/foundation-models` packages.

**Supported Providers:**

- **OpenAI** (via Azure) - gpt-4.1, o-series reasoning models
- **Anthropic Claude** (via AWS Bedrock) - Claude 3.x, 4.x models
- **Google Gemini** (via GCP Vertex AI) - Gemini 2.x models
- **Amazon Nova** (via AWS Bedrock) - Nova models
- **Mistral AI**, **Cohere**, **SAP** (ABAP, RPT)

> **Note:** Model availability depends on your SAP AI Core tenant configuration,
> region, and subscription. The model ID you pass to `provider("model-name")`
> can be any model available in your environment.

**Discovering Available Models:**

```bash
# List deployments in your tenant
curl "https://<AI_API_URL>/v2/lm/deployments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "AI-Resource-Group: default"
```

Or use **SAP AI Launchpad** → ML Operations → Deployments.

**See Also:**

- [SAP AI Core Models Documentation](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/models-and-scenarios)
- Provider documentation: [OpenAI](https://platform.openai.com/docs/models),
  [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models),
  [Google](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models),
  [Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html)

**⚠️ Model Limitations:**

- **Amazon models**: Do not support the `n` parameter (number of completions).
- **Gemini models**: Have [tool calling limitations](#model-specific-tool-limitations).

---

## Tool Calling (Function Calling)

Tool calling enables AI models to invoke functions and use external tools during
text generation. This is essential for building agentic AI applications that can
perform actions like database queries, API calls, calculations, or data
retrieval.

### Overview

When you provide tools to the model, it can decide to call one or more tools
based on the conversation context. The provider handles:

- Converting tool definitions to SAP AI Core format
- Parsing tool call responses from the AI model
- Managing multi-turn conversations with tool results
- Handling parallel tool calls (model-dependent)

### Basic Tool Calling Example

```typescript
import { generateText, stepCountIs } from "ai";
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { z } from "zod";

const provider = createSAPAIProvider();

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's the weather in Tokyo and 5+3?",
  stopWhen: stepCountIs(3),
  tools: {
    getWeather: {
      description: "Get weather for a city",
      inputSchema: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async ({ city }) => {
        // Demonstration data only; this does not call a weather service.
        return { temp: 72, conditions: "sunny" };
      },
    },
    calculator: {
      description: "Add two numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a + b }),
    },
  },
});

console.log(result.text); // "It's sunny and 72°F in Tokyo. 5+3 equals 8."
console.log(result.steps.flatMap((step) => step.toolCalls)); // All tool invocations
console.log(result.steps.flatMap((step) => step.toolResults)); // All tool results
```

### Model-Specific Tool Limitations

⚠️ **Important:** Not all models support tool calling equally. Tool calling
capabilities depend on the underlying model provider and may change over time.

Consult the official documentation for current tool calling support:

- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Google Vertex AI Function Calling](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling)
- [Amazon Bedrock Tool Use](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html)

### Tool Definition Format

Tools passed to `generateText` or `streamText` use `inputSchema`. Use Zod
or wrap JSON Schema with the AI SDK's `jsonSchema` helper; raw SAP/OpenAI
`{ type: "function", function: { parameters: ... } }` definitions belong to
the provider's model-level `tools` setting, not the AI SDK `tools` map.

Only function tools are converted. Provider-defined tools are omitted with an
`unsupported` warning. On Orchestration, non-empty call-level `tools` take
precedence over model-level SAP-format `tools`, with a warning when both are
provided. An empty call-level list does not clear model-level tools; use
`toolChoice: "none"` to disable tool use for a call.

```typescript
import { jsonSchema, tool } from "ai";
import { z } from "zod";

// Zod schema (recommended); execution is handled by your application.
const weatherTool = tool({
  description: "Get current weather for a location",
  inputSchema: z.object({
    city: z.string().describe("City name"),
    units: z.enum(["celsius", "fahrenheit"]).optional(),
  }),
});

// JSON Schema (alternative)
const calculatorTool = tool({
  description: "Add two numbers",
  inputSchema: jsonSchema<{ a: number; b: number }>({
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
    additionalProperties: false,
  }),
  execute: async ({ a, b }) => ({ result: a + b }),
});
```

### Parallel Tool Calls

Some models (gpt-4.1, Claude, Amazon Nova) can call multiple tools
simultaneously:

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's the weather in Tokyo, London, and Paris?",
  tools: { getWeather },
  providerOptions: {
    "sap-ai": {
      modelParams: { parallel_tool_calls: true },
    },
  },
});

// Model can call getWeather 3 times in parallel
```

⚠️ **Important:** Set `parallel_tool_calls: false` when using Gemini models or
when tool execution order matters.

### Multi-Turn Tool Conversations

The AI SDK executes tools with an `execute` function. Enable subsequent model
steps with `stopWhen` to let the model consume tool results:

```typescript
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

const operands = z.object({ a: z.number(), b: z.number() });
const result = await generateText({
  model: provider("gpt-4.1"),
  stopWhen: stepCountIs(3),
  prompt: "Add 5 and 3, then multiply the result by 7.",
  tools: {
    add: {
      description: "Add two numbers",
      inputSchema: operands,
      execute: async ({ a, b }) => a + b,
    },
    multiply: {
      description: "Multiply two numbers",
      inputSchema: operands,
      execute: async ({ a, b }) => a * b,
    },
  },
});

// The model can request add(5, 3), receive 8, then request multiply(8, 7).
// stepCountIs(3) permits two tool steps and a final response; it does not
// guarantee which tools a model will choose.
console.log(result.text);
```

### Error Handling with Tools

Handle tool execution errors gracefully:

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's the weather?",
  tools: {
    getWeather: {
      description: "Get weather",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => {
        try {
          const response = await fetch(`https://api.weather.com/${city}`);
          if (!response.ok) {
            throw new Error(`Weather API error: ${response.status}`);
          }
          return await response.json();
        } catch (error) {
          // Return error message that the model can understand
          return {
            error: true,
            message: `Failed to get weather: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },
  },
});
```

### Streaming with Tools

Tool calls work with streaming responses:

```typescript
const result = await streamText({
  model: provider("gpt-4.1"),
  prompt: "Calculate 5+3 and tell me about it",
  tools: { calculator },
});

for await (const part of result.textStream) {
  process.stdout.write(part); // Stream text as it's generated
}

console.log(await result.toolCalls); // Resolves after stream completes
```

### Advanced: Tool Choice Control

Control when the model should use tools:

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's 5+3?",
  tools: { calculator },
  toolChoice: "required", // Force tool usage
  // toolChoice: "auto" // (default) Let model decide
  // toolChoice: "none" // Disable tools for this request
});
```

### Best Practices

1. **Model Selection:** Use gpt-4.1, Claude, or Amazon Nova for multi-tool
   applications
2. **Tool Descriptions:** Write clear, specific descriptions of what each tool
   does
3. **Parameter Schemas:** Use descriptive field names and include descriptions
4. **Error Handling:** Return error objects that models can interpret, not just
   throw exceptions
5. **Tool Naming:** Use camelCase names (e.g., `getWeather`, not `get_weather`)
6. **Parallel Calls:** Enable only when tool execution order doesn't matter
7. **Testing:** Verify tool support and parallel-call behavior for the exact
   model and deployment you use

### Related Documentation

- [cURL API Testing Guide - Tool Calling Examples](./CURL_API_TESTING_GUIDE.md#tool-calling-example) -
  Direct API testing
- [Architecture - Tool Calling Flow](./ARCHITECTURE.md#tool-calling-flow) -
  Internal implementation details
- [Vercel AI SDK - Tool Calling Docs](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling) -
  Upstream documentation

---

## Embeddings

Generate vector embeddings for RAG (Retrieval-Augmented Generation), semantic
search, similarity matching, and clustering.

### Overview

The SAP AI Provider implements the Vercel AI SDK's `EmbeddingModelV3` interface,
enabling you to generate embeddings using models available through SAP AI Core.

Key features:

- Full `EmbeddingModelV3` specification compliance
- Support for single and batch embedding generation
- Configurable embedding types (`document`, `query`, `text`)
- Automatic validation of batch sizes with `maxEmbeddingsPerCall`
- AbortSignal support for request cancellation

### Basic Usage

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { embed, embedMany } from "ai";

const provider = createSAPAIProvider();

// Single embedding
const { embedding } = await embed({
  model: provider.embedding("text-embedding-3-small"),
  value: "What is machine learning?",
});

console.log("Embedding dimensions:", embedding.length);

// Multiple embeddings (batch)
const { embeddings } = await embedMany({
  model: provider.embedding("text-embedding-3-small"),
  values: ["Hello world", "AI is transforming industries", "Vector databases"],
});

console.log("Generated", embeddings.length, "embeddings");
```

### Embedding Settings

Configure embedding behavior with `SAPAIEmbeddingSettings`:

```typescript
const model = provider.embedding("text-embedding-3-large", {
  // Maximum embeddings per API call (default: 2048)
  maxEmbeddingsPerCall: 100,

  // Specific version of the model (optional)
  modelVersion: "2024-02-15-preview",

  // Embedding type: "document", "query", or "text" (default: "text")
  type: "document",

  // Model-specific parameters
  modelParams: {
    // Parameters passed to the embedding model
  },
});
```

#### Embeddings with Data Masking

Apply data masking to protect sensitive information before embedding generation
(Orchestration API only):

```typescript
import { buildDpiMaskingProvider } from "@jerome-benoit/sap-ai-provider";

const model = provider.embedding("text-embedding-3-small", {
  masking: {
    masking_providers: [
      buildDpiMaskingProvider({
        method: "anonymization",
        entities: [{ type: "profile-person" }, { type: "profile-email" }, { type: "profile-phone" }],
      }),
    ],
  },
});

// PII in text will be anonymized before embedding
const { embedding } = await embed({
  model,
  value: "Contact John Smith at john.smith@example.com or call 555-1234",
});
```

**Embedding Types:**

The `type` setting and per-call override are sent only to the Orchestration
embedding API. Foundation Models accepts these options but does not forward
them or emit a warning.

| Type       | Use Case                                 | Example                         |
| ---------- | ---------------------------------------- | ------------------------------- |
| `document` | Embedding documents for storage/indexing | RAG document ingestion          |
| `query`    | Embedding search queries                 | Semantic search queries         |
| `text`     | General-purpose text embedding (default) | Similarity matching, clustering |

### SAPAIEmbeddingModel

Implementation of Vercel AI SDK's `EmbeddingModelV3` interface.

**Properties:**

| Property               | Type     | Description                                       |
| ---------------------- | -------- | ------------------------------------------------- |
| `specificationVersion` | `'v3'`   | API specification version                         |
| `modelId`              | `string` | Embedding model identifier                        |
| `provider`             | `string` | Provider identifier (`'sap-ai.embedding'`)        |
| `maxEmbeddingsPerCall` | `number` | Maximum values per `doEmbed` call (default: 2048) |

**Methods:**

#### `doEmbed(options)`

Generate embeddings for an array of values.

**Signature:**

```typescript
async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result>
```

**Parameters:**

- `values`: Array of strings to embed
- `abortSignal`: Optional signal to cancel the request

**Returns:** Object containing `embeddings` (same order as input values),
`usage.tokens`, `warnings`, and provider metadata. Response headers are included
when available; an embedding response body is not exposed.

**Throws:**

- `TooManyEmbeddingValuesForCallError` - When `values.length > maxEmbeddingsPerCall`
- `APICallError` - For API/HTTP errors

**Example:**

```typescript
const model = provider.embedding("text-embedding-3-small");

// Direct model usage (advanced)
const result = await model.doEmbed({
  values: ["Hello", "World"],
  abortSignal: controller.signal,
});

console.log(result.embeddings); // [[0.1, 0.2, ...], [0.3, 0.4, ...]]
```

### SAPAIEmbeddingSettings

Configuration options for embedding models.

**Properties:**

| Property               | Type                                                                 | Default           | Description                                               |
| ---------------------- | -------------------------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| `api`                  | `SAPAIApiType`                                                       | `'orchestration'` | API to use (`'orchestration'`/`'foundation-models'`)      |
| `maxEmbeddingsPerCall` | `number`                                                             | `2048`            | Maximum values per API call                               |
| `modelVersion`         | `string`                                                             | -                 | Specific version of the model                             |
| `type`                 | `"document" \| "query" \| "text"`                                    | `'text'`          | Embedding type                                            |
| `modelParams`          | `FoundationModelsEmbeddingParams \| Record<string, unknown>`         | -                 | Model-specific parameters                                 |
| `masking`              | `MaskingModule \| { providers: MaskingModule["masking_providers"] }` | -                 | Data masking configuration (DPI) - Orchestration API only |

**Embedding response metadata (`doEmbed` result):**

| Field                                  | Type                     | Description                                                                                 |
| -------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `response.headers`                     | `Record<string, string>` | Response headers (keys lower-cased)                                                         |
| `providerMetadata['sap-ai'].model`     | `string`                 | Embedding model id                                                                          |
| `providerMetadata['sap-ai'].requestId` | `string \| undefined`    | SAP request correlation id (from the SDK response; falls back to the `x-request-id` header) |
| `providerMetadata['sap-ai'].version`   | `string`                 | Provider package version                                                                    |

**EmbeddingType Values:**

- `'document'` - For embedding documents (storage/indexing)
- `'query'` - For embedding search queries
- `'text'` - General-purpose embedding (default)

### SAPAIEmbeddingModelId

Type for embedding model identifiers.

**Type:**

```typescript
export type SAPAIEmbeddingModelId = string;
```

> **Note:** Embedding model availability depends on your SAP AI Core tenant
> configuration, region, and subscription. Common providers include OpenAI,
> Amazon Titan, and NVIDIA. Consult your tenant for available embedding models.

---

## Interfaces

### `SAPAIProvider`

Main provider interface extending Vercel AI SDK's `ProviderV3`.

**Properties:**

- `specificationVersion`: `"v3"` on the root provider

**Methods:**

#### `provider(modelId, settings?)`

Create a language model instance.

**Signature:**

```typescript
(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel
```

**Parameters:**

- `modelId`: Model identifier (e.g., 'gpt-4.1', 'anthropic--claude-4.5-sonnet')
- `settings`: Optional model configuration

**Example:**

```typescript
const model = provider("gpt-4.1", {
  modelParams: {
    temperature: 0.7,
    maxTokens: 2000,
  },
});
```

#### `provider.chat(modelId, settings?)`

Explicit method for creating chat models (equivalent to calling provider
function).

**Signature:**

```typescript
chat(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel
```

#### `provider.embedding(modelId, settings?)`

Alias for `embeddingModel()`.

```typescript
embedding(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel
```

#### `provider.textEmbeddingModel(modelId, settings?)`

> **Deprecated:** Use `embeddingModel()` instead. Maintained for `ProviderV3`
> interface compatibility.

```typescript
textEmbeddingModel(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel
```

#### `provider.languageModel(modelId, settings?)`

ProviderV3-compliant method for creating language model instances. This is the
standard way to create language models in Vercel AI SDK.

**Signature:**

```typescript
languageModel(modelId: SAPAIModelId, settings?: SAPAISettings): SAPAILanguageModel
```

**Parameters:**

- `modelId`: Model identifier (e.g., 'gpt-4.1', 'anthropic--claude-4.5-sonnet')
- `settings`: Optional model configuration

**Example:**

```typescript
// Using the V3 standard method
const model = provider.languageModel("gpt-4.1", {
  modelParams: { temperature: 0.7 },
});

// Equivalent to calling the provider directly
const model2 = provider("gpt-4.1", { modelParams: { temperature: 0.7 } });
```

#### `provider.embeddingModel(modelId, settings?)`

ProviderV3-compliant method for creating embedding model instances.
Alias: `embedding()`, `textEmbeddingModel()`.

**Signature:**

```typescript
embeddingModel(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel
```

**Parameters:**

- `modelId`: Embedding model identifier (e.g., 'text-embedding-3-small')
- `settings`: Optional embedding model configuration

**Example:**

```typescript
const embeddingModel = provider.embeddingModel("text-embedding-3-small", {
  maxEmbeddingsPerCall: 100,
  type: "document",
});
```

#### `provider.imageModel(modelId)`

ProviderV3-compliant method for creating image generation models.

**Signature:**

```typescript
imageModel(modelId: string): never
```

**Behavior:**

Always throws `NoSuchModelError` because SAP AI Core does not support image
generation models.

**Example:**

```typescript
import { NoSuchModelError } from "@ai-sdk/provider";

try {
  const imageModel = provider.imageModel("dall-e-3");
} catch (error) {
  if (error instanceof NoSuchModelError) {
    console.log("Image generation not supported by SAP AI Core");
  }
}
```

#### `provider.specificationVersion`

The ProviderV3 specification version identifier.

**Type:** `'v3'`

**Example:**

```typescript
const provider = createSAPAIProvider();
console.log(provider.specificationVersion); // 'v3'
```

---

### `SAPAIProviderSettings`

Configuration options for the SAP AI Provider.

**Properties:**

| Property                | Type                                     | Default           | Description                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | `string`                                 | `'sap-ai'`        | Provider identifier prefix (`{name}.{type}`). Call options and response metadata use the identifier segment before the first dot; per-part caching always uses `"sap-ai"`.                           |
| `api`                   | `'orchestration' \| 'foundation-models'` | `'orchestration'` | SAP AI Core API to use. Orchestration provides full features (masking, filtering, grounding); Foundation Models provides direct model access                                                         |
| `resourceGroup`         | `string`                                 | `'default'`       | SAP AI Core resource group                                                                                                                                                                           |
| `deploymentId`          | `string`                                 | Auto              | SAP AI Core deployment ID                                                                                                                                                                            |
| `destination`           | `HttpDestinationOrFetchOptions`          | -                 | Custom destination configuration                                                                                                                                                                     |
| `requestConfig`         | `CustomRequestConfig`                    | -                 | Custom HTTP request configuration forwarded on every call. See [Note on `requestConfig`](#requestconfig-note) below for scope, portability, abort semantics, and SAP AI Core `AI-*` header guidance. |
| `defaultSettings`       | `SAPAISettings`                          | -                 | Default model settings applied to all models                                                                                                                                                         |
| `logLevel`              | `'debug' \| 'error' \| 'info' \| 'warn'` | `'warn'`          | Log level for SAP Cloud SDK internal logging (authentication, service binding). Can be overridden via `SAP_CLOUD_SDK_LOG_LEVEL` environment variable                                                 |
| `warnOnAmbiguousConfig` | `boolean`                                | `true`            | Emit warnings for ambiguous configurations (e.g., when both `deploymentId` and `resourceGroup` are provided, `deploymentId` wins)                                                                    |

**Example:**

```typescript
const settings: SAPAIProviderSettings = {
  resourceGroup: "production",
  deploymentId: "d65d81e7c077e583",
  logLevel: "warn", // Suppress info messages (default)
  warnOnAmbiguousConfig: true, // Warn if both deploymentId and resourceGroup provided
  defaultSettings: {
    modelParams: {
      temperature: 0.7,
      maxTokens: 2000,
    },
  },
};
```

<a id="requestconfig-note"></a>

> **Note:**
>
> - **Provider-level scope only.** `requestConfig` is applied to every call from this
>   provider and is not currently overridable per-call via `providerOptions['sap-ai']`.
>   For per-request variation (e.g. different `AI-Object-Store-Secret-Name` per tenant),
>   create separate provider instances.
> - **Runtime support.** The published package targets Node.js 22.12+;
>   `httpAgent` and `httpsAgent` configure its Node HTTP transport. The provider
>   does not strip these fields or guarantee that they are ignored elsewhere.
>   Node-dependent ESM output and SAP SDK dependencies prevent claiming pure
>   Edge / Cloudflare Workers support from source-level Edge tests.
>   (`timeout` reaches axios via the
>   `CustomRequestConfig` `Record<string, any>` index signature; it is honoured
>   end-to-end but is not a first-class typed field.)
> - **Abort semantics.** The AI SDK `abortSignal` option always wins over any `signal`
>   set on `requestConfig`; the latter is dropped before the request is forwarded via
>   the internal `mergeRequestConfig` helper.
> - **SAP AI Core `AI-*` headers.** `requestConfig.headers` accepts service-specific
>   headers that alter server-side behaviour:
>   - **`AI-Object-Store-Secret-Name`** — names the object store secret used by the
>     feedback service. Omit if you are not using the feedback service.
>   - **`AI-Resource-Group`** — **do not set via `requestConfig.headers`**.
>     The SAP AI SDK types this header as `never` on its internal
>     `OrchestrationRequestHeaders` type, but that constraint does not flow through
>     `CustomRequestConfig.headers` (typed as `Record<string, any>`), so TypeScript
>     will not flag the assignment. Use the `resourceGroup` provider option or
>     `deploymentConfig` instead.
>
> Source: SAP AI SDK [`orchestration-types.ts`](https://github.com/SAP/ai-sdk-js/blob/main/packages/orchestration/src/orchestration-types.ts).

**Example with custom request headers:**

```typescript
const provider = createSAPAIProvider({
  resourceGroup: "production",
  requestConfig: {
    headers: { "AI-Object-Store-Secret-Name": "my-secret" },
  },
});
```

**Example with a custom request timeout:**

```typescript
const provider = createSAPAIProvider({
  requestConfig: {
    timeout: 30_000, // 30 seconds
  },
});
```

**Example with provider name:**

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

// Create provider with name
const provider = createSAPAIProvider({
  name: "sap-ai-core",
  resourceGroup: "production",
});

// Provider identifier: "sap-ai-core.chat"
const model = provider("gpt-4.1");
console.log(model.provider); // => "sap-ai-core.chat"

// Use provider name in providerOptions
const result = await generateText({
  model,
  prompt: "Hello",
  providerOptions: {
    "sap-ai-core": {
      includeReasoning: true,
    },
  },
});

// providerMetadata also uses provider name as key
console.log(result.providerMetadata?.["sap-ai-core"]);
```

For names containing dots, use `getProviderName(model.provider)` for call-level
options and response metadata: `name: "sap.ai"` produces `"sap.ai.chat"`, but
the namespace is `"sap"`. Per-message-part and tool-definition `cacheControl`
always uses `providerOptions["sap-ai"]`, even with a custom provider name.

---

### API Comparison: Orchestration vs Foundation Models

The SAP AI Provider supports two APIs. Use this feature matrix to choose
the right API for your use case.

#### Feature Matrix

| Feature                         |  Orchestration  | Foundation Models | Notes                                                 |
| ------------------------------- | :-------------: | :---------------: | ----------------------------------------------------- |
| **Chat Completions**            |       ✅        |        ✅         | Both APIs support chat completions                    |
| **Streaming**                   |       ✅        |        ✅         | Both APIs support streaming responses                 |
| **Tool Calling**                |       ✅        |        ✅         | Both APIs support tool calling                        |
| **Embeddings**                  |       ✅        |        ✅         | Both APIs support embeddings                          |
| **Structured Output (JSON)**    |       ✅        |        ✅         | Both APIs support JSON mode and schemas               |
| **Data Masking (DPI)**          |       ✅        |        ❌         | Anonymize/pseudonymize PII via SAP DPI                |
| **Content Filtering**           |       ✅        |        ❌         | Azure Content Safety, Llama Guard filters             |
| **Document Grounding (RAG)**    |       ✅        |        ❌         | SAP AI Core vector store integration                  |
| **Translation**                 |       ✅        |        ❌         | SAP Document Translation service                      |
| **Template Escaping**           |       ✅        |        ❌         | `escapeTemplatePlaceholders` for SAP template safety  |
| **SAP-format Tool Definitions** |       ✅        |        ❌         | `tools` property in settings                          |
| **Azure On Your Data**          |       ❌        |        ✅         | `dataSources` for Azure AI Search, Cosmos DB          |
| **Log Probabilities**           | Model-dependent |        ✅         | `logprobs`, `top_logprobs` parameters                 |
| **Seeded Sampling**             | Model-dependent |        ✅         | `seed` for best-effort reproducibility                |
| **Stop Sequences**              | Model-dependent |        ✅         | `stop` parameter to control generation                |
| **Token Bias**                  | Model-dependent |        ✅         | `logit_bias` to adjust token probabilities            |
| **User Tracking**               | Model-dependent |        ✅         | `user` parameter for abuse monitoring                 |
| **Tool Choice Control**         |       ✅        |        ✅         | `toolChoice` for `required`, `none`, or specific tool |

The matrix describes provider support, not a guarantee for every model. Both
strategies forward `seed` and stop sequences; additional orchestration
`modelParams` are backend/model-dependent. A seed requests best-effort
reproducibility, not deterministic output. Although `logprobs` parameters are
forwarded, token probabilities are not exposed in the normalized generation
result, response body, or provider metadata. Use the SAP SDK or direct API
for probability analysis.

#### When to Use Each API

**Use Orchestration API (default) when:**

- ✅ You need data masking/anonymization for PII protection
- ✅ You need content filtering for safety compliance
- ✅ You need document grounding with SAP AI Core vector stores
- ✅ You need input/output translation
- ✅ You want the full SAP AI Core feature set

**Use Foundation Models API when:**

- ✅ You need Azure "On Your Data" (`dataSources`) integration
- ✅ You want direct model access without orchestration overhead
- ✅ You need fine-grained control with `logit_bias` or `stop` sequences

#### Switching APIs

```typescript
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

// Provider-level: all models use this API by default
const provider = createSAPAIProvider({ api: "foundation-models" });

// Model-level: override for specific model
const model = provider("gpt-4.1", { api: "orchestration" });

// Invocation-level: override per-call
const result = await generateText({
  model,
  prompt: "Hello",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: { api: "foundation-models" },
  },
});
```

> **Note:** API-specific features cannot be mixed. Using `filtering` with
> Foundation Models API throws `UnsupportedFeatureError`. See
> [Error Types](#error-types) for details.

---

### `SAPAISettings`

Model-specific configuration options.

**Properties:**

| Property                     | Type                                                                 | Default | Description                                                         |
| ---------------------------- | -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| `modelVersion`               | `string`                                                             | -       | Specific model version                                              |
| `includeReasoning`           | `boolean`                                                            | `false` | Include reasoning parts in SAP prompt conversion                    |
| `escapeTemplatePlaceholders` | `boolean`                                                            | `true`  | Escape template delimiters to prevent conflicts                     |
| `modelParams`                | `CommonModelParams`                                                  | -       | Model generation parameters                                         |
| `masking`                    | `MaskingModule \| { providers: MaskingModule["masking_providers"] }` | -       | Data masking configuration (DPI)                                    |
| `filtering`                  | `FilteringModule`                                                    | -       | Content filtering configuration                                     |
| `grounding`                  | `GroundingModule`                                                    | -       | Document grounding configuration                                    |
| `translation`                | `TranslationModule`                                                  | -       | Translation configuration (Orchestration only)                      |
| `placeholderValues`          | `Record<string, string>`                                             | -       | Default values for template placeholders                            |
| `promptTemplateRef`          | `PromptTemplateRef`                                                  | -       | Reference to a Prompt Registry template                             |
| `responseFormat`             | `ResponseFormat`                                                     | -       | Response format specification                                       |
| `streamOptions`              | `OrchestrationStreamOptions`                                         | -       | Stream options for post-LLM modules (Orchestration only)            |
| `tools`                      | `ChatCompletionTool[]`                                               | -       | Tool definitions in SAP AI SDK format                               |
| `fallbackModuleConfigs`      | `OrchestrationModuleConfig[]`                                        | -       | Ordered fallback prompt module configurations for Orchestration API |

**Example:**

```typescript
const settings: SAPAISettings = {
  modelVersion: "2024-08-06",
  modelParams: {
    temperature: 0.3,
    maxTokens: 2000,
    topP: 0.9,
    frequencyPenalty: 0.1,
    presencePenalty: 0.0,
    n: 1,
    parallel_tool_calls: true,
  },
  tools: [
    {
      type: "function",
      function: {
        name: "calculator",
        description: "Perform calculations",
        parameters: {/* JSON Schema */},
      },
    },
  ],
};
```

> **Note:** The `escapeTemplatePlaceholders` option is enabled by default to prevent SAP AI Core orchestration API errors when content contains template syntax (`{{variable}}`, `{% if %}`, `{# comment #}`). Set it to `false` only when you intentionally send SAP or Jinja placeholders in prompts or messages and supply their values through `placeholderValues`. See [Troubleshooting - Problem: Template Placeholder Conflicts](./TROUBLESHOOTING.md#problem-template-placeholder-conflicts) for details.
>
> **Note:** `fallbackModuleConfigs` are only used when the Orchestration API builds inline or prompt-template configuration locally. They are ignored when `orchestrationConfigRef` is set because the stored orchestration configuration owns the module list.

**API-Specific Settings Types:**

For type-safe API-specific configuration, use the discriminated union types:

- `OrchestrationModelSettings` - Settings with `api?: "orchestration"` and
  Orchestration-only options (`filtering`, `masking`, `grounding`, `translation`,
  `tools`, `streamOptions`, `fallbackModuleConfigs`, `escapeTemplatePlaceholders`)
- `FoundationModelsModelSettings` - Settings with `api: "foundation-models"` and
  Foundation Models-only options (`dataSources`)

```typescript
import type { OrchestrationModelSettings, FoundationModelsModelSettings } from "@jerome-benoit/sap-ai-provider";

// Type-safe Orchestration settings
const orchSettings: OrchestrationModelSettings = {
  api: "orchestration",
  filtering: {/* ... */},
  masking: {/* ... */},
};

// Type-safe Foundation Models settings
const fmSettings: FoundationModelsModelSettings = {
  api: "foundation-models",
  dataSources: [
    {
      type: "azure_search",
      parameters: {/* ... */},
    },
  ],
  modelParams: { logprobs: true, seed: 42 },
};
```

---

### `ModelParams`

Fine-grained model behavior parameters. The exported types are
`CommonModelParams`, `OrchestrationModelParams`, and `FoundationModelsModelParams`;
`ModelParams` is a descriptive heading, not an exported type. Omitted values
are left to the backend rather than filled with provider defaults.

> **Note:** Many parameters are model/provider-specific. Some models may ignore
> or only partially support certain options (e.g., Gemini tool calls
> limitations, Amazon models not supporting `n`). Always consult the model's
> upstream documentation.

**Properties:**

| Property              | Type      | Range                         | Default        | Description                                            |
| --------------------- | --------- | ----------------------------- | -------------- | ------------------------------------------------------ |
| `maxTokens`           | `number`  | Positive integer; model limit | Model-specific | Maximum tokens to generate                             |
| `temperature`         | `number`  | 0-2                           | Model-specific | Sampling temperature                                   |
| `topP`                | `number`  | 0-1                           | Model-specific | Nucleus sampling parameter                             |
| `frequencyPenalty`    | `number`  | -2 to 2                       | Model-specific | Frequency penalty                                      |
| `presencePenalty`     | `number`  | -2 to 2                       | Model-specific | Presence penalty                                       |
| `n`                   | `number`  | Positive integer; model limit | Model-specific | Number of completions (not supported by Amazon models) |
| `parallel_tool_calls` | `boolean` | -                             | Model-specific | Enable parallel tool execution (OpenAI models)         |

#### Additional Foundation Models Parameters

These parameters have explicit types in `FoundationModelsModelParams` for
Azure OpenAI-compatible deployments. They are not all exclusive to that API:
`seed` and stop sequences are mapped by both strategies, and additional
orchestration model parameters are passed through when provided. Backend/model
support determines which values can be used.

| Property       | Type                             | Default | Description                                           |
| -------------- | -------------------------------- | ------- | ----------------------------------------------------- |
| `logprobs`     | `boolean \| null`                | `false` | Request backend token log probabilities               |
| `top_logprobs` | `number \| null`                 | -       | Number of most likely tokens (0-20) at each position  |
| `seed`         | `number \| null`                 | -       | Seed for best-effort reproducibility (not guaranteed) |
| `stop`         | `string \| string[]`             | -       | Stop sequences where generation halts                 |
| `logit_bias`   | `Record<string, number> \| null` | -       | Modify likelihood of specific tokens (-100 to 100)    |
| `user`         | `string`                         | -       | Unique end-user identifier for abuse monitoring       |

**Example with Foundation Models parameters:**

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

const provider = createSAPAIProvider({ api: "foundation-models" });

const result = await generateText({
  model: provider("gpt-4.1", {
    modelParams: {
      temperature: 0.7,
      maxTokens: 1000,
      // Additional model parameters (support varies by backend)
      seed: 42, // Best-effort reproducibility, not guaranteed
      logprobs: true, // Requested upstream; not exposed in normalized results
      top_logprobs: 5, // Top 5 tokens at each position
      stop: ["\n\n", "END"], // Stop on double newline or "END"
      user: "user-123", // Track for abuse monitoring
    },
  }),
  prompt: "Write a haiku about programming",
});

// Normalized results expose text, not the requested log probabilities.
console.log("Response:", result.text);
```

> **Note:** Using these parameters with Orchestration API (`api: "orchestration"`)
> is backend/model-dependent: additional model parameters are passed through,
> not universally rejected or ignored. `seed` and stop sequences are also mapped
> by the shared strategy for both APIs. Verify support on the selected model.

---

### `OrchestrationStreamOptions`

Stream options for controlling how post-LLM modules (translation, masking, filtering) process
streaming responses. Only available with the Orchestration API.

**Properties:**

| Property                 | Type                | Description                                                            |
| ------------------------ | ------------------- | ---------------------------------------------------------------------- |
| `chunkSize`              | `number`            | Characters to buffer before post-LLM processing (range: 1-10000)       |
| `delimiters`             | `readonly string[]` | Sentence delimiters for chunking (e.g., `[".", "!", "?"]`)             |
| `outputFilteringOverlap` | `number`            | Characters from previous chunks for filtering context (range: 0-10000) |

**Example:**

```typescript
import { createSAPAIProvider, buildTranslationConfig } from "@jerome-benoit/sap-ai-provider";
import { streamText } from "ai";

const provider = createSAPAIProvider();

// Configure stream options at model level
const model = provider("gpt-4.1", {
  translation: {
    output: buildTranslationConfig("output", { targetLanguage: "de" }),
  },
  streamOptions: {
    chunkSize: 50,
    delimiters: [".", "!", "?"],
  },
});

const result = await streamText({
  model,
  prompt: "Explain AI in simple terms",
});
```

> **Note:** When using translation with streaming, it is recommended to set
> `delimiters` to ensure proper sentence boundary detection. The provider will
> emit a warning if translation is configured without delimiters.

---

### `SAPAIServiceKey`

SAP BTP service key JSON structure (descriptive name, not an exported
TypeScript type).

> **Note:** In v2.0+, the service key is provided via the `AICORE_SERVICE_KEY`
> environment variable (as a JSON string), not as a parameter to
> `createSAPAIProvider()`.

**Properties:**

| Property          | Type                     | Required | Description                                     |
| ----------------- | ------------------------ | -------- | ----------------------------------------------- |
| `serviceurls`     | `{ AI_API_URL: string }` | Yes      | Service URLs configuration                      |
| `clientid`        | `string`                 | Yes      | OAuth2 client ID                                |
| `clientsecret`    | `string`                 | Yes      | OAuth2 client secret                            |
| `url`             | `string`                 | Yes      | OAuth2 authorization server URL                 |
| `identityzone`    | `string`                 | No       | Identity zone for multi-tenant environments     |
| `identityzoneid`  | `string`                 | No       | Unique identifier for the identity zone         |
| `appname`         | `string`                 | No       | Application name in SAP BTP                     |
| `credential-type` | `string`                 | No       | Type of credential (typically "binding-secret") |

**For setup instructions and examples, see
[Environment Setup Guide](./ENVIRONMENT_SETUP.md).**

---

### `MaskingModuleConfig`

Data masking configuration using SAP Data Privacy Integration (DPI). The
exported TypeScript type is `MaskingModule`; `MaskingModuleConfig` is a
descriptive heading, not an exported type.

**Properties:**

| Property            | Type                      | Description                       |
| ------------------- | ------------------------- | --------------------------------- |
| `masking_providers` | `MaskingProviderConfig[]` | List of masking service providers |

---

### `DpiConfig`

SAP Data Privacy Integration masking configuration. This is a descriptive
heading, not an exported type; use `MaskingModule["masking_providers"][number]`
or the `buildDpiMaskingProvider` builder to type configuration.

**Properties:**

| Property               | Type                                    | Description                            |
| ---------------------- | --------------------------------------- | -------------------------------------- |
| `type`                 | `'sap_data_privacy_integration'`        | Provider type                          |
| `method`               | `'anonymization' \| 'pseudonymization'` | Masking method                         |
| `entities`             | `DpiEntityConfig[]`                     | Entities to mask                       |
| `allowlist`            | `string[]`                              | Strings that should not be masked      |
| `mask_grounding_input` | `{ enabled?: boolean }`                 | Whether to mask grounding module input |

**Example:**

```typescript
import type { MaskingModule } from "@jerome-benoit/sap-ai-provider";

const masking: MaskingModule = {
  masking_providers: [
    {
      type: "sap_data_privacy_integration",
      method: "anonymization",
      entities: [
        {
          type: "profile-email",
          replacement_strategy: { method: "fabricated_data" },
        },
        {
          type: "profile-person",
          replacement_strategy: { method: "constant", value: "REDACTED" },
        },
        {
          regex: "\\b[0-9]{4}-[0-9]{4}-[0-9]{3,5}\\b",
          replacement_strategy: { method: "constant", value: "ID_REDACTED" },
        },
      ],
      allowlist: ["SAP", "BTP"],
    },
  ],
};
```

---

## Provider Options

Provider options enable per-call configuration that overrides constructor settings.
These options are passed via `providerOptions[SAP_AI_PROVIDER_NAME]` in AI SDK calls and are
validated at runtime using Zod schemas.

Only the fields listed below are supported at call level. Unknown top-level
fields (such as `masking`, `tools`, or `requestConfig`) are stripped, not applied
or rejected. Additional keys inside `modelParams` pass through; known keys are
validated. Invalid recognized call options reject with `InvalidArgumentError`;
invalid constructor `modelParams` reject with a Zod error.

For mapped generation parameters, precedence is: standard AI SDK call option
(for example, `temperature` or `maxOutputTokens`), then per-call
`providerOptions` model parameter, then model settings merged over provider
`defaultSettings`. Use the documented camelCase parameter names for this
precedence. Non-empty `stopSequences` overrides `modelParams.stop`. Additional
model parameters and `placeholderValues` are deep-merged, with call values
winning. `includeReasoning` and `escapeTemplatePlaceholders` use the call value
when provided, otherwise the model setting. Stored orchestration configuration
references are an exception: the stored configuration owns model parameters
and modules, and ignored local options produce warnings.

### SAP AI Provider Name Constant

The default provider name constant. Use as key in `providerOptions` and `providerMetadata`.

**Value:** `"sap-ai"`

**Usage:**

```typescript
import { SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Hello",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: {
      includeReasoning: true,
    },
  },
});
```

---

### Per-message-part Provider Options (Anthropic prompt caching)

Per-part directive (`providerOptions['sap-ai'].cacheControl`) requesting
Anthropic ephemeral prompt caching. Honored only by the orchestration API
(forwarded as `cache_control`); Foundation Models ignores it. This is a request
directive passed to the backend, not a guarantee that the model will report a
cache hit.

**Input shape:**

```typescript
type CacheControl = {
  type: "ephemeral";
  ttl?: "5m" | "1h"; // invalid values drop the whole `cacheControl` block (warning emitted)
};
```

**Supported parts (orchestration API):**

| Surface             | Carrier                                                       |
| ------------------- | ------------------------------------------------------------- |
| user text part      | `prompt[i].content[j].providerOptions['sap-ai'].cacheControl` |
| user file part      | `prompt[i].content[j].providerOptions['sap-ai'].cacheControl` |
| system message      | `prompt[i].providerOptions['sap-ai'].cacheControl`            |
| assistant text part | `prompt[i].content[j].providerOptions['sap-ai'].cacheControl` |
| tool-result message | `prompt[i].content[j].providerOptions['sap-ai'].cacheControl` |
| tool definition     | `tool.providerOptions['sap-ai'].cacheControl`                 |

`cacheControl` on an assistant `tool-call` part is unsupported and emits a
single `unsupported` warning (deduplicated by feature key). Invalid blocks are
dropped and surface a `type: "other"` warning naming the offending path. Use
`providerMetadata[getProviderName(model.provider)].cacheUsage` on the result to
inspect backend-reported prompt-cache token buckets when they are present
(`"sap-ai"` is the default response namespace).

**Example:**

```typescript
const result = await generateText({
  model: provider("anthropic--claude-4.5-sonnet"),
  prompt: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Long shared context...",
          providerOptions: {
            "sap-ai": { cacheControl: { type: "ephemeral", ttl: "5m" } },
          },
        },
        { type: "text", text: "Question that varies per call" },
      ],
    },
  ],
});

const cacheUsage = result.providerMetadata?.["sap-ai"]?.cacheUsage;
// e.g. { ephemeral_5m_input_tokens: 1234, ephemeral_1h_input_tokens: 0 }
// `cacheUsage` is omitted only when all buckets are zero; individual zero keys are preserved.
```

---

### File Parts

User message `file` parts are converted for the Orchestration API before they are
sent to SAP AI Core:

| AI SDK file part                         | SAP message content                                               |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `mediaType` starts with `image/`         | `image_url` with the original URL or an inline data URL           |
| any other `mediaType`                    | `file` with the original URL or an inline data URL in `file_data` |
| `filename` on a non-image file part      | forwarded as `file.filename`; image filenames are not forwarded   |
| `providerOptions['sap-ai'].cacheControl` | forwarded as `cache_control` when valid                           |

At the shared converter boundary, file data may be a `URL`, a base64 string,
`Uint8Array`, `Buffer`, `ArrayBuffer`, or a buffer-like object whose custom
`toString("base64")` returns canonical RFC 4648 base64. Genuine URL objects
pass through without being fetched; inline data becomes a data URL. Plain
objects, provider references, and invalid buffer-like results are rejected
instead of being stringified. The high-level AI SDK prepares inputs before
conversion and may download URLs not covered by the model
`supportedUrls` patterns (HTTPS images and image data URLs).
Non-image file conversion is supported by this provider, but SAP AI Core
backend and model MIME-type support varies by tenant, deployment, and selected
model. If a model rejects a MIME type, choose a model or orchestration setup
that supports that file type.

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Summarize this document." },
        {
          type: "file",
          filename: "policy.pdf",
          mediaType: "application/pdf",
          data: pdfBytes,
        },
      ],
    },
  ],
});
```

---

### `sapAILanguageModelProviderOptions`

Zod schema for validating language model provider options.

**Validated Fields:**

| Field                             | Type                                                         | Description                                                           |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `api`                             | `"orchestration" \| "foundation-models"`                     | Override API selection for this call                                  |
| `escapeTemplatePlaceholders`      | `boolean`                                                    | Escape SAP or Jinja delimiters in prompt and message text             |
| `includeReasoning`                | `boolean`                                                    | Forward assistant reasoning parts from the input prompt to SAP        |
| `orchestrationConfigRef`          | `OrchestrationConfigRefById \| OrchestrationConfigRefByName` | Reference to a stored orchestration configuration (Orchestration API) |
| `placeholderValues`               | `Record<string, string>`                                     | Placeholder values sent to Orchestration API                          |
| `promptTemplateRef`               | `PromptTemplateRef`                                          | Reference to a Prompt Registry template                               |
| `modelParams.temperature`         | `number (0-2)`                                               | Sampling temperature                                                  |
| `modelParams.maxTokens`           | `positive integer`                                           | Maximum tokens to generate                                            |
| `modelParams.topP`                | `number (0-1)`                                               | Nucleus sampling parameter                                            |
| `modelParams.frequencyPenalty`    | `number (-2 to 2)`                                           | Frequency penalty                                                     |
| `modelParams.presencePenalty`     | `number (-2 to 2)`                                           | Presence penalty                                                      |
| `modelParams.n`                   | `positive integer`                                           | Number of completions                                                 |
| `modelParams.parallel_tool_calls` | `boolean`                                                    | Enable parallel tool calls                                            |

**Example:**

```typescript
import { generateText } from "ai";
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider();

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Explain quantum computing",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: {
      includeReasoning: true,
      modelParams: {
        temperature: 0.7,
        maxTokens: 1000,
      },
    },
  },
});
```

---

### `sapAIEmbeddingProviderOptions`

Zod schema for validating embedding model provider options.

**Validated Fields:**

| Field         | Type                                     | Description                              |
| ------------- | ---------------------------------------- | ---------------------------------------- |
| `api`         | `"orchestration" \| "foundation-models"` | Override API selection for this call     |
| `type`        | `"text" \| "query" \| "document"`        | Embedding task type (Orchestration only) |
| `modelParams` | `Record<string, unknown>`                | Additional model parameters              |

Known embedding parameters are validated: `dimensions` must be a positive
integer, `encoding_format` must be `"base64"`, `"binary"`, or `"float"`, and
`normalize` must be a boolean. Other `modelParams` keys pass through; actual
parameter support depends on the backend and model.

**Example:**

```typescript
import { embed } from "ai";
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider();

const { embedding } = await embed({
  model: provider.embedding("text-embedding-3-small"),
  value: "Search query text",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: {
      type: "query",
    },
  },
});
```

---

### `SAPAILanguageModelProviderOptions` (Type)

TypeScript type inferred from the Zod schema for language model options.

**Type:**

```typescript
type SAPAILanguageModelProviderOptions = {
  api?: "orchestration" | "foundation-models";
  escapeTemplatePlaceholders?: boolean;
  includeReasoning?: boolean;
  modelParams?: {
    frequencyPenalty?: number;
    maxTokens?: number;
    n?: number;
    parallel_tool_calls?: boolean;
    presencePenalty?: number;
    temperature?: number;
    topP?: number;
    [key: string]: unknown; // Passthrough for custom params
  };
  orchestrationConfigRef?: OrchestrationConfigRefById | OrchestrationConfigRefByName;
  placeholderValues?: Record<string, string>;
  promptTemplateRef?: PromptTemplateRef;
};
```

**Properties:**

| Property                     | Type                                                         | Description                                                         |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `api`                        | `string`                                                     | Override API selection (`'orchestration'` or `'foundation-models'`) |
| `escapeTemplatePlaceholders` | `boolean`                                                    | Escape template delimiters to prevent SAP templating conflicts      |
| `includeReasoning`           | `boolean`                                                    | Forward assistant reasoning parts from the input prompt to SAP      |
| `modelParams`                | `object`                                                     | Model generation parameters for this specific call                  |
| `orchestrationConfigRef`     | `OrchestrationConfigRefById \| OrchestrationConfigRefByName` | Reference to a stored orchestration configuration                   |
| `placeholderValues`          | `Record<string, string>`                                     | Values for template placeholders (overrides settings values)        |
| `promptTemplateRef`          | `PromptTemplateRef`                                          | Reference to a template in SAP AI Core's Prompt Registry            |

**Example with placeholderValues:**

```typescript
const { text } = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What are the key benefits of this product?",
  providerOptions: {
    "sap-ai": {
      placeholderValues: {
        product: "SAP Cloud SDK",
        version: "1.0",
      },
    },
  },
});
```

**Example with grounding placeholders:**

```typescript
const model = provider("gpt-4.1", {
  grounding: buildDocumentGroundingConfig({
    filters: [{ id: "vector-store-1", data_repositories: ["*"] }],
    placeholders: { input: ["groundingRequest"], output: "groundingOutput" },
  }),
});

const { text } = await generateText({
  model,
  prompt: "Question: {{?groundingRequest}}\nContext: {{?groundingOutput}}",
  providerOptions: {
    "sap-ai": {
      escapeTemplatePlaceholders: false,
      placeholderValues: {
        groundingRequest: "What is SAP?",
      },
    },
  },
});
```

Use `escapeTemplatePlaceholders: false` only when you intentionally send SAP or
Jinja placeholders such as `{{?groundingRequest}}` in the prompt or messages.
For normal user text, keep the default escaping enabled.

**Example with settings and providerOptions merge:**

```typescript
// Default placeholders in settings, override per-request in providerOptions
const model = provider("gpt-4.1", {
  placeholderValues: {
    product: "SAP Cloud SDK", // Default product
    language: "English", // Default language
  },
});

// Per-request override: product is overridden, language uses default
const { text } = await generateText({
  model,
  prompt: "Describe the features of the product.",
  providerOptions: {
    "sap-ai": {
      placeholderValues: {
        product: "SAP S/4HANA", // Override default product
        // language: "English" inherited from settings
      },
    },
  },
});
```

---

### `SAPAIEmbeddingProviderOptions` (Type)

TypeScript type inferred from the Zod schema for embedding model options.

**Type:**

```typescript
type SAPAIEmbeddingProviderOptions = {
  api?: "orchestration" | "foundation-models";
  type?: "text" | "query" | "document";
  modelParams?: {
    dimensions?: number;
    encoding_format?: "base64" | "binary" | "float";
    normalize?: boolean;
    [key: string]: unknown;
  };
};
```

---

## Types

### `SAPAIModelId`

Model identifier type for SAP AI Core models.

**Type:**

```typescript
export type SAPAIModelId = ChatModel; // Provider-specific alias of the upstream type
```

**Description:**

`SAPAIModelId` aliases the `ChatModel` type from `@sap-ai-sdk/orchestration`
for the provider's model ID contract. Referencing the upstream type keeps the
accepted model identifiers synchronized with SAP AI SDK without redefining its
structure.

**For complete model information, see the [Models](#models) section above**,
including:

- Available model list (OpenAI, Google, Anthropic, Amazon, Open Source)
- Model capabilities comparison
- Selection guide by use case
- Performance trade-offs

---

### `SAPAIApiType`

API type selector for SAP AI Core.

**Type:**

```typescript
export type SAPAIApiType = "orchestration" | "foundation-models";
```

**Description:**

Determines which SAP AI Core API to use:

- `"orchestration"` (default): Full-featured API with data masking, content
  filtering, document grounding, and translation capabilities
- `"foundation-models"`: Direct model access with additional parameters like
  `logprobs`, `seed`, `logit_bias`, and `dataSources`

See [API Comparison](#api-comparison-orchestration-vs-foundation-models) for a
detailed feature matrix.

---

### `PromptTemplateRef`

Reference to a template in SAP AI Core's Prompt Registry.

**Types:**

```typescript
// Scope determines where the template is accessible
export type PromptTemplateScope = "tenant" | "resource_group";

// Reference by template ID
export interface PromptTemplateRefByID {
  readonly id: string;
  readonly scope?: PromptTemplateScope; // Default: "tenant"
}

// Reference by scenario/name/version
export interface PromptTemplateRefByScenarioNameVersion {
  readonly scenario: string;
  readonly name: string;
  readonly version: string;
  readonly scope?: PromptTemplateScope; // Default: "tenant"
}

// Union type for both reference methods
export type PromptTemplateRef = PromptTemplateRefByID | PromptTemplateRefByScenarioNameVersion;
```

**Description:**

The Prompt Registry allows you to manage prompt templates centrally in SAP AI Core
and reference them in your application. When `promptTemplateRef` is provided,
the orchestration config uses `template_ref` instead of an empty inline
`template`; conversation messages are passed separately as `messagesHistory`
rather than `messages`.

**Usage Examples:**

```typescript
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

const provider = createSAPAIProvider();

// Reference by ID (simplest form)
const modelById = provider("gpt-4.1", {
  promptTemplateRef: { id: "my-template-id" },
});

// Reference by ID with explicit scope
const modelByIdWithScope = provider("gpt-4.1", {
  promptTemplateRef: {
    id: "my-template-id",
    scope: "resource_group",
  },
});

// Reference by scenario/name/version
const modelByScenario = provider("gpt-4.1", {
  promptTemplateRef: {
    scenario: "customer-support",
    name: "greeting-template",
    version: "latest",
  },
});

// Override via providerOptions at invocation time
const result = await generateText({
  model: modelById,
  prompt: "Hello",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: {
      promptTemplateRef: { id: "different-template" },
    },
  },
});
```

**With Placeholder Values:**

Prompt Registry templates often contain placeholders. Use `placeholderValues` to
provide values for these placeholders:

```typescript
const model = provider("gpt-4.1", {
  promptTemplateRef: {
    scenario: "customer-support",
    name: "personalized-greeting",
    version: "1.0.0",
  },
  placeholderValues: {
    customerName: "Alice",
    supportTopic: "billing",
  },
});
```

> **Note:** `promptTemplateRef` is only available with the Orchestration API (default).
> It is not supported with the Foundation Models API.

**See Also:**

- [SAP AI Core Prompt Registry Documentation](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/prompt-registry)

---

### Orchestration configuration reference types

SAP AI SDK types for references to complete orchestration configurations stored
in SAP AI Core. They are re-exported unchanged by this package.
`OrchestrationConfigRef` remains available for backward compatibility and keeps
its upstream deprecation; new code should use `OrchestrationConfigRefById` or
`OrchestrationConfigRefByName`.

**Types:**

```typescript
import type { OrchestrationConfigRef, OrchestrationConfigRefById, OrchestrationConfigRefByName, OrchestrationConfigRefOverride } from "@jerome-benoit/sap-ai-provider";
```

**Description:**

The `orchestrationConfigRef` allows you to reference a complete orchestration
configuration stored in SAP AI Core instead of specifying individual modules
(filtering, masking, grounding, etc.) in your code. When `orchestrationConfigRef`
is provided, the configuration is fetched from SAP AI Core and used to create
the `OrchestrationClient`.

Each reference variant accepts an optional `overrideConfig`
(`OrchestrationConfigRefOverride`, re-exported from `@sap-ai-sdk/orchestration`).
It is forwarded verbatim to the `OrchestrationClient` constructor and overrides
parts of the stored configuration per request. It is **not** subject to the
ignored-local-modules behavior above, since it is part of the reference itself.
Only its transport shape is validated (non-null, non-array object; any
`stream` value must also be a non-null, non-array object without an `enabled`
property, which is controlled by the call site). See the SAP AI SDK type
definition for the accepted structure.

An invalid reference (settings path) is ignored with a warning and the request
falls back to local module settings; via provider options, an invalid `sap-ai`
block is rejected before the request is sent.

**Important Behavior:** When using `orchestrationConfigRef`, local module
settings (filtering, masking, grounding, translation, tools, promptTemplateRef,
responseFormat, modelParams, modelVersion, fallbackModuleConfigs) and supplied
standard generation options (such as temperature, maxOutputTokens, and V4
reasoning) are **ignored** with a warning. Only messages and placeholder values
are passed through to the stored configuration, alongside its explicit
`overrideConfig` when provided. Streaming still applies local `streamOptions`
through the SAP SDK stream call options.

**Usage Examples:**

```typescript
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

const provider = createSAPAIProvider();

// Reference by ID (simplest form)
const modelById = provider("gpt-4.1", {
  orchestrationConfigRef: { id: "my-config-id" },
});

// Reference by scenario/name/version
const modelByScenario = provider("gpt-4.1", {
  orchestrationConfigRef: {
    scenario: "customer-support",
    name: "standard-config",
    version: "1.0.0",
  },
});

// Override via providerOptions at invocation time
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Hello",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: {
      orchestrationConfigRef: { id: "different-config" },
    },
  },
});
```

**With Placeholder Values:**

Stored orchestration configurations may contain template placeholders. Use
`placeholderValues` to provide values for these placeholders:

```typescript
const model = provider("gpt-4.1", {
  orchestrationConfigRef: {
    scenario: "customer-support",
    name: "personalized-config",
    version: "1.0.0",
  },
  placeholderValues: {
    customerName: "Alice",
    supportTopic: "billing",
  },
});
```

**Difference from `promptTemplateRef`:**

- `promptTemplateRef` - References only a **prompt template** from the Prompt
  Registry. You still configure modules (filtering, masking, etc.) locally.
- `orchestrationConfigRef` - References a **complete orchestration configuration**
  including all modules. Local module settings are ignored.

> **Note:** `orchestrationConfigRef` is only available with the Orchestration
> API (default). It is not supported with the Foundation Models API.

**See Also:**

- [SAP AI Core Configuration Documentation](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide)

---

### API-Specific Settings Types

The following types provide type-safe configuration for each API. They are
discriminated union types that TypeScript can narrow based on the `api` field.

#### `OrchestrationModelSettings`

Settings for the Orchestration API (default).

**Type:**

```typescript
export interface OrchestrationModelSettings {
  readonly api?: "orchestration";
  readonly escapeTemplatePlaceholders?: boolean; // Default: true
  readonly fallbackModuleConfigs?: OrchestrationModuleConfig[];
  readonly filtering?: FilteringModule;
  readonly grounding?: GroundingModule;
  readonly includeReasoning?: boolean;
  readonly masking?: MaskingModule | { providers: MaskingModule["masking_providers"] };
  readonly modelParams?: OrchestrationModelParams;
  readonly modelVersion?: string;
  readonly orchestrationConfigRef?: OrchestrationConfigRefById | OrchestrationConfigRefByName;
  readonly placeholderValues?: Record<string, string>;
  readonly promptTemplateRef?: PromptTemplateRef;
  readonly responseFormat?: ResponseFormat;
  readonly streamOptions?: OrchestrationStreamOptions;
  readonly tools?: ChatCompletionTool[];
  readonly translation?: TranslationModule;
}
```

**Orchestration-Only Features:**

- `filtering` - Content safety filtering (Azure Content Safety, LlamaGuard)
- `fallbackModuleConfigs` - Ordered fallback `OrchestrationModuleConfig` entries used when local orchestration configuration is active
- `grounding` - Document-based RAG via SAP HANA Vector Engine
- `masking` - Data anonymization via SAP DPI
- `translation` - Input/output translation
- `escapeTemplatePlaceholders` - Prevent template syntax conflicts
- `promptTemplateRef` - Reference templates from SAP AI Core Prompt Registry
- `orchestrationConfigRef` - Reference complete configurations from SAP AI Core. When set, local module settings and `fallbackModuleConfigs` are ignored because the stored configuration owns the module list

`fallbackModuleConfigs` accepts full SAP AI SDK `OrchestrationModuleConfig`
objects. The provider sends the primary module configuration first, followed by
fallback entries in the order provided. SAP AI Core decides when to try a
fallback. This option is bypassed when `orchestrationConfigRef` is set.

```typescript
const model = provider("gpt-4.1", {
  fallbackModuleConfigs: [
    {
      promptTemplating: {
        model: { name: "gpt-4.1-mini" },
        prompt: { template: [] },
      },
    },
  ],
});
```

#### `FoundationModelsModelSettings`

Settings for the Foundation Models API.

**Type:**

```typescript
export interface FoundationModelsModelSettings {
  readonly api: "foundation-models"; // Required discriminant
  readonly dataSources?: AzureOpenAiChatExtensionConfiguration[];
  readonly includeReasoning?: boolean;
  readonly modelParams?: FoundationModelsModelParams;
  readonly modelVersion?: string;
  readonly responseFormat?: ResponseFormat;
}
```

**Foundation Models-Only Features:**

- `dataSources` - Azure OpenAI "On Your Data" (Azure AI Search, Cosmos DB)
- Advanced `modelParams`: `logprobs`, `seed`, `logit_bias`, `stop`, `top_logprobs`, `user`

#### `SAPAIModelSettings`

Union type that accepts either API's settings:

```typescript
export type SAPAIModelSettings = OrchestrationModelSettings | FoundationModelsModelSettings;
```

---

### Model Parameters Types

#### `CommonModelParams`

Parameters shared by both APIs:

```typescript
export interface CommonModelParams {
  readonly frequencyPenalty?: number; // -2.0 to 2.0
  readonly maxTokens?: number;
  readonly n?: number; // Not supported by Amazon/Anthropic
  readonly parallel_tool_calls?: boolean;
  readonly presencePenalty?: number; // -2.0 to 2.0
  readonly temperature?: number; // 0 to 2
  readonly topP?: number; // 0 to 1
  readonly [key: string]: unknown; // Additional model-specific parameters
}
```

#### `OrchestrationModelParams`

Orchestration API model parameters (same as `CommonModelParams`):

```typescript
export type OrchestrationModelParams = CommonModelParams;
```

#### `FoundationModelsModelParams`

Foundation Models API parameters with additional options:

```typescript
export interface FoundationModelsModelParams extends CommonModelParams {
  readonly logit_bias?: Record<string, number> | null; // Token likelihood modification
  readonly logprobs?: boolean | null; // Request backend log probabilities
  readonly seed?: number | null; // Best-effort reproducibility, not guaranteed
  readonly stop?: string | string[]; // Stop sequences
  readonly top_logprobs?: number | null; // 0-20, requires logprobs=true
  readonly user?: string; // End-user identifier
}
```

#### `FoundationModelsEmbeddingParams`

Embedding-specific parameters for Foundation Models API:

```typescript
export interface FoundationModelsEmbeddingParams {
  readonly dimensions?: number; // Output embedding dimensions
  readonly encoding_format?: "base64" | "float";
  readonly user?: string; // End-user identifier
}
```

---

### Default Settings Configuration Types

These types enable type-safe provider-level default settings.

#### `OrchestrationDefaultSettings`

```typescript
export interface OrchestrationDefaultSettings {
  readonly api?: "orchestration";
  readonly settings?: OrchestrationModelSettings;
}
```

#### `FoundationModelsDefaultSettings`

```typescript
export interface FoundationModelsDefaultSettings {
  readonly api: "foundation-models"; // Required discriminant
  readonly settings?: FoundationModelsModelSettings;
}
```

#### `SAPAIDefaultSettingsConfig`

Union type for grouping an API selector and its settings. Pass `config.api`
as the provider `api` and `config.settings` as `defaultSettings`, not the wrapper
object itself:

```typescript
export type SAPAIDefaultSettingsConfig = OrchestrationDefaultSettings | FoundationModelsDefaultSettings;
```

**Example usage:**

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import type { FoundationModelsDefaultSettings } from "@jerome-benoit/sap-ai-provider";

// Type-safe Foundation Models configuration
const config: FoundationModelsDefaultSettings = {
  api: "foundation-models",
  settings: {
    api: "foundation-models",
    modelParams: { seed: 42, logprobs: true },
  },
};

const provider = createSAPAIProvider({
  api: config.api,
  defaultSettings: config.settings,
});
```

---

### `DpiEntities`

Standard entity types recognized by SAP DPI. `DpiEntities` is an upstream SAP
schema type, not a type re-exported by this provider. Use the
`buildDpiMaskingProvider` builder for checked entity values.

**Available Types:**

- `profile-person` - Person names
- `profile-org` - Organization names
- `profile-location` - Locations
- `profile-email` - Email addresses
- `profile-phone` - Phone numbers
- `profile-address` - Physical addresses
- `profile-sapids-internal` - Internal SAP IDs
- `profile-url` - URLs
- `profile-nationalid` - National ID numbers
- `profile-iban` - IBAN numbers
- `profile-ssn` - Social Security Numbers
- `profile-credit-card-number` - Credit card numbers
- `profile-passport` - Passport numbers
- `profile-driverlicense` - Driver's license numbers
- And many more (see type definition)

---

## Classes

### `SAPAILanguageModel`

Implementation of Vercel AI SDK's `LanguageModelV3` interface.

**Properties:**

| Property               | Type                       | Description                                         |
| ---------------------- | -------------------------- | --------------------------------------------------- |
| `specificationVersion` | `'v3'`                     | API specification version (readonly)                |
| `modelId`              | `SAPAIModelId`             | Current model identifier (readonly)                 |
| `provider`             | `string`                   | Provider identifier (getter, e.g., `'sap-ai.chat'`) |
| `supportedUrls`        | `Record<string, RegExp[]>` | URL patterns for supported media (getter)           |

**Methods:**

#### `doGenerate(options)`

Generate a single completion (non-streaming).

**Signature:**

```typescript
async doGenerate(
  options: LanguageModelV3CallOptions
): Promise<LanguageModelV3GenerateResult>
```

**Example:**

```typescript
const result = await model.doGenerate({
  prompt: [{ role: "user", content: [{ type: "text", text: "Hello!" }] }],
});
```

#### `doStream(options)`

Generate a streaming completion.

**Signature:**

```typescript
async doStream(
  options: LanguageModelV3CallOptions
): Promise<LanguageModelV3StreamResult>
```

**Stream Events:**

The stream emits the following event types. Text and tool-input events can
interleave; the table describes each event's lifecycle rather than one fixed
sequence for every response:

| Event Type          | Description                                      | When Emitted                        |
| ------------------- | ------------------------------------------------ | ----------------------------------- |
| `stream-start`      | Stream initialization with warnings              | First, before any content           |
| `response-metadata` | Model ID, timestamp, and response ID             | After first chunk received          |
| `text-start`        | Text block begins (includes unique block ID)     | When text generation starts         |
| `text-delta`        | Incremental text chunk                           | For each text token                 |
| `text-end`          | Text block completes                             | When text generation ends           |
| `tool-input-start`  | Tool input begins (includes tool ID and name)    | When tool call starts               |
| `tool-input-delta`  | Incremental tool arguments                       | For each tool argument chunk        |
| `tool-input-end`    | Tool input completes                             | When tool arguments complete        |
| `tool-call`         | Complete tool call with ID, name, and full input | After tool-input-end                |
| `source`            | URL citation returned by the SDK                 | Before finish, when available       |
| `finish`            | Stream completes with usage and finish reason    | Last event on success               |
| `error`             | Error occurred during streaming                  | On error (stream then closes)       |
| `raw`               | Raw SDK chunk (when `includeRawChunks: true`)    | For each chunk, before other events |

**Raw Chunks Option:**

When `includeRawChunks: true` is passed in options, the stream will emit
additional `raw` events containing each SDK chunk's `_data` payload when
available, or the chunk itself otherwise. This is useful for debugging or
accessing provider-specific data not exposed through standard events.

```typescript
const { stream } = await model.doStream({
  prompt: [...],
  includeRawChunks: true,
});

for await (const part of stream) {
  if (part.type === "raw") {
    console.log("Raw chunk:", part.rawValue);
  }
}
```

**Example:**

```typescript
const { stream } = await model.doStream({
  prompt: [
    {
      role: "user",
      content: [{ type: "text", text: "Write a story" }],
    },
  ],
});

for await (const part of stream) {
  switch (part.type) {
    case "text-delta":
      process.stdout.write(part.delta);
      break;
    case "tool-call":
      console.log(`Tool called: ${part.toolName}`, part.input);
      break;
    case "finish":
      console.log("Usage:", part.usage);
      break;
    case "error":
      console.error("Stream error:", part.error);
      break;
  }
}
```

> **Note:** Streaming response IDs (`response-metadata.id`) are extracted from
> the server's completion response when available. `providerMetadata[providerName].requestId`
> exposes the SAP request correlation id — see
> [Provider Metadata](#provider-metadata-in-responses).

---

### Provider Metadata in Responses

`doGenerate` results include `providerMetadata` with SAP-specific fields under
the provider name key (default: `"sap-ai"`). For direct `doStream` calls,
metadata is on the stream `finish` event, not the returned result object. With
the high-level `streamText` API, use `finish-step` events or await
`result.providerMetadata`.

**Generation response body:** `doGenerate().response.body` is a provider-built
summary containing `content`, `finishReason`, `tokenUsage`, and `toolCalls`
from SAP SDK accessors. It is not the complete raw SAP HTTP response.

**Orchestration request metadata limitation:** The `request.body` returned by
`doGenerate` and `doStream` contains the SAP SDK per-call inputs (messages or
message history, and placeholder values), not the complete serialized HTTP
body. The SDK adds the client configuration, including model parameters and
modules, when sending the HTTP request. Do not use `request.body` as a full
wire-payload audit. This limitation also applies through the V2 and V4 facades.

**`doGenerate` — `providerMetadata[providerName]`:**

| Field                  | Type                  | Description                                                                                                |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cacheUsage`           | `object \| undefined` | Anthropic prompt-cache breakdown (`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`) when populated |
| `finishReason`         | `string`              | Raw finish reason from the SDK; defaults to `"unknown"` when the SDK omits it                              |
| `finishReasonMapped`   | `object`              | Mapped finish reason (`{ raw, unified }`); `raw` preserves the unmodified SDK value (or `undefined`)       |
| `intermediateFailures` | `array \| undefined`  | Errors from fallback retries (orchestration)                                                               |
| `requestId`            | `string \| undefined` | SAP request correlation id (from the SDK response; falls back to the `x-request-id` header)                |
| `version`              | `string`              | Provider package version                                                                                   |

**`doStream` — `finish` event `providerMetadata[providerName]`:**

| Field                  | Type                  | Description                                                                                                |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cacheUsage`           | `object \| undefined` | Anthropic prompt-cache breakdown (`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`) when populated |
| `finishReason`         | `string`              | Raw finish reason from the SDK; defaults to `"unknown"` when the SDK omits it                              |
| `finishReasonMapped`   | `object`              | Mapped finish reason (`{ raw, unified }`); `raw` preserves the unmodified SDK value (or `undefined`)       |
| `intermediateFailures` | `array \| undefined`  | Errors from fallback retries (orchestration)                                                               |
| `requestId`            | `string \| undefined` | SAP request correlation id (from the SDK response; falls back to the `x-request-id` header)                |
| `responseId`           | `string`              | Server completion ID or client-generated UUID                                                              |
| `version`              | `string`              | Provider package version                                                                                   |

**Example (non-streaming):**

```typescript
import { generateText } from "ai";
import { SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Hello",
});

const metadata = result.providerMetadata?.[SAP_AI_PROVIDER_NAME];
console.log(metadata?.requestId); // "abc-123-def" (SAP pipeline correlation id)
console.log(metadata?.version); // Installed provider package version
```

**Example (streaming):**

```typescript
import { streamText } from "ai";
import { SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

const result = streamText({
  model: provider("gpt-4.1"),
  prompt: "Hello",
});

for await (const part of result.fullStream) {
  if (part.type === "finish-step") {
    const metadata = part.providerMetadata?.[SAP_AI_PROVIDER_NAME];
    console.log(metadata?.requestId); // SAP pipeline correlation id
    console.log(metadata?.responseId); // Server completion ID or generated fallback
  }
}
```

---

### Error Handling & Reference

> **Architecture Details:** For internal error conversion logic and retry
> mechanisms, see
> [Architecture - Error Handling](./ARCHITECTURE.md#error-handling).

The provider uses standard Vercel AI SDK error types for consistent error
handling across providers.

#### Error Types

**`APICallError`** - Thrown for HTTP/API errors (from `@ai-sdk/provider`)

Properties:

- `message`: Error description with helpful context
- `statusCode`: Status derived from the SDK error; may be a fallback `500` when the original HTTP status is unavailable
- `url`: Request context identifier (for example, `sap-ai:orchestration`), not necessarily an HTTP URL
- `requestBodyValues`: Provider request summary, not necessarily the complete request body
- `responseHeaders`: Response headers, when available
- `responseBody`: Serialized error details, when available; structured SAP errors are normalized
- `isRetryable`: Whether the caller may retry (HTTP 408, 409, 429, and 5xx are eligible)

**`LoadAPIKeyError`** - Thrown for authentication/configuration errors (from
`@ai-sdk/provider`)

Properties:

- `message`: Error description with setup instructions

**`UnsupportedFeatureError`** - Thrown when using API-specific features with the
wrong API

Properties:

- `name`: `"UnsupportedFeatureError"`
- `feature`: The unsupported feature name (e.g., `"Content filtering"`)
- `api`: The API being used where the feature is not supported
- `suggestedApi`: The API that supports this feature

Example:

```typescript
import { UnsupportedFeatureError } from "@jerome-benoit/sap-ai-provider";

try {
  // Using filtering with Foundation Models API
  const model = provider("gpt-4.1", {
    api: "foundation-models",
    filtering: {}, // Orchestration-only configuration
  });
  // API-specific feature validation happens when the model is invoked.
  await generateText({ model, prompt: "Hello" });
} catch (error) {
  if (error instanceof UnsupportedFeatureError) {
    console.error(error.message);
    // The request is rejected before the SAP SDK call.
    console.error("Feature:", error.feature); // "Content filtering"
    console.error("Current API:", error.api); // "foundation-models"
    console.error("Suggested API:", error.suggestedApi); // "orchestration"
  }
}
```

**`ApiSwitchError`** - Thrown when switching APIs at invocation time conflicts
with model-level settings

Properties:

- `name`: `"ApiSwitchError"`
- `fromApi`: The API the model was configured with
- `toApi`: The API being switched to at invocation time
- `conflictingFeature`: The feature that prevents the switch

Example:

```typescript
import { ApiSwitchError } from "@jerome-benoit/sap-ai-provider";

// Model configured with Orchestration-only feature
const model = provider("gpt-4.1", {
  filtering: {/* ... */},
});

try {
  // Attempt to switch to Foundation Models at invocation time
  await generateText({
    model,
    prompt: "Hello",
    providerOptions: {
      [SAP_AI_PROVIDER_NAME]: { api: "foundation-models" },
    },
  });
} catch (error) {
  if (error instanceof ApiSwitchError) {
    console.error(error.message);
    // "Cannot switch from orchestration to foundation-models API at invocation time
    //  because the model was configured with filtering. Create a new model instance instead."
    console.error("From:", error.fromApi); // "orchestration"
    console.error("To:", error.toApi); // "foundation-models"
    console.error("Conflict:", error.conflictingFeature); // "filtering"
  }
}
```

#### SAP-Specific Error Details

Recognized structured SAP errors that become `APICallError` are normalized
into the JSON shape below in `responseBody`; if SAP returns an error array,
only its first entry is represented. Structured 401/403/404 errors instead
become `LoadAPIKeyError`/`NoSuchModelError`, with any request ID in the message
rather than a `responseBody` property. Generic Axios errors may retain a
different response-body shape.

```typescript
{
  error: {
    message: string;
    code?: number;
    location?: string;
    request_id?: string;
  }
}
```

#### Error Handling Examples

```typescript
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";

try {
  const result = await generateText({
    model: provider("gpt-4.1"),
    prompt: "Hello",
  });
} catch (error) {
  if (error instanceof LoadAPIKeyError) {
    // 401/403: Authentication/permission issue
    console.error("Setup error:", error.message);
    // Check AICORE_SERVICE_KEY environment variable
  } else if (error instanceof NoSuchModelError) {
    // 404: Model or deployment not found
    console.error("Model not found:", error.modelId);
  } else if (error instanceof APICallError) {
    // Other API/HTTP errors (400, 429, 5xx, etc.)
    console.error("API error:", error.message);
    console.error("Status:", error.statusCode);
    console.error("Retryable:", error.isRetryable);

    const responseBody = error.responseBody;
    if (responseBody) {
      try {
        const sapError = JSON.parse(responseBody) as {
          error?: { code?: number; location?: string; request_id?: string };
        };
        console.error("SAP Error Code:", sapError.error?.code);
        console.error("Location:", sapError.error?.location);
        console.error("Request ID:", sapError.error?.request_id);
      } catch {
        console.error("SAP error body:", responseBody);
      }
    }
  }
}
```

#### HTTP Status Code Reference

The error types below describe recognized structured SAP error responses.
Without that structured envelope, classification also depends on the error
message: for example, `Request failed with status code 401` produces a
non-retryable `APICallError`, while authentication-keyword matches produce
`LoadAPIKeyError`. Auto-Retry means eligible for high-level AI SDK retries
subject to `maxRetries`, not a guarantee that the request succeeds.

The SDK can lose the original status and body before the provider receives an
error. In particular, a non-JSON streaming error response can become a JSON
parsing error in the SAP SDK. The provider then reports a non-retryable
`APICallError` with fallback status `500`, not the original HTTP status.

| Code | Description           | Error Type         | Auto-Retry | Common Causes                  | Recommended Action                              | Guide                                                                       |
| :--: | :-------------------- | :----------------- | :--------: | :----------------------------- | :---------------------------------------------- | :-------------------------------------------------------------------------- |
| 400  | Bad Request           | `APICallError`     |     ❌     | Invalid parameters             | Validate configuration against TypeScript types | [→ Guide](./TROUBLESHOOTING.md#problem-400-bad-request)                     |
| 401  | Unauthorized          | `LoadAPIKeyError`  |     ❌     | Invalid/expired credentials    | Check `AICORE_SERVICE_KEY` environment variable | [→ Guide](./TROUBLESHOOTING.md#problem-authentication-failed-or-401-errors) |
| 403  | Forbidden             | `LoadAPIKeyError`  |     ❌     | Insufficient permissions       | Verify service key has required roles           | [→ Guide](./TROUBLESHOOTING.md#problem-403-forbidden)                       |
| 404  | Not Found             | `NoSuchModelError` |     ❌     | Invalid model ID or deployment | Verify deployment ID and model name             | [→ Guide](./TROUBLESHOOTING.md#problem-404-modeldeployment-not-found)       |
| 408  | Request Timeout       | `APICallError`     |     ✅     | Request took too long          | Automatic retry                                 | [→ Guide](./TROUBLESHOOTING.md#problem-500502503504-server-errors)          |
| 409  | Conflict              | `APICallError`     |     ✅     | Transient conflict             | Automatic retry                                 | [→ Guide](./TROUBLESHOOTING.md#problem-500502503504-server-errors)          |
| 429  | Too Many Requests     | `APICallError`     |     ✅     | Rate limit exceeded            | Automatic exponential backoff                   | [→ Guide](./TROUBLESHOOTING.md#problem-429-rate-limit-exceeded)             |
| 500  | Internal Server Error | `APICallError`     |     ✅     | Service issue                  | Automatic retry, check SAP AI Core status       | [→ Guide](./TROUBLESHOOTING.md#problem-500502503504-server-errors)          |
| 502  | Bad Gateway           | `APICallError`     |     ✅     | Network/proxy issue            | Automatic retry                                 | [→ Guide](./TROUBLESHOOTING.md#problem-500502503504-server-errors)          |
| 503  | Service Unavailable   | `APICallError`     |     ✅     | Service temporarily down       | Automatic retry                                 | [→ Guide](./TROUBLESHOOTING.md#problem-500502503504-server-errors)          |
| 504  | Gateway Timeout       | `APICallError`     |     ✅     | Request timeout                | Automatic retry, reduce request complexity      | [→ Guide](./TROUBLESHOOTING.md#problem-500502503504-server-errors)          |

#### Error Handling Strategy

The provider marks transient HTTP errors (408, 409, 429, 5xx) as retryable.
High-level AI SDK calls perform retries with exponential backoff, bounded by
`maxRetries`; direct `doGenerate`, `doStream`, and `doEmbed` calls do not add a
retry loop. Errors after streaming has started require application handling.

**See also:** [Troubleshooting Guide](./TROUBLESHOOTING.md) for detailed solutions
to each error type.

---

### `OrchestrationErrorResponse`

SAP AI SDK error response type re-exported unchanged for advanced usage.

**Import:**

```typescript
import type { OrchestrationErrorResponse } from "@jerome-benoit/sap-ai-provider";
```

Its structure is defined by `@sap-ai-sdk/orchestration`; consumers inherit
upstream changes without a local type copy. Refer to the
[SAP AI SDK source](https://github.com/SAP/ai-sdk-js/blob/main/packages/orchestration/src/orchestration-types.ts)
for the current definition.

---

### Re-exported SAP AI SDK Classes

The following classes are re-exported from `@sap-ai-sdk/orchestration` for
advanced usage scenarios where direct access to SDK responses is needed:

| Class                              | Description                     |
| ---------------------------------- | ------------------------------- |
| `OrchestrationClient`              | Direct orchestration API client |
| `OrchestrationEmbeddingClient`     | Direct embedding API client     |
| `OrchestrationResponse`            | Non-streaming response wrapper  |
| `OrchestrationStream`              | Streaming response handler      |
| `OrchestrationStreamResponse`      | Streaming response wrapper      |
| `OrchestrationStreamChunkResponse` | Individual stream chunk         |
| `OrchestrationEmbeddingResponse`   | Embedding response wrapper      |

> **Note:** Most users should use `createSAPAIProvider()` instead of these
> low-level classes. These are re-exported from `@sap-ai-sdk/orchestration` for
> advanced integration scenarios where direct SDK access is required.
>
> For `OrchestrationClient` usage, refer to the
> [SAP AI SDK documentation](https://github.com/SAP/ai-sdk-js/tree/main/packages/orchestration).

---

### Re-exported SAP AI SDK Types

The following types are re-exported from `@sap-ai-sdk/orchestration` for advanced
usage scenarios. Refer to the
[SAP AI SDK documentation](https://github.com/SAP/ai-sdk-js) for complete type
definitions.

**Chat Message Types:**

| Type                         | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `AssistantChatMessage`       | Message from the assistant                    |
| `ChatMessage`                | Union type for all chat message types         |
| `ChatMessageContent`         | Content union for chat messages               |
| `ChatMessages`               | Array of `ChatMessage` (message list alias)   |
| `DeveloperChatMessage`       | System/developer instructions                 |
| `SystemChatMessage`          | System message (alias for developer)          |
| `ToolChatMessage`            | Tool/function call result message             |
| `UserChatMessage`            | Message from the user                         |
| `UserChatMessageContent`     | Content for user messages (text, image, file) |
| `UserChatMessageContentItem` | Single content item in a user message         |

**Configuration Types:**

| Type                                    | Description                                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| `AzureOpenAiChatExtensionConfiguration` | Azure OpenAI data source configuration                        |
| `ChatCompletionRequest`                 | Full chat completion request structure                        |
| `ChatCompletionTool`                    | Tool definition for function calling                          |
| `FunctionObject`                        | Function schema within a tool                                 |
| `LlmModelDetails`                       | Model configuration details                                   |
| `LlmModelParams`                        | Model-specific parameters                                     |
| `OrchestrationConfigRef`                | Deprecated upstream configuration reference                   |
| `OrchestrationConfigRefById`            | Stored configuration reference by ID                          |
| `OrchestrationConfigRefByName`          | Stored configuration reference by scenario, name, and version |
| `OrchestrationModuleConfig`             | Full orchestration module configuration                       |
| `OrchestrationModuleConfigList`         | Ordered list of configs with fallbacks                        |
| `PromptTemplatingModule`                | Prompt template configuration                                 |

**Module Configuration Types:**

| Type                                 | Description                      |
| ------------------------------------ | -------------------------------- |
| `FilteringModule`                    | Content filtering configuration  |
| `GroundingModule`                    | Document grounding configuration |
| `MaskingModule`                      | Data masking configuration       |
| `TranslationModule`                  | Translation module configuration |
| `TranslationInputParameters`         | Input translation settings       |
| `TranslationOutputParameters`        | Output translation settings      |
| `TranslationTargetLanguage`          | Target language specification    |
| `TranslationApplyToCategory`         | Translation scope selector       |
| `DocumentTranslationApplyToSelector` | Document translation selector    |

**Content & Response Types:**

| Type              | Description                         |
| ----------------- | ----------------------------------- |
| `Citation`        | Source citation from model response |
| `FileContent`     | File content in user messages       |
| `ImageContentUrl` | Image URL content in user messages  |

**Error Types:**

| Type                 | Description                               |
| -------------------- | ----------------------------------------- |
| `OrchestrationError` | Error from orchestration module execution |

**Example:**

```typescript
import type { ChatMessage, FilteringModule, GroundingModule } from "@jerome-benoit/sap-ai-provider";

// Type-safe module configuration
const filtering: FilteringModule = {
  input: {/* ... */},
  output: {/* ... */},
};
```

**Fallback Configuration with `OrchestrationModuleConfigList`:**

An ordered list of configurations where the orchestration service tries each in
order, falling back to the next if the prompt module is unavailable.

```typescript
import type { OrchestrationModuleConfigList } from "@jerome-benoit/sap-ai-provider";

const configWithFallbacks: OrchestrationModuleConfigList = [
  {
    promptTemplating: {
      model: { name: "gpt-4.1" },
      prompt: { template: [{ role: "user", content: "Explain quantum computing." }] },
    },
  },
  {
    promptTemplating: {
      model: { name: "gpt-4.1-mini" },
      prompt: { template: [{ role: "user", content: "Explain quantum computing." }] },
    },
  },
];
```

> **Note:** These types are re-exported for convenience. They originate from
> `@sap-ai-sdk/orchestration` and follow SAP AI SDK conventions.

---

### `DeploymentConfig`

SAP SDK deployment configuration: a deployment ID or an optional resource group.

**Type:**

```typescript
type DeploymentConfig = { deploymentId: string } | { resourceGroup?: string };
```

**Properties:**

| Property        | Type     | Description                                                   |
| --------------- | -------- | ------------------------------------------------------------- |
| `deploymentId`  | `string` | Required in the deployment-ID variant (skips auto-resolution) |
| `resourceGroup` | `string` | Optional in the resource-group variant (default: `"default"`) |

**Example:**

```typescript
import { createSAPAIProvider, type DeploymentConfig } from "@jerome-benoit/sap-ai-provider";

const deploymentConfig: DeploymentConfig = {
  deploymentId: "d1234567-89ab-cdef-0123-456789abcdef",
  resourceGroup: "my-resource-group",
};

const provider = createSAPAIProvider(deploymentConfig);
```

---

## Utility Functions

> **Architecture Context:** For message transformation flow and format details,
> see [Architecture - Message Conversion](./ARCHITECTURE.md#message-conversion).

SAP builder signatures below use upstream SAP SDK type names. Those parameter
and return types are not all re-exported by this provider; prefer inferred
builder results or `Parameters<typeof builder>` / `ReturnType<typeof builder>`
when a named type is not listed in this reference's re-export tables.

### `getProviderName(providerIdentifier)`

Extracts the provider name from a provider identifier.

Following the AI SDK convention, provider identifiers use the format
`{name}.{type}` (e.g., `"openai.chat"`, `"anthropic.messages"`). This
function extracts the provider name for use with `providerOptions` and
`providerMetadata`, which use the provider name as key.

**Signature:**

```typescript
function getProviderName(providerIdentifier: string): string;
```

**Parameters:**

- `providerIdentifier`: The provider identifier (e.g., `"sap-ai.chat"`,
  `"sap-ai.embedding"`)

**Returns:** The segment before the first dot, or the entire identifier when
there is no dot (e.g., `"sap-ai.chat"` → `"sap-ai"`, `"sap.ai.chat"` → `"sap"`).

**Example:**

```typescript
import { getProviderName } from "@jerome-benoit/sap-ai-provider";

getProviderName("sap-ai.chat"); // => "sap-ai"
getProviderName("sap-ai-core.embedding"); // => "sap-ai-core"
getProviderName("sap-ai"); // => "sap-ai" (no type suffix)
```

**Use Case:**

This function is useful when working with dynamic provider names or when you
need to access `providerMetadata` using the model's provider identifier:

```typescript
import { createSAPAIProvider, getProviderName } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

const provider = createSAPAIProvider({ name: "my-sap" });
const model = provider("gpt-4.1");

const result = await generateText({ model, prompt: "Hello" });

// Use getProviderName to access metadata with the correct key
const providerName = getProviderName(model.provider); // "my-sap"
const metadata = result.providerMetadata?.[providerName];
```

---

### `resolveApi(providerApi, modelApi, invocationApi)`

Resolves the effective API type using the precedence chain.

**Signature:**

```typescript
function resolveApi(providerApi: SAPAIApiType | undefined, modelApi: SAPAIApiType | undefined, invocationApi: SAPAIApiType | undefined): SAPAIApiType;
```

**Parameters:**

- `providerApi`: API set at provider creation (`createSAPAIProvider({ api })`)
- `modelApi`: Effective model API after merging explicit model settings over
  `defaultSettings.api`
- `invocationApi`: API set at invocation (`providerOptions[providerName].api`)

**Returns:** The resolved API type to use (highest precedence wins)

**Precedence (highest to lowest):**

1. Invocation-time override
2. Model-level setting
3. Provider-level setting
4. System default (`"orchestration"`)

The provider factory merges model settings before calling this helper. Thus
the full provider precedence is invocation override, explicit model `api`,
provider `defaultSettings.api`, provider `api`, then `"orchestration"`. API-specific
settings validation can still reject an incompatible override.

**Example:**

```typescript
import { resolveApi } from "@jerome-benoit/sap-ai-provider";

resolveApi(undefined, undefined, undefined); // "orchestration"
resolveApi("foundation-models", undefined, undefined); // "foundation-models"
resolveApi("foundation-models", "orchestration", undefined); // "orchestration"
resolveApi("orchestration", "orchestration", "foundation-models"); // "foundation-models"
```

---

### `validateSettings(options)`

Validates that settings are compatible with the selected API.

**Signature:**

```typescript
function validateSettings(options: ValidateSettingsOptions): void;
```

**Parameters:**

- `options.api`: The resolved API type
- `options.modelSettings`: Model-level settings to validate
- `options.invocationSettings`: Optional invocation-time settings
- `options.modelApi`: The API the model was configured with (for switch detection)

**Throws:**

- `UnsupportedFeatureError` - If API-specific features are used with the wrong API
- `ApiSwitchError` - If switching APIs conflicts with configured features
- `Error` - If API value is invalid

**Example:**

```typescript
import { validateSettings, resolveApi } from "@jerome-benoit/sap-ai-provider";

const api = resolveApi(providerApi, modelApi, invocationApi);

// This will throw UnsupportedFeatureError
validateSettings({
  api: "foundation-models",
  modelSettings: {
    filtering: {/* ... */},
  }, // Orchestration-only feature
});

// This will throw ApiSwitchError
validateSettings({
  api: "foundation-models",
  modelApi: "orchestration",
  modelSettings: {
    masking: {/* ... */},
  },
  invocationSettings: { api: "foundation-models" },
});
```

---

### `buildDpiMaskingProvider(config)`

Creates a DPI (Data Privacy Integration) masking provider configuration for
anonymizing or pseudonymizing sensitive data.

**Signature:**

```typescript
function buildDpiMaskingProvider(config: DpiMaskingConfig): DpiMaskingProviderConfig;
```

**Parameters:**

- `config.method`: Masking method - `"anonymization"` or `"pseudonymization"`
- `config.entities`: Array of entity types to mask (strings or objects with
  replacement strategies)

**Returns:** DPI masking provider configuration object

**Example:**

**Complete example:**
[examples/example-data-masking.ts](./examples/example-data-masking.ts)

```typescript
const dpiMasking = buildDpiMaskingProvider({
  method: "anonymization",
  entities: [
    "profile-email",
    "profile-person",
    {
      type: "profile-phone",
      replacement_strategy: { method: "constant", value: "REDACTED" },
    },
  ],
});

const provider = createSAPAIProvider({
  defaultSettings: {
    masking: {
      masking_providers: [dpiMasking],
    },
  },
});
```

**Run it:** `npx tsx examples/example-data-masking.ts`

---

### `buildAzureContentSafetyFilter(type, config?)`

Creates an Azure Content Safety filter configuration for input or output content
filtering.

**Signature:**

```typescript
function buildAzureContentSafetyFilter<T extends "input" | "output">(type: T, config?: AzureContentSafetyFilterParameters<T>): AzureContentSafetyFilterReturnType<T>;
```

**Parameters:**

- `type`: Filter type - `"input"` (before model) or `"output"` (after model)
- `config`: Optional safety levels for each category (default: `ALLOW_SAFE_LOW`
  for all)
  - `hate`: Hate speech filter level
  - `violence`: Violence content filter level
  - `self_harm`: Self-harm content filter level
  - `sexual`: Sexual content filter level

**Filter Levels:** `ALLOW_SAFE`, `ALLOW_SAFE_LOW`, `ALLOW_SAFE_LOW_MEDIUM`, or
block all

**Returns:** Azure Content Safety filter configuration

**Complete example:**
[examples/example-content-filtering.ts](./examples/example-content-filtering.ts)

> **Note:** Content filtering is an Orchestration API module. It is not available
> with the Foundation Models API.

**Example:**

```typescript
const provider = createSAPAIProvider({
  defaultSettings: {
    filtering: {
      input: {
        filters: [
          buildAzureContentSafetyFilter("input", {
            hate: "ALLOW_SAFE",
            violence: "ALLOW_SAFE_LOW_MEDIUM",
            self_harm: "ALLOW_SAFE",
            sexual: "ALLOW_SAFE",
          }),
        ],
      },
    },
  },
});
```

**Run it:** `npx tsx examples/example-content-filtering.ts`

---

### `buildLlamaGuard38BFilter(type, categories)`

Creates a Llama Guard 3 8B filter configuration for content safety filtering.

**Signature:**

```typescript
function buildLlamaGuard38BFilter<T extends "input" | "output">(type: T, categories: [LlamaGuard38BCategory, ...LlamaGuard38BCategory[]]): LlamaGuard38BFilterReturnType<T>;
```

**Parameters:**

- `type`: Filter type - `"input"` or `"output"`
- `categories`: Array of at least one category to filter (e.g., `"hate"`,
  `"violent_crimes"`, `"elections"`)

**Returns:** Llama Guard 3 8B filter configuration

**Example:**

```typescript
const provider = createSAPAIProvider({
  defaultSettings: {
    filtering: {
      input: {
        filters: [buildLlamaGuard38BFilter("input", ["hate", "violent_crimes"])],
      },
    },
  },
});
```

---

### `buildDocumentGroundingConfig(config)`

Creates a document grounding configuration for retrieval-augmented generation
(RAG).

**Signature:**

```typescript
function buildDocumentGroundingConfig(config: DocumentGroundingServiceConfig): GroundingModule;
```

**Parameters:**

- `config`: Document grounding service configuration

**Returns:** Full grounding module configuration

**Example:**

**Complete example:**
[examples/example-document-grounding.ts](./examples/example-document-grounding.ts)

```typescript
const groundingConfig = buildDocumentGroundingConfig({
  filters: [
    {
      id: "vector-store-1", // Your vector database ID
      data_repositories: ["*"], // Search all repositories
    },
  ],
  placeholders: {
    input: ["groundingRequest"],
    output: "groundingOutput",
  },
  metadata_params: ["file_name", "document_id"], // Optional metadata
});

const provider = createSAPAIProvider({
  defaultSettings: {
    grounding: groundingConfig,
  },
});

const { text } = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Question: {{?groundingRequest}}\nContext: {{?groundingOutput}}",
  providerOptions: {
    "sap-ai": {
      escapeTemplatePlaceholders: false,
      placeholderValues: {
        groundingRequest: "What is SAP?",
      },
    },
  },
});
```

The `prompt` intentionally contains SAP template placeholders such as
`{{?groundingRequest}}` and `{{?groundingOutput}}`, so the example disables
placeholder escaping for that call and provides the input value through
`providerOptions['sap-ai'].placeholderValues`. Keep the default escaping enabled
for normal prompt text.

**Run it:** `npx tsx examples/example-document-grounding.ts`

---

### `buildTranslationConfig(type, config)`

Creates a translation configuration for input/output translation using SAP
Document Translation service.

**Signature:**

```typescript
function buildTranslationConfig<T extends "input" | "output">(type: T, config: TranslationConfigParams<T>): TranslationReturnType<T>;
```

**Parameters:**

- `type`: Translation type - `"input"` (before model) or `"output"` (after
  model)
- `config`: Translation configuration
  - `sourceLanguage`: Source language code (auto-detected if omitted)
  - `targetLanguage`: Required language code for input; output also accepts a
    `DocumentTranslationApplyToSelector`
  - `translateMessagesHistory`: Whether to translate message history (input only, optional)

**Returns:** SAP Document Translation configuration

**Example:**

**Complete example:**
[examples/example-translation.ts](./examples/example-translation.ts)

```typescript
// Translate user input from German to English
const inputTranslation = buildTranslationConfig("input", {
  sourceLanguage: "de",
  targetLanguage: "en",
});

// Translate model output from English to German
const outputTranslation = buildTranslationConfig("output", {
  targetLanguage: "de",
});

const provider = createSAPAIProvider({
  defaultSettings: {
    translation: {
      input: inputTranslation,
      output: outputTranslation,
    },
  },
});

// Now the model handles German input/output automatically
const model = provider("gpt-4.1");
```

**Run it:** `npx tsx examples/example-translation.ts`

---

### `escapeOrchestrationPlaceholders(text)`

Escapes SAP Orchestration template delimiters (`{{`, `{%`, `{#`) in text content
to prevent them from being interpreted as template expressions.

**Signature:**

```typescript
function escapeOrchestrationPlaceholders(text: string): string;
```

**Parameters:**

- `text`: The text content that may contain template delimiters

**Returns:** Text with a zero-width space (`U+200B`) inserted after the opening
brace of each delimiter (`{{` → `{\u200B{`, `{%` → `{\u200B%`, `{#` → `{\u200B#`).

**Example:**

```typescript
import { escapeOrchestrationPlaceholders } from "@jerome-benoit/sap-ai-provider";

const userInput = "Use {{variable}} in your template";
const escaped = escapeOrchestrationPlaceholders(userInput);
// Result: "Use {\u200B{variable}} in your template"
```

**Use Case:**

Use this function when passing user-generated content that may contain
curly braces to prevent template injection:

```typescript
const prompt = escapeOrchestrationPlaceholders(userProvidedContent);
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt,
});
```

---

### `unescapeOrchestrationPlaceholders(text)`

Reverses the escaping performed by `escapeOrchestrationPlaceholders`, restoring
the original template delimiters.

**Signature:**

```typescript
function unescapeOrchestrationPlaceholders(text: string): string;
```

**Parameters:**

- `text`: Text with escaped template delimiters

**Returns:** Text with original delimiters restored

**Example:**

```typescript
import { unescapeOrchestrationPlaceholders } from "@jerome-benoit/sap-ai-provider";

const escaped = "Use {\u200B{variable}} in your template";
const original = unescapeOrchestrationPlaceholders(escaped);
// Result: "Use {{variable}} in your template"
```

---

## Response Formats

### Text Response

**Type:**

```typescript
{
  type: "text";
}
```

Default response format for text-only outputs.

---

### JSON Object Response

**Type:**

```typescript
{
  type: "json_object";
}
```

Instructs the model to return valid JSON.

---

### JSON Schema Response

**Type:**

```typescript
{
  type: 'json_schema';
  json_schema: {
    name: string;
    description?: string;
    schema?: unknown;
    strict?: boolean | null;
  };
}
```

Instructs the model to follow a specific JSON schema.

**Example:**

```typescript
const settings: SAPAISettings = {
  responseFormat: {
    type: "json_schema",
    json_schema: {
      name: "user_profile",
      description: "User profile information",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
      },
      strict: true,
    },
  },
};
```

---

## Environment Variables

| Variable             | Description                                 | Required    |
| -------------------- | ------------------------------------------- | ----------- |
| `AICORE_SERVICE_KEY` | SAP AI Core service key JSON (local)        | Yes (local) |
| `VCAP_SERVICES`      | Service bindings (auto-detected on SAP BTP) | Yes (BTP)   |

---

## Version Information

### `VERSION`

The package exports a `VERSION` constant containing the current version string,
injected at build time.

```typescript
import { VERSION } from "@jerome-benoit/sap-ai-provider";

console.log(`Using SAP AI Provider v${VERSION}`);
// Output: "Using SAP AI Provider vX.Y.Z"
```

For the current package version, see [package.json](./package.json).

### Dependencies

- **Vercel AI SDK peer dependency:** `ai` supports majors 5, 6, and 7 through
  their matching entrypoints. It is not a direct runtime dependency. The
  repository uses AI SDK 7 as a development dependency.
- **SAP AI SDK:** ^2.15.0 (`@sap-ai-sdk/orchestration`, `@sap-ai-sdk/foundation-models`)
- **Node.js:** >= 22.12

> **Note:** For exact dependency versions, always refer to `package.json` in the
> repository root.

---

## Related Documentation

- [README](./README.md) - Getting started, quick start, and feature overview
- [Environment Setup](./ENVIRONMENT_SETUP.md) - Authentication setup and
  environment configuration
- [Migration Guide](./MIGRATION_GUIDE.md) - Migration from v1.x with
  troubleshooting
- [Architecture](./ARCHITECTURE.md) - Internal architecture, component
  design, and request flows
- [cURL API Testing Guide](./CURL_API_TESTING_GUIDE.md) - Low-level API
  testing and debugging
- [Contributing Guide](./CONTRIBUTING.md) - Development setup and contribution
  guidelines
