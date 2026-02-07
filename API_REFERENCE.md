# API Reference

Complete API documentation for the SAP AI Provider.

## Terminology

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
  - [`createSAPAIProvider(options?)`](#createsapaiprovideroptions)
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
    - [`provider(modelId, settings?)`](#providermodelid-settings)
    - [`provider.chat(modelId, settings?)`](#providerchatmodelid-settings)
  - [`SAPAIProviderSettings`](#sapaiprovidersettings)
  - [`SAPAISettings`](#sapaisettings)
  - [`ModelParams`](#modelparams)
  - [`OrchestrationStreamOptions`](#orchestrationstreamoptions)
  - [`SAPAIServiceKey`](#sapaiservicekey)
  - [`MaskingModuleConfig`](#maskingmoduleconfig)
  - [`DpiConfig`](#dpiconfig)
- [Provider Options](#provider-options)
  - [`SAP_AI_PROVIDER_NAME`](#sap-ai-provider-name-constant)
  - [`sapAILanguageModelProviderOptions`](#sapailanguagemodelprovideroptions)
  - [`sapAIEmbeddingProviderOptions`](#sapaiembeddingprovideroptions)
  - [`SAPAILanguageModelProviderOptions` (Type)](#sapailanguagemodelprovideroptions-type)
  - [`SAPAIEmbeddingProviderOptions` (Type)](#sapaiembeddingprovideroptions-type)
- [Types](#types)
  - [`SAPAIModelId`](#sapaimodelid)
  - [`SAPAIApiType`](#sapaiapitype)
  - [`PromptTemplateRef`](#prompttemplateref)
  - [`OrchestrationConfigRef`](#orchestrationconfigref)
  - [`DpiEntities`](#dpientities)
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
- [Utility Functions](#utility-functions)
  - [`getProviderName(providerIdentifier)`](#getprovidernameprovideridentifier)
  - [`buildDpiMaskingProvider(config)`](#builddpimaskingproviderconfig)
  - [`buildAzureContentSafetyFilter(type, config?)`](#buildazurecontentsafetyfiltertype-config)
  - [`buildLlamaGuard38BFilter(type, categories)`](#buildllamaguard38bfiltertype-categories)
  - [`buildDocumentGroundingConfig(config)`](#builddocumentgroundingconfigconfig)
  - [`buildTranslationConfig(type, config)`](#buildtranslationconfigtype-config)
  - [`resolveApi(providerApi, modelApi, invocationApi)`](#resolveapiproviderapi-modelapi-invocationapi)
  - [`validateSettings(options)`](#validatesettingsoptions)
- [Response Formats](#response-formats)
  - [Text Response](#text-response)
  - [JSON Object Response](#json-object-response)
  - [JSON Schema Response](#json-schema-response)
- [Environment Variables](#environment-variables)
- [Version Information](#version-information)
  - [Dependencies](#dependencies)
- [Related Documentation](#related-documentation-1)

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
import { generateText } from "ai";
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { z } from "zod";

const provider = createSAPAIProvider();

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's the weather in Tokyo and 5+3?",
  tools: {
    getWeather: {
      description: "Get weather for a city",
      parameters: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async ({ city }) => {
        // Your implementation
        return { temp: 72, conditions: "sunny" };
      },
    },
    calculator: {
      description: "Perform calculations",
      parameters: z.object({
        expression: z.string().describe("Math expression"),
      }),
      execute: async ({ expression }) => {
        return { result: eval(expression) };
      },
    },
  },
});

console.log(result.text); // "It's sunny and 72°F in Tokyo. 5+3 equals 8."
console.log(result.toolCalls); // Array of tool invocations
console.log(result.toolResults); // Array of tool results
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

Tools are defined using Zod schemas (recommended) or JSON Schema:

```typescript
import { z } from "zod";

// Zod schema (recommended)
const weatherTool = {
  description: "Get current weather for a location",
  parameters: z.object({
    city: z.string().describe("City name"),
    units: z.enum(["celsius", "fahrenheit"]).optional(),
  }),
  execute: async ({ city, units }) => {
    // Implementation
  },
};

// JSON Schema (alternative)
const calculatorTool = {
  type: "function",
  function: {
    name: "calculator",
    description: "Perform mathematical calculations",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Math expression to evaluate",
        },
      },
      required: ["expression"],
    },
  },
  execute: async (params) => {
    // Implementation
  },
};
```

### Parallel Tool Calls

Some models (gpt-4.1, Claude, Amazon Nova) can call multiple tools
simultaneously:

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's the weather in Tokyo, London, and Paris?",
  tools: { getWeather },
  modelParams: {
    parallel_tool_calls: true, // Enable parallel execution
  },
});

// Model can call getWeather 3 times in parallel
```

⚠️ **Important:** Set `parallel_tool_calls: false` when using Gemini models or
when tool execution order matters.

### Multi-Turn Tool Conversations

The AI SDK automatically handles multi-turn conversations when tools are
involved:

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  messages: [
    { role: "user", content: "Book a flight to Paris" },
  ],
  tools: {
    searchFlights: {
      description: "Search for available flights",
      parameters: z.object({
        destination: z.string(),
        date: z.string(),
      }),
      execute: async ({ destination, date }) => {
        return { flights: [...] };
      },
    },
    bookFlight: {
      description: "Book a specific flight",
      parameters: z.object({
        flightId: z.string(),
      }),
      execute: async ({ flightId }) => {
        return { confirmation: "ABC123" };
      },
    },
  },
});

// Conversation flow:
// 1. User: "Book a flight to Paris"
// 2. Model calls: searchFlights({ destination: "Paris", date: "..." })
// 3. Model receives: { flights: [...] }
// 4. Model calls: bookFlight({ flightId: "..." })
// 5. Model receives: { confirmation: "ABC123" }
// 6. Model responds: "Your flight is booked. Confirmation: ABC123"
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
      parameters: z.object({ city: z.string() }),
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
            message: `Failed to get weather: ${error.message}`,
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

console.log(result.toolCalls); // Available after stream completes
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
7. **Testing:** Test with Gemini to ensure your app works with the 1-tool
   limitation

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
async doEmbed(options: {
  values: string[];
  abortSignal?: AbortSignal;
}): Promise<{
  embeddings: number[][];
}>
```

**Parameters:**

- `values`: Array of strings to embed
- `abortSignal`: Optional signal to cancel the request

**Returns:** Object containing `embeddings` array (same order as input values)

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

| Property               | Type                   | Default           | Description                                               |
| ---------------------- | ---------------------- | ----------------- | --------------------------------------------------------- |
| `api`                  | `SAPAIApiType`         | `'orchestration'` | API to use (`'orchestration'`/`'foundation-models'`)      |
| `maxEmbeddingsPerCall` | `number`               | `2048`            | Maximum values per API call                               |
| `modelVersion`         | `string`               | -                 | Specific version of the model                             |
| `type`                 | `EmbeddingType`        | `'text'`          | Embedding type                                            |
| `modelParams`          | `EmbeddingModelParams` | -                 | Model-specific parameters                                 |
| `masking`              | `MaskingModule`        | -                 | Data masking configuration (DPI) - Orchestration API only |

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

- None (function-based interface)

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

Create an embedding model instance.

**Signature:**

```typescript
embedding(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel
```

**Parameters:**

- `modelId`: Embedding model identifier (e.g., 'text-embedding-3-small')
- `settings`: Optional embedding model configuration

**Example:**

```typescript
const embeddingModel = provider.embedding("text-embedding-3-small", {
  maxEmbeddingsPerCall: 100,
  type: "document",
});
```

#### `provider.textEmbeddingModel(modelId, settings?)`

> **Deprecated:** Use `provider.embeddingModel()` instead. This method is
> provided for backward compatibility.

Alias for `embeddingModel()` method.

**Signature:**

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

ProviderV3-compliant method for creating embedding model instances. This is the
standard way to create embedding models in Vercel AI SDK.

**Signature:**

```typescript
embeddingModel(modelId: SAPAIEmbeddingModelId, settings?: SAPAIEmbeddingSettings): SAPAIEmbeddingModel
```

**Parameters:**

- `modelId`: Embedding model identifier (e.g., 'text-embedding-3-small')
- `settings`: Optional embedding model configuration

**Example:**

```typescript
// Using the V3 standard method
const embeddingModel = provider.embeddingModel("text-embedding-3-small", {
  maxEmbeddingsPerCall: 100,
});

// Equivalent to provider.embedding()
const embeddingModel2 = provider.embedding("text-embedding-3-small");
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

| Property                | Type                                     | Default           | Description                                                                                                                                          |
| ----------------------- | ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | `string`                                 | `'sap-ai'`        | Provider name used as key in `providerOptions`/`providerMetadata`. Provider identifier uses `{name}.{type}` format (e.g., `"sap-ai.chat"`)           |
| `api`                   | `'orchestration' \| 'foundation-models'` | `'orchestration'` | SAP AI Core API to use. Orchestration provides full features (masking, filtering, grounding); Foundation Models provides direct model access         |
| `resourceGroup`         | `string`                                 | `'default'`       | SAP AI Core resource group                                                                                                                           |
| `deploymentId`          | `string`                                 | Auto              | SAP AI Core deployment ID                                                                                                                            |
| `destination`           | `HttpDestinationOrFetchOptions`          | -                 | Custom destination configuration                                                                                                                     |
| `defaultSettings`       | `SAPAISettings`                          | -                 | Default model settings applied to all models                                                                                                         |
| `logLevel`              | `'debug' \| 'error' \| 'info' \| 'warn'` | `'warn'`          | Log level for SAP Cloud SDK internal logging (authentication, service binding). Can be overridden via `SAP_CLOUD_SDK_LOG_LEVEL` environment variable |
| `warnOnAmbiguousConfig` | `boolean`                                | `true`            | Emit warnings for ambiguous configurations (e.g., when both `deploymentId` and `resourceGroup` are provided, `deploymentId` wins)                    |

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

---

### API Comparison: Orchestration vs Foundation Models

The SAP AI Provider supports two APIs. Use this feature matrix to choose
the right API for your use case.

#### Feature Matrix

| Feature                         | Orchestration | Foundation Models | Notes                                                 |
| ------------------------------- | :-----------: | :---------------: | ----------------------------------------------------- |
| **Chat Completions**            |      ✅       |        ✅         | Both APIs support chat completions                    |
| **Streaming**                   |      ✅       |        ✅         | Both APIs support streaming responses                 |
| **Tool Calling**                |      ✅       |        ✅         | Both APIs support tool calling                        |
| **Embeddings**                  |      ✅       |        ✅         | Both APIs support embeddings                          |
| **Structured Output (JSON)**    |      ✅       |        ✅         | Both APIs support JSON mode and schemas               |
| **Data Masking (DPI)**          |      ✅       |        ❌         | Anonymize/pseudonymize PII via SAP DPI                |
| **Content Filtering**           |      ✅       |        ❌         | Azure Content Safety, Llama Guard filters             |
| **Document Grounding (RAG)**    |      ✅       |        ❌         | SAP AI Core vector store integration                  |
| **Translation**                 |      ✅       |        ❌         | SAP Document Translation service                      |
| **Template Escaping**           |      ✅       |        ❌         | `escapeTemplatePlaceholders` for SAP template safety  |
| **SAP-format Tool Definitions** |      ✅       |        ❌         | `tools` property in settings                          |
| **Azure On Your Data**          |      ❌       |        ✅         | `dataSources` for Azure AI Search, Cosmos DB          |
| **Log Probabilities**           |      ❌       |        ✅         | `logprobs`, `top_logprobs` parameters                 |
| **Deterministic Sampling**      |      ❌       |        ✅         | `seed` parameter for reproducible outputs             |
| **Stop Sequences**              |      ❌       |        ✅         | `stop` parameter to control generation                |
| **Token Bias**                  |      ❌       |        ✅         | `logit_bias` to adjust token probabilities            |
| **User Tracking**               |      ❌       |        ✅         | `user` parameter for abuse monitoring                 |
| **Tool Choice Control**         |      ✅       |        ✅         | `toolChoice` for `required`, `none`, or specific tool |

#### When to Use Each API

**Use Orchestration API (default) when:**

- ✅ You need data masking/anonymization for PII protection
- ✅ You need content filtering for safety compliance
- ✅ You need document grounding with SAP AI Core vector stores
- ✅ You need input/output translation
- ✅ You want the full SAP AI Core feature set

**Use Foundation Models API when:**

- ✅ You need `logprobs` for token probability analysis
- ✅ You need `seed` for deterministic/reproducible outputs
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

| Property                     | Type                         | Default | Description                                              |
| ---------------------------- | ---------------------------- | ------- | -------------------------------------------------------- |
| `modelVersion`               | `string`                     | -       | Specific model version                                   |
| `includeReasoning`           | `boolean`                    | `false` | Include reasoning parts in SAP prompt conversion         |
| `escapeTemplatePlaceholders` | `boolean`                    | `true`  | Escape template delimiters to prevent conflicts          |
| `modelParams`                | `ModelParams`                | -       | Model generation parameters                              |
| `masking`                    | `MaskingModule`              | -       | Data masking configuration (DPI)                         |
| `filtering`                  | `FilteringModule`            | -       | Content filtering configuration                          |
| `grounding`                  | `GroundingModule`            | -       | Document grounding configuration                         |
| `translation`                | `TranslationModule`          | -       | Translation configuration (Orchestration only)           |
| `placeholderValues`          | `Record<string, string>`     | -       | Default values for template placeholders                 |
| `promptTemplateRef`          | `PromptTemplateRef`          | -       | Reference to a Prompt Registry template                  |
| `responseFormat`             | `ResponseFormatConfig`       | -       | Response format specification                            |
| `streamOptions`              | `OrchestrationStreamOptions` | -       | Stream options for post-LLM modules (Orchestration only) |
| `tools`                      | `ChatCompletionTool[]`       | -       | Tool definitions in SAP AI SDK format                    |

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
        parameters: {
          /* JSON Schema */
        },
      },
    },
  ],
};
```

> **Note:** The `escapeTemplatePlaceholders` option is enabled by default to prevent SAP AI Core orchestration API errors when content contains template syntax (`{{variable}}`, `{% if %}`, `{# comment #}`). Set to `false` only if you intentionally use SAP orchestration templating features. See [Troubleshooting - Problem: Template Placeholder Conflicts](./TROUBLESHOOTING.md#problem-template-placeholder-conflicts) for details.

**API-Specific Settings Types:**

For type-safe API-specific configuration, use the discriminated union types:

- `OrchestrationModelSettings` - Settings with `api?: "orchestration"` and
  Orchestration-only options (`filtering`, `masking`, `grounding`, `translation`,
  `tools`, `streamOptions`, `escapeTemplatePlaceholders`)
- `FoundationModelsModelSettings` - Settings with `api: "foundation-models"` and
  Foundation Models-only options (`dataSources`)

```typescript
import type { OrchestrationModelSettings, FoundationModelsModelSettings } from "@jerome-benoit/sap-ai-provider";

// Type-safe Orchestration settings
const orchSettings: OrchestrationModelSettings = {
  api: "orchestration",
  filtering: {
    /* ... */
  },
  masking: {
    /* ... */
  },
};

// Type-safe Foundation Models settings
const fmSettings: FoundationModelsModelSettings = {
  api: "foundation-models",
  dataSources: [
    {
      type: "azure_search",
      parameters: {
        /* ... */
      },
    },
  ],
  modelParams: { logprobs: true, seed: 42 },
};
```

---

### `ModelParams`

Fine-grained model behavior parameters.

> **Note:** Many parameters are model/provider-specific. Some models may ignore
> or only partially support certain options (e.g., Gemini tool calls
> limitations, Amazon models not supporting `n`). Always consult the model's
> upstream documentation.

**Properties:**

| Property              | Type      | Range   | Default        | Description                                            |
| --------------------- | --------- | ------- | -------------- | ------------------------------------------------------ |
| `maxTokens`           | `number`  | 1-4096+ | `1000`         | Maximum tokens to generate                             |
| `temperature`         | `number`  | 0-2     | Model-specific | Sampling temperature                                   |
| `topP`                | `number`  | 0-1     | `1`            | Nucleus sampling parameter                             |
| `frequencyPenalty`    | `number`  | -2 to 2 | `0`            | Frequency penalty                                      |
| `presencePenalty`     | `number`  | -2 to 2 | `0`            | Presence penalty                                       |
| `n`                   | `number`  | 1-10    | `1`            | Number of completions (not supported by Amazon models) |
| `parallel_tool_calls` | `boolean` | -       | Model-specific | Enable parallel tool execution (OpenAI models)         |

#### Foundation Models-Only Parameters

The following parameters are only available when using the Foundation Models API
(`api: "foundation-models"`). They provide advanced control over model behavior
not exposed through the Orchestration API.

| Property       | Type                     | Default | Description                                                   |
| -------------- | ------------------------ | ------- | ------------------------------------------------------------- |
| `logprobs`     | `boolean`                | `false` | Return log probabilities of output tokens                     |
| `top_logprobs` | `number`                 | -       | Number of most likely tokens (0-20) at each position          |
| `seed`         | `number`                 | -       | Random seed for deterministic sampling (reproducible outputs) |
| `stop`         | `string \| string[]`     | -       | Stop sequences where generation halts                         |
| `logit_bias`   | `Record<string, number>` | -       | Modify likelihood of specific tokens (-100 to 100)            |
| `user`         | `string`                 | -       | Unique end-user identifier for abuse monitoring               |

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
      // Foundation Models-only parameters
      seed: 42, // Reproducible outputs
      logprobs: true, // Get token probabilities
      top_logprobs: 5, // Top 5 tokens at each position
      stop: ["\n\n", "END"], // Stop on double newline or "END"
      user: "user-123", // Track for abuse monitoring
    },
  }),
  prompt: "Write a haiku about programming",
});

// Access log probabilities from response (if model supports it)
console.log("Response:", result.text);
```

> **Note:** Using these parameters with Orchestration API (`api: "orchestration"`)
> will have no effect as they are passed through but ignored by the Orchestration
> service.

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

SAP BTP service key structure.

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

Data masking configuration using SAP Data Privacy Integration (DPI).

**Properties:**

| Property            | Type                      | Description                       |
| ------------------- | ------------------------- | --------------------------------- |
| `masking_providers` | `MaskingProviderConfig[]` | List of masking service providers |

---

### `DpiConfig`

SAP Data Privacy Integration masking configuration.

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
const masking: MaskingModuleConfig = {
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

### `sapAILanguageModelProviderOptions`

Zod schema for validating language model provider options.

**Validated Fields:**

| Field                             | Type                     | Description                                                           |
| --------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `includeReasoning`                | `boolean`                | Whether to include assistant reasoning in responses                   |
| `orchestrationConfigRef`          | `OrchestrationConfigRef` | Reference to a stored orchestration configuration (Orchestration API) |
| `modelParams.temperature`         | `number (0-2)`           | Sampling temperature                                                  |
| `modelParams.maxTokens`           | `positive integer`       | Maximum tokens to generate                                            |
| `modelParams.topP`                | `number (0-1)`           | Nucleus sampling parameter                                            |
| `modelParams.frequencyPenalty`    | `number (-2 to 2)`       | Frequency penalty                                                     |
| `modelParams.presencePenalty`     | `number (-2 to 2)`       | Presence penalty                                                      |
| `modelParams.n`                   | `positive integer`       | Number of completions                                                 |
| `modelParams.parallel_tool_calls` | `boolean`                | Enable parallel tool calls                                            |

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

| Field         | Type                              | Description                 |
| ------------- | --------------------------------- | --------------------------- |
| `type`        | `"text" \| "query" \| "document"` | Embedding task type         |
| `modelParams` | `Record<string, unknown>`         | Additional model parameters |

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
  orchestrationConfigRef?: OrchestrationConfigRef;
  placeholderValues?: Record<string, string>;
  promptTemplateRef?: PromptTemplateRef;
};
```

**Properties:**

| Property                     | Type                     | Description                                                         |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `api`                        | `string`                 | Override API selection (`'orchestration'` or `'foundation-models'`) |
| `escapeTemplatePlaceholders` | `boolean`                | Escape template delimiters to prevent SAP templating conflicts      |
| `includeReasoning`           | `boolean`                | Include assistant reasoning parts in the response                   |
| `modelParams`                | `object`                 | Model generation parameters for this specific call                  |
| `orchestrationConfigRef`     | `OrchestrationConfigRef` | Reference to a stored orchestration configuration                   |
| `placeholderValues`          | `Record<string, string>` | Values for template placeholders (overrides settings values)        |
| `promptTemplateRef`          | `PromptTemplateRef`      | Reference to a template in SAP AI Core's Prompt Registry            |

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
// When using grounding with orchestration templates
const { text } = await generateText({
  model: provider("gpt-4.1", {
    grounding: {
      // grounding configuration
    },
  }),
  prompt: "{​{groundingInput}}", // Template placeholder
  providerOptions: {
    "sap-ai": {
      escapeTemplatePlaceholders: false, // Required for template usage
      placeholderValues: {
        groundingInput: "What is SAP?",
        groundingOutput: "", // Will be populated by grounding
      },
    },
  },
});
```

**Example with settings and providerOptions merge:**

```typescript
// Default placeholders in settings, override per-request in providerOptions
const model = provider("gpt-4.1", {
  escapeTemplatePlaceholders: false,
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
  type?: "text" | "query" | "document";
  modelParams?: Record<string, unknown>;
};
```

---

## Types

### `SAPAIModelId`

Model identifier type for SAP AI Core models.

**Type:**

```typescript
export type SAPAIModelId = ChatModel; // Re-exported from @sap-ai-sdk/orchestration
```

**Description:**

Re-exports the `ChatModel` type from `@sap-ai-sdk/orchestration`, which is
dynamically maintained by SAP AI SDK.

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
and reference them in your application. When `promptTemplateRef` is provided, the
orchestration config uses `template_ref` instead of building an inline `template`
array from the conversation messages.

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

### `OrchestrationConfigRef`

Reference to a complete orchestration configuration stored in SAP AI Core.

**Types:**

```typescript
// Reference by configuration ID
export interface OrchestrationConfigRefById {
  readonly id: string;
}

// Reference by scenario/name/version
export interface OrchestrationConfigRefByScenarioNameVersion {
  readonly scenario: string;
  readonly name: string;
  readonly version: string;
}

// Union type for both reference methods
export type OrchestrationConfigRef = OrchestrationConfigRefById | OrchestrationConfigRefByScenarioNameVersion;
```

**Description:**

The `orchestrationConfigRef` allows you to reference a complete orchestration
configuration stored in SAP AI Core instead of specifying individual modules
(filtering, masking, grounding, etc.) in your code. When `orchestrationConfigRef`
is provided, the configuration is fetched from SAP AI Core and used to create
the `OrchestrationClient`.

**Important Behavior:** When using `orchestrationConfigRef`, local module
settings (filtering, masking, grounding, translation, tools, promptTemplateRef,
responseFormat, modelParams, modelVersion) are **ignored** with a warning. Only
`messages` and `placeholderValues` are passed through to the stored
configuration.

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
  readonly filtering?: FilteringModule;
  readonly grounding?: GroundingModule;
  readonly includeReasoning?: boolean;
  readonly masking?: MaskingModule;
  readonly modelParams?: OrchestrationModelParams;
  readonly modelVersion?: string;
  readonly orchestrationConfigRef?: OrchestrationConfigRef;
  readonly placeholderValues?: Record<string, string>;
  readonly promptTemplateRef?: PromptTemplateRef;
  readonly responseFormat?: ResponseFormat;
  readonly tools?: ChatCompletionTool[];
  readonly translation?: TranslationModule;
}
```

**Orchestration-Only Features:**

- `filtering` - Content safety filtering (Azure Content Safety, LlamaGuard)
- `grounding` - Document-based RAG via SAP HANA Vector Engine
- `masking` - Data anonymization via SAP DPI
- `translation` - Input/output translation
- `escapeTemplatePlaceholders` - Prevent template syntax conflicts
- `promptTemplateRef` - Reference templates from SAP AI Core Prompt Registry
- `orchestrationConfigRef` - Reference complete configurations from SAP AI Core

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
  readonly logit_bias?: Record<string, number>; // Token likelihood modification
  readonly logprobs?: boolean; // Return log probabilities
  readonly seed?: number; // Deterministic sampling
  readonly stop?: string | string[]; // Stop sequences
  readonly top_logprobs?: number; // 0-20, requires logprobs=true
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

Union type for provider `defaultSettings`:

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

Standard entity types recognized by SAP DPI.

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

| Property                      | Type                       | Description                                         |
| ----------------------------- | -------------------------- | --------------------------------------------------- |
| `specificationVersion`        | `'v3'`                     | API specification version (readonly)                |
| `modelId`                     | `SAPAIModelId`             | Current model identifier (readonly)                 |
| `provider`                    | `string`                   | Provider identifier (getter, e.g., `'sap-ai.chat'`) |
| `supportedUrls`               | `Record<string, RegExp[]>` | URL patterns for supported media (getter)           |
| `supportsImageUrls`           | `true`                     | Image URL support flag (readonly)                   |
| `supportsMultipleCompletions` | `true`                     | Multiple completions support (readonly)             |
| `supportsParallelToolCalls`   | `true`                     | Parallel tool calls support (readonly)              |
| `supportsStreaming`           | `true`                     | Streaming support (readonly)                        |
| `supportsStructuredOutputs`   | `true`                     | Structured output support (readonly)                |
| `supportsToolCalls`           | `true`                     | Tool calling support (readonly)                     |

**Methods:**

#### `doGenerate(options)`

Generate a single completion (non-streaming).

**Signature:**

```typescript
async doGenerate(
  options: LanguageModelV3CallOptions
): Promise<{
  content: LanguageModelV3Content[];
  finishReason: LanguageModelV3FinishReason;
  usage: LanguageModelV3Usage;
  rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  warnings: LanguageModelV3CallWarning[];
}>
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
): Promise<{
  stream: ReadableStream<LanguageModelV3StreamPart>;
  rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
}>
```

**Stream Events:**

The stream emits the following event types in order:

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
| `finish`            | Stream completes with usage and finish reason    | Last event on success               |
| `error`             | Error occurred during streaming                  | On error (stream then closes)       |
| `raw`               | Raw SDK chunk (when `includeRawChunks: true`)    | For each chunk, before other events |

**Raw Chunks Option:**

When `includeRawChunks: true` is passed in options, the stream will emit
additional `raw` events containing the unprocessed SDK response chunks. This is
useful for debugging or accessing provider-specific data not exposed through
standard events.

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

> **Note:** See [Known Limitations](./TROUBLESHOOTING.md#known-limitations) for
> information about client-generated response IDs in streaming mode.

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
- `statusCode`: HTTP status code (401, 403, 429, 500, etc.)
- `url`: Request URL
- `requestBodyValues`: Request body (for debugging)
- `responseHeaders`: Response headers
- `responseBody`: Raw response body (contains SAP error details)
- `isRetryable`: Whether the error can be retried (true for 429, 5xx)

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
    filtering: {
      /* ... */
    }, // Not supported!
  });
} catch (error) {
  if (error instanceof UnsupportedFeatureError) {
    console.error(error.message);
    // "Content filtering is not supported with Foundation Models API. Use Orchestration API instead."
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
  filtering: {
    /* ... */
  },
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

SAP AI Core error details are preserved in `APICallError.responseBody` as JSON:

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

    // Parse SAP error details
    try {
      const sapError = JSON.parse(error.responseBody);
      console.error("SAP Error Code:", sapError.error.code);
      console.error("Location:", sapError.error.location);
      console.error("Request ID:", sapError.error.request_id);
    } catch {}
  }
}
```

#### HTTP Status Code Reference

Complete reference for status codes returned by SAP AI Core:

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

The provider automatically handles retryable errors (408, 409, 429, 5xx) with
exponential backoff. For non-retryable errors, your application should handle
them appropriately.

**See also:** [Troubleshooting Guide](./TROUBLESHOOTING.md) for detailed solutions
to each error type.

---

### `OrchestrationErrorResponse`

Type representing SAP AI SDK error response structure (for advanced usage).

**Type:**

```typescript
type OrchestrationErrorResponse = {
  error:
    | {
        message: string;
        code?: number;
        location?: string;
        request_id?: string;
      }
    | Array<{
        message: string;
        code?: number;
        location?: string;
        request_id?: string;
      }>;
};
```

This type is primarily used internally for error conversion but is exported for
advanced use cases.

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

| Type                   | Description                           |
| ---------------------- | ------------------------------------- |
| `ChatMessage`          | Union type for all chat message types |
| `AssistantChatMessage` | Message from the assistant            |
| `DeveloperChatMessage` | System/developer instructions         |
| `SystemChatMessage`    | System message (alias for developer)  |
| `ToolChatMessage`      | Tool/function call result message     |
| `UserChatMessage`      | Message from the user                 |

**Configuration Types:**

| Type                                    | Description                             |
| --------------------------------------- | --------------------------------------- |
| `AzureOpenAiChatExtensionConfiguration` | Azure OpenAI data source configuration  |
| `ChatCompletionRequest`                 | Full chat completion request structure  |
| `ChatCompletionTool`                    | Tool definition for function calling    |
| `FunctionObject`                        | Function schema within a tool           |
| `LlmModelDetails`                       | Model configuration details             |
| `LlmModelParams`                        | Model-specific parameters               |
| `OrchestrationConfigRef`                | Reference to a stored configuration     |
| `OrchestrationModuleConfig`             | Full orchestration module configuration |
| `PromptTemplatingModule`                | Prompt template configuration           |

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

**Example:**

```typescript
import type { ChatMessage, FilteringModule, GroundingModule } from "@jerome-benoit/sap-ai-provider";

// Type-safe module configuration
const filtering: FilteringModule = {
  input: {
    /* ... */
  },
  output: {
    /* ... */
  },
};
```

> **Note:** These types are re-exported for convenience. They originate from
> `@sap-ai-sdk/orchestration` and follow SAP AI SDK conventions.

---

### `DeploymentConfig`

Type for configuring deployment resolution behavior.

**Type:**

```typescript
type DeploymentConfig = {
  deploymentId?: string;
  resourceGroup?: string;
  scenario?: string;
};
```

**Properties:**

| Property        | Type     | Description                                         |
| --------------- | -------- | --------------------------------------------------- |
| `deploymentId`  | `string` | Specific deployment ID (skips auto-resolution)      |
| `resourceGroup` | `string` | SAP AI Core resource group (default: `"default"`)   |
| `scenario`      | `string` | Deployment scenario for filtering (default: varies) |

**Example:**

```typescript
import { createSAPAIProvider, DeploymentConfig } from "@jerome-benoit/sap-ai-provider";

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

**Returns:** The provider name (e.g., `"sap-ai"`)

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
- `modelApi`: API set at model creation (`provider("gpt-4.1", { api })`)
- `invocationApi`: API set at invocation (`providerOptions[SAP_AI_PROVIDER_NAME].api`)

**Returns:** The resolved API type to use (highest precedence wins)

**Precedence (highest to lowest):**

1. Invocation-time override
2. Model-level setting
3. Provider-level setting
4. System default (`"orchestration"`)

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
    filtering: {
      /* ... */
    },
  }, // Orchestration-only feature
});

// This will throw ApiSwitchError
validateSettings({
  api: "foundation-models",
  modelApi: "orchestration",
  modelSettings: {
    masking: {
      /* ... */
    },
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
function buildAzureContentSafetyFilter(type: "input" | "output", config?: AzureContentSafetyFilterParameters): AzureContentSafetyFilterReturnType;
```

**Parameters:**

- `type`: Filter type - `"input"` (before model) or `"output"` (after model)
- `config`: Optional safety levels for each category (default: `ALLOW_SAFE_LOW`
  for all)
  - `hate`: Hate speech filter level
  - `violence`: Violence content filter level
  - `selfHarm`: Self-harm content filter level
  - `sexual`: Sexual content filter level

**Filter Levels:** `ALLOW_SAFE`, `ALLOW_SAFE_LOW`, `ALLOW_SAFE_LOW_MEDIUM`, or
block all

**Returns:** Azure Content Safety filter configuration

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
            selfHarm: "ALLOW_SAFE",
            sexual: "ALLOW_SAFE",
          }),
        ],
      },
    },
  },
});
```

---

### `buildLlamaGuard38BFilter(type, categories)`

Creates a Llama Guard 3 8B filter configuration for content safety filtering.

**Signature:**

```typescript
function buildLlamaGuard38BFilter(type: "input" | "output", categories: [LlamaGuard38BCategory, ...LlamaGuard38BCategory[]]): LlamaGuard38BFilterReturnType;
```

**Parameters:**

- `type`: Filter type - `"input"` or `"output"`
- `categories`: Array of at least one category to filter (e.g., `"hate"`,
  `"violence"`, `"elections"`)

**Returns:** Llama Guard 3 8B filter configuration

**Example:**

```typescript
const provider = createSAPAIProvider({
  defaultSettings: {
    filtering: {
      input: {
        filters: [buildLlamaGuard38BFilter("input", ["hate", "violence"])],
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
    input: ["?question"], // Placeholder for user question
    output: "groundingOutput", // Placeholder for grounding output
  },
  metadata_params: ["file_name", "document_id"], // Optional metadata
});

const provider = createSAPAIProvider({
  defaultSettings: {
    grounding: groundingConfig,
  },
});

// Now queries will be grounded in your documents
const { text } = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What is SAP?",
  providerOptions: {
    "sap-ai": {
      escapeTemplatePlaceholders: false, // Required for grounding templates
      placeholderValues: {
        "?question": "What is SAP?", // Maps to input placeholder
      },
    },
  },
});
```

**Run it:** `npx tsx examples/example-document-grounding.ts`

---

### `buildTranslationConfig(type, config)`

Creates a translation configuration for input/output translation using SAP
Document Translation service.

**Signature:**

```typescript
function buildTranslationConfig(type: "input" | "output", config: TranslationConfigParams): TranslationReturnType;
```

**Parameters:**

- `type`: Translation type - `"input"` (before model) or `"output"` (after
  model)
- `config`: Translation configuration
  - `sourceLanguage`: Source language code (auto-detected if omitted)
  - `targetLanguage`: Target language code (required)
  - `translateMessagesHistory`: Whether to translate message history (optional)

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

**Returns:** Text with escaped delimiters (e.g., `{{` becomes `\{{`)

**Example:**

```typescript
import { escapeOrchestrationPlaceholders } from "@jerome-benoit/sap-ai-provider";

const userInput = "Use {{variable}} in your template";
const escaped = escapeOrchestrationPlaceholders(userInput);
// Result: "Use \\{{variable}} in your template"
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

const escaped = "Use \\{{variable}} in your template";
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

- **Vercel AI SDK:** v5.0+ or v6.0+ (`ai` package)
- **SAP AI SDK:** ^2.6.0 (`@sap-ai-sdk/orchestration`, `@sap-ai-sdk/foundation-models`)
- **Node.js:** >= 18

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
