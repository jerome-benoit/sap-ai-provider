# SAP AI Provider for Vercel AI SDK

[![npm](https://img.shields.io/npm/v/@jerome-benoit/sap-ai-provider/latest?label=npm&color=blue)](https://www.npmjs.com/package/@jerome-benoit/sap-ai-provider)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-5%20%7C%206%20%7C%207-black.svg)](https://sdk.vercel.ai/docs)
[![Language Model](https://img.shields.io/badge/Language%20Model-V2%20%7C%20V3%20%7C%20V4-green.svg)](https://sdk.vercel.ai/docs/ai-sdk-core/provider-management)
[![Embedding Model](https://img.shields.io/badge/Embedding%20Model-V2%20%7C%20V3%20%7C%20V4-green.svg)](https://sdk.vercel.ai/docs/ai-sdk-core/embeddings)

A community provider for SAP AI Core that integrates seamlessly with the Vercel
AI SDK. Built on top of the official **@sap-ai-sdk/orchestration** and
**@sap-ai-sdk/foundation-models** packages, this provider enables you to use
SAP's enterprise-grade AI models through the familiar Vercel AI SDK interface.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Quick Reference](#quick-reference)
- [Installation](#installation)
- [Provider Creation](#provider-creation)
  - [Option 1: Factory Function (Recommended for Custom Configuration)](#option-1-factory-function-recommended-for-custom-configuration)
  - [API Selection](#api-selection)
  - [Option 2: Default Instance (Quick Start)](#option-2-default-instance-quick-start)
  - [Provider Methods](#provider-methods)
- [Authentication](#authentication)
- [Basic Usage](#basic-usage)
  - [Text Generation](#text-generation)
  - [Chat Conversations](#chat-conversations)
  - [Streaming Responses](#streaming-responses)
  - [Model Configuration](#model-configuration)
  - [Embeddings](#embeddings)
- [Supported Models](#supported-models)
- [Advanced Features](#advanced-features)
  - [Tool Calling](#tool-calling)
  - [Multi-modal Input (Images)](#multi-modal-input-images)
  - [Data Masking (SAP DPI)](#data-masking-sap-dpi)
  - [Content Filtering](#content-filtering)
  - [Document Grounding (RAG)](#document-grounding-rag)
  - [Translation](#translation)
  - [Provider Options (Per-Call Overrides)](#provider-options-per-call-overrides)
- [Configuration Options](#configuration-options)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)
- [Performance](#performance)
- [Security](#security)
- [Debug Mode](#debug-mode)
- [Examples](#examples)
- [Migration Guides](#migration-guides)
  - [Upgrading from v4.x to v5.x](#upgrading-from-v4x-to-v5x)
  - [Upgrading from v3.x to v4.x](#upgrading-from-v3x-to-v4x)
  - [Upgrading from v2.x to v3.x](#upgrading-from-v2x-to-v3x)
  - [Upgrading from v1.x to v2.x](#upgrading-from-v1x-to-v2x)
- [Important Note](#important-note)
- [Contributing](#contributing)
- [Resources](#resources)
  - [Documentation](#documentation)
  - [Community](#community)
  - [Related Projects](#related-projects)
- [License](#license)

## Features

- 🔐 **Simplified Authentication** - Uses SAP AI SDK's built-in credential
  handling
- 🎯 **Tool Calling Support** - Full tool/function calling capabilities
- 🧠 **Reasoning-Safe by Default** - Assistant reasoning parts are not forwarded
  unless enabled
- 🖼️ **Multi-modal Input** - Support for text and image inputs
- 📡 **Streaming Support** - Real-time text generation with structured V3 blocks
- 🔒 **Data Masking** - Built-in SAP DPI integration for privacy
- 🛡️ **Content Filtering** - Azure Content Safety and Llama Guard support
- 🔧 **TypeScript Support** - Full type safety and IntelliSense
- 🎨 **Multiple Models** - Support for OpenAI, Claude, Gemini, Nova, and more
- 🔄 **AI SDK 5–7 Compatibility** - Versioned V2, V3, and V4 entrypoints
  preserve the matching Vercel AI SDK provider specification
- 📊 **Text Embeddings** - Generate vector embeddings for RAG and semantic
  search
- 🔀 **Dual API Support** - Choose between Orchestration or Foundation Models
  API per provider, model, or call
- 📦 **Stored Configuration Support** - Reference orchestration configurations
  or prompt templates from SAP AI Core

## Quick Start

```bash
npm install @jerome-benoit/sap-ai-provider ai@^6 dotenv
```

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";
import { APICallError } from "@ai-sdk/provider";

// Create provider (authentication via AICORE_SERVICE_KEY env var)
const provider = createSAPAIProvider();

try {
  // Generate text with gpt-4.1
  const result = await generateText({
    model: provider("gpt-4.1"),
    prompt: "Explain quantum computing in simple terms.",
  });

  console.log(result.text);
} catch (error) {
  if (error instanceof APICallError) {
    console.error("SAP AI Core API error:", error.message);
    console.error("Status:", error.statusCode);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

> **Note:** For local service-key setup, set `AICORE_SERVICE_KEY`. SAP BTP service
> bindings and custom destinations are alternatives. See
> [Environment Setup](./ENVIRONMENT_SETUP.md) for configuration.

## Quick Reference

| Task                | Code Pattern                                                     | Documentation                                                 |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| **Install**         | `npm install @jerome-benoit/sap-ai-provider ai@^6`               | [Installation](#installation)                                 |
| **Auth Setup**      | Add `AICORE_SERVICE_KEY` to `.env`                               | [Environment Setup](./ENVIRONMENT_SETUP.md)                   |
| **Create Provider** | `createSAPAIProvider()` or use `sapai`                           | [Provider Creation](#provider-creation)                       |
| **Text Generation** | `generateText({ model: provider("gpt-4.1"), prompt })`           | [Basic Usage](#text-generation)                               |
| **Streaming**       | `streamText({ model: provider("gpt-4.1"), prompt })`             | [Streaming](#streaming-responses)                             |
| **Tool Calling**    | `generateText({ tools: { myTool: tool({...}) } })`               | [Tool Calling](#tool-calling)                                 |
| **Error Handling**  | `if (APICallError.isInstance(error)) { /* handle error */ }`     | [API Reference](./API_REFERENCE.md#error-handling--reference) |
| **Choose Model**    | Discover models available in your tenant                         | [Models](./API_REFERENCE.md#models)                           |
| **Embeddings**      | `embed({ model: provider.embedding("text-embedding-3-small") })` | [Embeddings](#embeddings)                                     |

## Installation

**Requirements:** Node.js 22.12+. The provider entrypoint must match the installed
AI SDK major.

The published package targets Node.js. Its ESM output uses Node
`module.createRequire`, and the SAP SDK dependency chain relies on Node APIs.
The source-level Edge test suite does not establish deployability to pure Edge
runtimes such as Cloudflare Workers; use a Node.js server runtime for deployment.

| AI SDK | Install                                            | Provider import                                                         |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| 7      | `npm install @jerome-benoit/sap-ai-provider ai@^7` | `@jerome-benoit/sap-ai-provider/v4`                                     |
| 6      | `npm install @jerome-benoit/sap-ai-provider ai@^6` | `@jerome-benoit/sap-ai-provider` or `@jerome-benoit/sap-ai-provider/v3` |
| 5      | `npm install @jerome-benoit/sap-ai-provider ai@^5` | `@jerome-benoit/sap-ai-provider/v2`                                     |

`/v3` is an explicit alias for the AI SDK 6 root entrypoint. Both resolve to
the same runtime modules and TypeScript declarations, including the same `sapai`
instance within each module format; existing root imports remain valid.

The Quick Start and inline snippets on this page use AI SDK 6 with the root V3
entrypoint. The runnable files in `examples/` use the repository's installed
AI SDK 7 with the V4 entrypoint.
For AI SDK 7, install `ai@^7` and import `createSAPAIProvider` or `sapai`
from `@jerome-benoit/sap-ai-provider/v4`:

```bash
npm install @jerome-benoit/sap-ai-provider ai@^7
```

The V4 entrypoint exposes the same provider aliases and version-independent
helpers as the root V3 entrypoint. Its standardized `reasoning` option maps to
SAP's `reasoning_effort` model parameter. `provider-default` preserves an
explicit `modelParams.reasoning_effort`; a stored `orchestrationConfigRef` owns
the model configuration and ignores local reasoning options with a warning.
See the [V4 API reference](./API_REFERENCE.md#v4-facade-api-ai-sdk-7) for the
full normalization and precedence contract.

**V2 facade:** AI SDK 5, AI SDK 6 through its V2 compatibility layer, and other `LanguageModelV2`/`EmbeddingModelV2`
consumers can use the main package's `v2` subpath or the dedicated V2 package:

```bash
npm install @jerome-benoit/sap-ai-provider ai@^5
# Alternatively: npm install @jerome-benoit/sap-ai-provider-v2 ai@^5
```

Both entrypoints expose the same V2 facade:

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v2";
// Dedicated-package alternative:
// import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
```

The V2 type contracts are bundled at build time; neither package installs a second
provider package through the `@ai-sdk/provider-v2` alias. When using V2 with AI SDK 6,
use the latest 6.x patch: the initial 6.0.0 embedding compatibility adapter has an
upstream warning-handling failure that is absent in 6.0.280.

See [Architecture - Versioned Packages](./ARCHITECTURE.md#versioned-package-architecture-v4--v3--v2)
for the V4/V3/V2 packaging model.

## Provider Creation

You can create an SAP AI provider in two ways:

### Option 1: Factory Function (Recommended for Custom Configuration)

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider({
  resourceGroup: "production",
  deploymentId: "your-deployment-id", // Optional
});
```

### API Selection

The provider supports two SAP AI Core APIs:

- **Orchestration API** (default): Full-featured API with data masking, content
  filtering, document grounding, and translation
- **Foundation Models API**: Direct model access with additional parameters like
  `logprobs`, `seed`, `logit_bias`, and `dataSources` (Azure On Your Data)

**Complete example:**
[examples/example-foundation-models.ts](./examples/example-foundation-models.ts)\
**Complete documentation:**
[API Reference - Foundation Models API](./API_REFERENCE.md#api-comparison-orchestration-vs-foundation-models)

```typescript
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

// Provider-level API selection
const provider = createSAPAIProvider({
  api: "foundation-models", // All models use Foundation Models API
});

// Model-level API override
const model = provider("gpt-4.1", {
  api: "orchestration", // Override for this model only
});

// Per-call API override via providerOptions
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Hello",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: {
      api: "foundation-models", // Override for this call only
    },
  },
});
```

**Run it:** `npx tsx examples/example-foundation-models.ts`

> **Note:** The Foundation Models API does not support orchestration features
> (masking, filtering, grounding, translation). Attempting to use these features
> with Foundation Models API will throw an `UnsupportedFeatureError`.

### Option 2: Default Instance (Quick Start)

```typescript
import "dotenv/config"; // Load environment variables
import { sapai } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

// Use directly with auto-detected configuration
const result = await generateText({
  model: sapai("gpt-4.1"),
  prompt: "Hello!",
});
```

The `sapai` export provides a convenient default provider instance with
automatic configuration from environment variables or service bindings.

### Provider Methods

The provider is callable and also exposes explicit methods:

```typescript
// Callable syntax (creates language model)
const chatModel = provider("gpt-4.1");

// Explicit method syntax
const explicitChatModel = provider.chat("gpt-4.1");
const embeddingModel = provider.embedding("text-embedding-3-small");
```

**Available methods:**

| Method                                 | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| `provider(modelId)`                    | Callable syntax, creates language model       |
| `provider.chat(modelId)`               | Creates language model (alias)                |
| `provider.languageModel(modelId)`      | Creates language model (ProviderV3 standard)  |
| `provider.embedding(modelId)`          | Creates embedding model (alias)               |
| `provider.embeddingModel(modelId)`     | Creates embedding model (ProviderV3 standard) |
| `provider.textEmbeddingModel(modelId)` | Creates embedding model (alias)               |

> `embedding()` and `embeddingModel()` are identical. `textEmbeddingModel()` is
> deprecated in the V3 and V4 entrypoints — use `embeddingModel()` instead.
>
> **Note:** The V2 facade package (`@jerome-benoit/sap-ai-provider-v2`) only exposes
> `textEmbeddingModel()` for embeddings per the `ProviderV2` specification. Use the
> V3 root with AI SDK 6 or V4 subpath with AI SDK 7 if you need these aliases.

## Authentication

Authentication is handled automatically by the SAP AI SDK via the
`AICORE_SERVICE_KEY` environment variable (local) or `VCAP_SERVICES` (SAP BTP).

**→ [Environment Setup Guide](./ENVIRONMENT_SETUP.md)** - Complete setup
instructions, SAP BTP deployment, and troubleshooting.

## Basic Usage

### Text Generation

**Complete example:**
[examples/example-generate-text.ts](./examples/example-generate-text.ts)

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Write a short story about a robot learning to paint.",
});
console.log(result.text);
```

**Run it:** `npx tsx examples/example-generate-text.ts`

### Chat Conversations

**Complete example:**
[examples/example-simple-chat-completion.ts](./examples/example-simple-chat-completion.ts)

> **Note:** Assistant `reasoning` parts are dropped by default. Set
> `includeReasoning: true` on the model settings if you explicitly want to
> forward them.

```typescript
const result = await generateText({
  model: provider("anthropic--claude-4.5-sonnet"),
  messages: [
    { role: "system", content: "You are a helpful coding assistant." },
    {
      role: "user",
      content: "How do I implement binary search in TypeScript?",
    },
  ],
});
```

**Run it:** `npx tsx examples/example-simple-chat-completion.ts`

### Streaming Responses

**Complete example:**
[examples/example-streaming-chat.ts](./examples/example-streaming-chat.ts)

```typescript
import { streamText } from "ai";
import { APICallError } from "@ai-sdk/provider";

try {
  let streamError: unknown;
  const result = streamText({
    model: provider("gpt-4.1"),
    prompt: "Explain machine learning concepts.",
    onError({ error }) {
      streamError = error;
    },
  });

  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }

  // textStream does not throw stream errors; preserve the original API error.
  if (streamError !== undefined) throw streamError;

  // streamText returns a result object; its usage property is a promise.
  console.log("\n\nUsage:", await result.usage);
} catch (error) {
  if (APICallError.isInstance(error)) {
    console.error("API Error:", error.message);
    // See Error Handling section for complete error type reference
  }
  throw error;
}
```

**Run it:** `npx tsx examples/example-streaming-chat.ts`

> **Note:** For comprehensive error handling patterns, see the
> [Error Handling](#error-handling) section and
> [API Reference - Error Types](./API_REFERENCE.md#error-types).

### Model Configuration

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";

const provider = createSAPAIProvider();

const model = provider("gpt-4.1", {
  // Optional: include assistant reasoning parts (chain-of-thought).
  // Best practice is to keep this disabled.
  includeReasoning: false,
  modelParams: {
    temperature: 0.3,
    maxTokens: 2000,
    topP: 0.9,
  },
});

const result = await generateText({
  model,
  prompt: "Write a technical blog post about TypeScript.",
});
```

### Embeddings

Generate vector embeddings for RAG (Retrieval-Augmented Generation), semantic
search, and similarity matching.

**Complete example:**
[examples/example-embeddings.ts](./examples/example-embeddings.ts)

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

// Multiple embeddings
const { embeddings } = await embedMany({
  model: provider.embedding("text-embedding-3-small"),
  values: ["Hello world", "AI is amazing", "Vector search"],
});
```

**Run it:** `npx tsx examples/example-embeddings.ts`

> **Note:** Embedding model availability depends on your SAP AI Core tenant
> configuration. Common providers include OpenAI, Amazon Titan, and NVIDIA.

For complete embedding API documentation, see
**[API Reference: Embeddings](./API_REFERENCE.md#embeddings)**.

## Supported Models

This provider supports all models available through SAP AI Core, including models
from **OpenAI**, **Anthropic Claude**, **Google Gemini**, **Amazon Nova**,
**Mistral AI**, **Cohere**, and **SAP** (ABAP, RPT).

> **Note:** Model availability depends on your SAP AI Core tenant configuration,
> region, and subscription. Use `provider("model-name")` with any model ID
> available in your environment.

For details on discovering available models, see
**[API Reference: Supported Models](./API_REFERENCE.md#supported-models)**.

## Advanced Features

The following helper functions are exported by this package for convenient
configuration of SAP AI Core features. These builders provide type-safe
configuration for data masking, content filtering, grounding, and translation
modules.

### Tool Calling

> **Note on Terminology:** This documentation uses "tool calling" (Vercel AI SDK
> convention), equivalent to "function calling" in OpenAI documentation. Both
> terms refer to the same capability of models invoking external functions.

📖 **Complete guide:**
[API Reference - Tool Calling](./API_REFERENCE.md#tool-calling-function-calling)\
**Complete example:**
[examples/example-chat-completion-tool.ts](./examples/example-chat-completion-tool.ts)

```typescript
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider();

const weatherTool = tool({
  description: "Get weather for a location",
  inputSchema: z.object({ location: z.string() }),
  execute: async (args) => `Weather in ${args.location}: sunny, 72°F`,
});

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "What's the weather in Tokyo?",
  tools: { getWeather: weatherTool },
  stopWhen: stepCountIs(3),
});
```

**Run it:** `npx tsx examples/example-chat-completion-tool.ts`

⚠️ **Model Limitations:** Some models have tool calling restrictions. See
[API Reference - Model-Specific Tool Limitations](./API_REFERENCE.md#model-specific-tool-limitations)
for upstream support documentation.

### Multi-modal Input (Images)

**Complete example:**
[examples/example-image-recognition.ts](./examples/example-image-recognition.ts)

```typescript
const result = await generateText({
  model: provider("gpt-4.1"),
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What do you see in this image?" },
        { type: "image", image: new URL("https://example.com/image.jpg") },
      ],
    },
  ],
});
```

**Run it:** `npx tsx examples/example-image-recognition.ts`

### Data Masking (SAP DPI)

Use SAP's Data Privacy Integration to mask sensitive data:

**Complete example:**
[examples/example-data-masking.ts](./examples/example-data-masking.ts)\
**Complete documentation:**
[API Reference - Data Masking](./API_REFERENCE.md#builddpimaskingproviderconfig)

```typescript
import { buildDpiMaskingProvider } from "@jerome-benoit/sap-ai-provider";

const dpiConfig = buildDpiMaskingProvider({
  method: "anonymization",
  entities: ["profile-email", "profile-person", "profile-phone"],
});
```

**Run it:** `npx tsx examples/example-data-masking.ts`

### Content Filtering

Content filtering is available through the Orchestration API.

**Complete example:**
[examples/example-content-filtering.ts](./examples/example-content-filtering.ts)\
**Complete documentation:**
[API Reference - Content Filtering](./API_REFERENCE.md#buildazurecontentsafetyfiltertype-config)

**Run it:** `npx tsx examples/example-content-filtering.ts`

### Document Grounding (RAG)

Ground LLM responses in your own documents using vector databases.

**Complete example:**
[examples/example-document-grounding.ts](./examples/example-document-grounding.ts)\
**Complete documentation:**
[API Reference - Document Grounding](./API_REFERENCE.md#builddocumentgroundingconfigconfig)

```typescript
const provider = createSAPAIProvider({
  defaultSettings: {
    grounding: buildDocumentGroundingConfig({
      filters: [{ id: "knowledge-filter", data_repositories: ["*"] }],
      placeholders: { input: ["groundingRequest"], output: "groundingOutput" },
    }),
  },
});

const result = await generateText({
  model: provider("gpt-4.1"),
  prompt: "Question: {{?groundingRequest}}\nContext: {{?groundingOutput}}",
  providerOptions: {
    "sap-ai": {
      escapeTemplatePlaceholders: false,
      placeholderValues: { groundingRequest: "What is SAP?" },
    },
  },
});
```

Set `escapeTemplatePlaceholders` to `false` only when intentionally sending SAP
or Jinja placeholders in prompts or messages.

**Run it:** `npx tsx examples/example-document-grounding.ts`

### Translation

Automatically translate user queries and model responses.

**Complete example:**
[examples/example-translation.ts](./examples/example-translation.ts)\
**Complete documentation:**
[API Reference - Translation](./API_REFERENCE.md#buildtranslationconfigtype-config)

```typescript
const provider = createSAPAIProvider({
  defaultSettings: {
    translation: {
      // Translate user input from German to English
      input: buildTranslationConfig("input", {
        sourceLanguage: "de",
        targetLanguage: "en",
      }),
      // Translate model output from English to German
      output: buildTranslationConfig("output", {
        targetLanguage: "de",
      }),
    },
  },
});

// Model handles German input/output automatically
const model = provider("gpt-4.1");
```

**Run it:** `npx tsx examples/example-translation.ts`

### Provider Options (Per-Call Overrides)

Override constructor settings on a per-call basis using `providerOptions`.
Only the documented per-call fields are supported: unknown top-level fields
are stripped by the Zod schemas, while additional `modelParams` keys pass
through. Standard AI SDK generation options (for example, `temperature`) take
precedence over the corresponding `providerOptions` model parameters.

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

**Complete documentation:**
[API Reference - Provider Options](./API_REFERENCE.md#provider-options)

## Configuration Options

The provider and models can be configured with various settings for
authentication, model parameters, data masking, content filtering, and more.

**Common Configuration:**

- `name`: Provider identifier prefix (default: `'sap-ai'`). The segment before
  the first dot is used as the key in `providerOptions`/`providerMetadata`.
- `resourceGroup`: SAP AI Core resource group (default: 'default')
- `deploymentId`: Specific deployment ID (auto-resolved if not set)
- `requestConfig`: Custom HTTP request configuration (headers, params, timeout, etc.)
  forwarded to the underlying SAP AI SDK client on every call. Provider-level scope
  only; per-call `headers` can override individual headers. Use `requestConfig.headers`
  for SAP-specific headers such as
  `AI-Object-Store-Secret-Name` (feedback service). See
  [API Reference](./API_REFERENCE.md#sapaiprovidersettings) for portability caveats.
- `modelParams`: Temperature, maxTokens, topP, and other generation parameters
- `masking`: SAP Data Privacy Integration (DPI) configuration
- `filtering`: Content safety filters (Azure Content Safety, Llama Guard)

For complete configuration reference including all available options, types, and
examples, see
**[API Reference - Configuration](./API_REFERENCE.md#sapaiprovidersettings)**.

## Error Handling

The provider uses standard Vercel AI SDK error types (`APICallError`,
`LoadAPIKeyError`, `NoSuchModelError` from `@ai-sdk/provider`) for consistent
error handling across providers.

**Documentation:**

- **[API Reference - Error Handling](./API_REFERENCE.md#error-handling--reference)** -
  Complete examples, error types, and SAP-specific metadata
- **[Troubleshooting Guide](./TROUBLESHOOTING.md)** - Solutions for common
  errors (401, 404, 429, 5xx)

## Troubleshooting

**Quick Reference:**

- **Authentication (401)**: Check `AICORE_SERVICE_KEY` or `VCAP_SERVICES`
- **Model not found (404)**: Confirm tenant/region supports the model ID
- **Rate limit (429)**: High-level AI SDK calls retry eligible errors with
  exponential backoff, bounded by `maxRetries`; direct provider calls do not
  implement retries
- **Streaming**: Iterate `textStream` correctly; don't mix `generateText` and
  `streamText`

**For detailed solutions**, see **[Troubleshooting Guide](./TROUBLESHOOTING.md)**
covering authentication, model discovery, rate limiting, server errors,
streaming, and tool calling.

**Error codes:**
[API Reference - HTTP Status Codes](./API_REFERENCE.md#http-status-code-reference)

## Performance

- Prefer streaming (`streamText`) for long outputs to reduce latency and memory.
- Tune `modelParams` carefully: lower `temperature` for less variable results;
  set `maxTokens` to expected response size.
- Use `defaultSettings` at provider creation to share configuration across models;
  settings are still merged and validated when models and calls are prepared.
- Avoid unnecessary history: keep `messages` concise to reduce prompt size and
  cost.

## Security

Follow security best practices when handling credentials. See
[Environment Setup - Security Best Practices](./ENVIRONMENT_SETUP.md#security-best-practices)
for detailed guidance on credential management, key rotation, and secure
deployment.

## Debug Mode

- Use the curl guide `CURL_API_TESTING_GUIDE.md` to diagnose raw API behavior
  independent of the SDK.
- Log request IDs from `error.responseBody` (parse JSON for `request_id`) to
  correlate with backend traces.
- Temporarily enable verbose logging in your app around provider calls; redact
  secrets.

## Examples

The `examples/` directory contains complete, runnable examples using the
repository's AI SDK 7 dependency and the local `../src/index-v4` entrypoint.
In an AI SDK 7 application, import from `@jerome-benoit/sap-ai-provider/v4`.
See [Installation](#installation) for other AI SDK versions.

| Example                             | Description                 | Key Features                             |
| ----------------------------------- | --------------------------- | ---------------------------------------- |
| `example-generate-text.ts`          | Basic text generation       | Simple prompts, non-streaming generation |
| `example-simple-chat-completion.ts` | Simple chat conversation    | System messages, user prompts            |
| `example-chat-completion-tool.ts`   | Tool calling with functions | Demo weather tool, function execution    |
| `example-streaming-chat.ts`         | Streaming responses         | Real-time text generation, SSE           |
| `example-image-recognition.ts`      | Multi-modal with images     | Vision models, image analysis            |
| `example-data-masking.ts`           | Data privacy integration    | DPI masking, anonymization               |
| `example-content-filtering.ts`      | Content filtering           | Azure Content Safety, orchestration      |
| `example-document-grounding.ts`     | Document grounding (RAG)    | Vector store, retrieval-augmented gen    |
| `example-translation.ts`            | Input/output translation    | Multi-language support, SAP translation  |
| `example-embeddings.ts`             | Text embeddings             | Vector generation, semantic similarity   |
| `example-foundation-models.ts`      | Foundation Models API       | Direct model access, logprobs, seed      |

**Running Examples:**

```bash
npx tsx examples/example-generate-text.ts
```

> **Note:** Configure `AICORE_SERVICE_KEY` locally or bind the application to
> SAP AI Core on SAP BTP. See [Environment Setup](./ENVIRONMENT_SETUP.md).

## Migration Guides

### Upgrading from v4.x to v5.x

Version 5.0 adds **AI SDK 7** support through the **V4** facade and requires
**Node.js 22.12 or newer** for both packages. The root entrypoint remains
**V3 for AI SDK 6**; upgrading the provider does not require switching SDKs.

**Key changes:**

- **Runtime**: Upgrade local, CI and deployment environments from Node.js 20
  to Node.js 22.12 or newer.
- **Entrypoints**: Use `/v4` with SDK 7, the root with SDK 6, or `/v2` with
  SDK 5. The standalone V2 package remains available for SDK 5/6.
- **Multimodal inputs**: V4 tagged JPEG/PDF inputs are normalized correctly;
  unsupported binary objects are rejected instead of silently stringified.

See the [4.x to 5.x migration guide](./MIGRATION_GUIDE.md#version-4x-to-5x-breaking-changes)
for installation commands, compatibility details and the migration checklist.

### Upgrading from v3.x to v4.x

Version 4.0 migrates from **LanguageModelV2** to **LanguageModelV3**
specification (AI SDK 6). Package release 4.x is not the V4 provider
specification used by AI SDK 7. **See the
[Migration Guide](./MIGRATION_GUIDE.md#version-3x-to-4x-breaking-changes) for
complete upgrade instructions.**

**Key changes in direct provider results (`doGenerate`/`doStream`):**

- **Finish Reason**: Changed from string to object
  (`result.finishReason.unified`)
- **Usage Structure**: Nested format with detailed token breakdown
  (`result.usage.inputTokens.total`)
- **Stream Events**: Text blocks retain `text-start`, `text-delta`, and
  `text-end`; finish and warning payloads use the V3 format
- **Warning Types**: Updated format with `feature` field for categorization

**Impact by user type:**

- High-level API users (`generateText`/`streamText`): use AI SDK 6 with the root
  entrypoint. High-level token totals remain flat numbers.
- Direct provider users: ⚠️ Update type imports (`LanguageModelV2` →
  `LanguageModelV3`)
- Custom stream parsers: ⚠️ Update parsing logic for V3 structure

### Upgrading from v2.x to v3.x

Version 3.0 standardizes error handling to use Vercel AI SDK native error types.
**See the
[Migration Guide](./MIGRATION_GUIDE.md#version-2x-to-3x-breaking-changes) for
complete upgrade instructions.**

**Key changes:**

- `SAPAIError` removed → Use `APICallError` from `@ai-sdk/provider`
- Error properties: `error.code` → `error.statusCode`
- Retryable error classification for the AI SDK's rate-limit/server-error retries

### Upgrading from v1.x to v2.x

Version 2.0 uses the official SAP AI SDK. **See the
[Migration Guide](./MIGRATION_GUIDE.md#version-1x-to-2x-breaking-changes) for
complete upgrade instructions.**

**Key changes:**

- Authentication via `AICORE_SERVICE_KEY` environment variable
- Synchronous provider creation: `createSAPAIProvider()` (no await)
- Helper functions from SAP AI SDK

**For detailed migration instructions with code examples, see the
[complete Migration Guide](./MIGRATION_GUIDE.md).**

## Important Note

> **Third-Party Provider**: This SAP AI Provider
> (`@jerome-benoit/sap-ai-provider`) is developed and maintained by
> jerome-benoit, not by SAP SE. While it uses the official SAP AI SDK and
> integrates with SAP AI Core services, it is not an official SAP product.

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md)
for details.

## Resources

### Documentation

- [Migration Guide](./MIGRATION_GUIDE.md) - Version upgrade instructions (v1.x →
  v2.x → v3.x → v4.x → v5.x)
- [API Reference](./API_REFERENCE.md) - Complete API documentation with all
  types and functions
- [Environment Setup](./ENVIRONMENT_SETUP.md) - Authentication and configuration
  setup
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues and solutions
- [Architecture](./ARCHITECTURE.md) - Internal architecture, design decisions,
  and request flows
- [cURL API Testing Guide](./CURL_API_TESTING_GUIDE.md) - Direct API testing for
  debugging

### Community

- 🐛 [Issue Tracker](https://github.com/jerome-benoit/sap-ai-provider/issues) -
  Report bugs, request features, and ask questions

### Related Projects

- [Vercel AI SDK](https://sdk.vercel.ai/) - The AI SDK this provider extends
- [SAP AI SDK](https://sap.github.io/ai-sdk/) - Official SAP Cloud SDK for AI
- [SAP AI Core Documentation](https://help.sap.com/docs/ai-core) - Official SAP
  AI Core docs

## License

Apache License 2.0 - see [LICENSE](./LICENSE) for details.
