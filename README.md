# SAP AI Provider for Vercel AI SDK

[![npm](https://img.shields.io/npm/v/@jerome-benoit/sap-ai-provider/latest?label=npm&color=blue)](https://www.npmjs.com/package/@jerome-benoit/sap-ai-provider)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-5.0+-black.svg)](https://sdk.vercel.ai/docs)
[![Language Model](https://img.shields.io/badge/Language%20Model-V3-green.svg)](https://sdk.vercel.ai/docs/ai-sdk-core/provider-management)
[![Embedding Model](https://img.shields.io/badge/Embedding%20Model-V3-green.svg)](https://sdk.vercel.ai/docs/ai-sdk-core/embeddings)

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
  - [Option 2: Default Instance (Quick Start)](#option-2-default-instance-quick-start)
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
- 🎨 **Multiple Models** - Support for GPT-4, Claude, Gemini, Nova, and more
- ⚡ **Language Model V3** - Latest Vercel AI SDK specification with enhanced
  streaming
- 📊 **Text Embeddings** - Generate vector embeddings for RAG and semantic
  search
- 🔀 **Dual API Support** - Choose between Orchestration or Foundation Models
  API per provider, model, or call

## Quick Start

```bash
npm install @jerome-benoit/sap-ai-provider ai
```

```typescript
import "dotenv/config"; // Load environment variables
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
import { generateText } from "ai";
import { APICallError } from "@ai-sdk/provider";

// Create provider (authentication via AICORE_SERVICE_KEY env var)
const provider = createSAPAIProvider();

try {
  // Generate text with gpt-4o
  const result = await generateText({
    model: provider("gpt-4o"),
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

> **Note:** Requires `AICORE_SERVICE_KEY` environment variable. See
> [Environment Setup](./ENVIRONMENT_SETUP.md) for configuration.

## Quick Reference

| Task                | Code Pattern                                                     | Documentation                                                 |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| **Install**         | `npm install @jerome-benoit/sap-ai-provider ai`                  | [Installation](#installation)                                 |
| **Auth Setup**      | Add `AICORE_SERVICE_KEY` to `.env`                               | [Environment Setup](./ENVIRONMENT_SETUP.md)                   |
| **Create Provider** | `createSAPAIProvider()` or use `sapai`                           | [Provider Creation](#provider-creation)                       |
| **Text Generation** | `generateText({ model: provider("gpt-4o"), prompt })`            | [Basic Usage](#text-generation)                               |
| **Streaming**       | `streamText({ model: provider("gpt-4o"), prompt })`              | [Streaming](#streaming-responses)                             |
| **Tool Calling**    | `generateText({ tools: { myTool: tool({...}) } })`               | [Tool Calling](#tool-calling)                                 |
| **Error Handling**  | `catch (error instanceof APICallError)`                          | [API Reference](./API_REFERENCE.md#error-handling--reference) |
| **Choose Model**    | See 80+ models (GPT, Claude, Gemini, Llama)                      | [Models](./API_REFERENCE.md#models)                           |
| **Embeddings**      | `embed({ model: provider.embedding("text-embedding-ada-002") })` | [Embeddings](#embeddings)                                     |

## Installation

**Requirements:** Node.js 18+ and Vercel AI SDK 5.0+ or 6.0+

```bash
npm install @jerome-benoit/sap-ai-provider ai
```

Or with other package managers:

```bash
# Yarn
yarn add @jerome-benoit/sap-ai-provider ai

# pnpm
pnpm add @jerome-benoit/sap-ai-provider ai
```

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
const model = provider("gpt-4o", {
  api: "orchestration", // Override for this model only
});

// Per-call API override via providerOptions
const result = await generateText({
  model: provider("gpt-4o"),
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
  model: sapai("gpt-4o"),
  prompt: "Hello!",
});
```

The `sapai` export provides a convenient default provider instance with
automatic configuration from environment variables or service bindings.

### Provider Methods

The provider is callable and also exposes explicit methods:

```typescript
// Callable syntax (creates language model)
const chatModel = provider("gpt-4o");

// Explicit method syntax
const chatModel = provider.chat("gpt-4o");
const embeddingModel = provider.embedding("text-embedding-ada-002");
```

All methods accept an optional second parameter for model-specific settings.

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
  model: provider("gpt-4o"),
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
  model: provider("anthropic--claude-3.5-sonnet"),
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
import { APICallError, streamText } from "ai";

try {
  const result = streamText({
    model: provider("gpt-4o"),
    prompt: "Explain machine learning concepts.",
  });

  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }

  // Await final result to catch any errors that occurred during streaming
  const finalResult = await result;
  console.log("\n\nUsage:", finalResult.usage);
} catch (error) {
  if (error instanceof APICallError) {
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

const model = provider("gpt-4o", {
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
  model: provider.embedding("text-embedding-ada-002"),
  value: "What is machine learning?",
});

// Multiple embeddings
const { embeddings } = await embedMany({
  model: provider.embedding("text-embedding-3-small"),
  values: ["Hello world", "AI is amazing", "Vector search"],
});
```

**Run it:** `npx tsx examples/example-embeddings.ts`

**Common embedding models:**

- `text-embedding-ada-002` - OpenAI Ada v2 (cost-effective)
- `text-embedding-3-small` - OpenAI v3 small (balanced)
- `text-embedding-3-large` - OpenAI v3 large (highest quality)

> **Note:** Model availability depends on your SAP AI Core tenant configuration.

For complete embedding API documentation, see
**[API Reference: Embeddings](./API_REFERENCE.md#embeddings)**.

## Supported Models

This provider supports all models available through SAP AI Core, including:

**Popular models:**

- **OpenAI**: gpt-4o, gpt-4o-mini, gpt-4.1, o1, o3, o4-mini (recommended for
  multi-tool apps)
- **Anthropic Claude**: anthropic--claude-3.5-sonnet, anthropic--claude-4-opus
- **Google Gemini**: gemini-2.5-pro, gemini-2.0-flash

- **Amazon Nova**: amazon--nova-pro, amazon--nova-lite
- **Open Source**: mistralai--mistral-large-instruct,
  meta--llama3.1-70b-instruct

> **Note:** Model availability depends on your SAP AI Core tenant configuration,
> region, and subscription.

**To discover available models in your environment:**

```bash
curl "https://<AI_API_URL>/v2/lm/deployments" -H "Authorization: Bearer $TOKEN"
```

For complete model details, capabilities comparison, and limitations, see
**[API Reference: SAPAIModelId](./API_REFERENCE.md#sapaimodelid)**.

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
import { generateText, tool } from "ai";
import { z } from "zod";
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider();

const weatherTool = tool({
  description: "Get weather for a location",
  parameters: z.object({ location: z.string() }),
  execute: async (args) => `Weather in ${args.location}: sunny, 72°F`,
});

const result = await generateText({
  model: provider("gpt-4o"),
  prompt: "What's the weather in Tokyo?",
  tools: { getWeather: weatherTool },
  maxSteps: 3,
});
```

**Run it:** `npx tsx examples/example-chat-completion-tool.ts`

⚠️ **Model Limitations:** Some models have tool calling restrictions. See
[API Reference - Model-Specific Tool Limitations](./API_REFERENCE.md#model-specific-tool-limitations)
for the complete comparison table.

### Multi-modal Input (Images)

**Complete example:**
[examples/example-image-recognition.ts](./examples/example-image-recognition.ts)

```typescript
const result = await generateText({
  model: provider("gpt-4o"),
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

```typescript
import "dotenv/config"; // Load environment variables
import { buildAzureContentSafetyFilter, createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider({
  defaultSettings: {
    filtering: {
      input: {
        filters: [
          buildAzureContentSafetyFilter("input", {
            hate: "ALLOW_SAFE",
            violence: "ALLOW_SAFE_LOW_MEDIUM",
          }),
        ],
      },
    },
  },
});
```

**Complete documentation:**
[API Reference - Content Filtering](./API_REFERENCE.md#buildazurecontentsafetyfiltertype-config)

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
      filters: [
        {
          id: "vector-store-1", // Your vector database ID
          data_repositories: ["*"], // Search all repositories
        },
      ],
      placeholders: {
        input: ["?question"],
        output: "groundingOutput",
      },
    }),
  },
});

// Queries are now grounded in your documents
const model = provider("gpt-4o");
```

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
const model = provider("gpt-4o");
```

**Run it:** `npx tsx examples/example-translation.ts`

### Provider Options (Per-Call Overrides)

Override constructor settings on a per-call basis using `providerOptions`.
Options are validated at runtime with Zod schemas.

```typescript
import { generateText } from "ai";
import { createSAPAIProvider, SAP_AI_PROVIDER_NAME } from "@jerome-benoit/sap-ai-provider";

const provider = createSAPAIProvider();

const result = await generateText({
  model: provider("gpt-4o"),
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

- `name`: Provider name (default: `'sap-ai'`). Used as key in
  `providerOptions`/`providerMetadata`.
- `resourceGroup`: SAP AI Core resource group (default: 'default')
- `deploymentId`: Specific deployment ID (auto-resolved if not set)
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
- **Rate limit (429)**: Automatic retry with exponential backoff
- **Streaming**: Iterate `textStream` correctly; don't mix `generateText` and
  `streamText`

**For comprehensive troubleshooting, see
[Troubleshooting Guide](./TROUBLESHOOTING.md)** with detailed solutions for:

- [Authentication Failed (401)](./TROUBLESHOOTING.md#problem-authentication-failed-or-401-errors)
- [Model Not Found (404)](./TROUBLESHOOTING.md#problem-404-modeldeployment-not-found)
- [Rate Limit (429)](./TROUBLESHOOTING.md#problem-429-rate-limit-exceeded)
- [Server Errors (500-504)](./TROUBLESHOOTING.md#problem-500502503504-server-errors)
- [Streaming Issues](./TROUBLESHOOTING.md#streaming-issues)
- [Tool Calling Problems](./TROUBLESHOOTING.md#tool-calling-issues)

Error code reference table:
[API Reference - HTTP Status Codes](./API_REFERENCE.md#http-status-code-reference)

## Performance

- Prefer streaming (`streamText`) for long outputs to reduce latency and memory.
- Tune `modelParams` carefully: lower `temperature` for deterministic results;
  set `maxTokens` to expected response size.
- Use `defaultSettings` at provider creation for shared knobs across models to
  avoid per-call overhead.
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

The `examples/` directory contains complete, runnable examples demonstrating key
features:

| Example                             | Description                 | Key Features                            |
| ----------------------------------- | --------------------------- | --------------------------------------- |
| `example-generate-text.ts`          | Basic text generation       | Simple prompts, synchronous generation  |
| `example-simple-chat-completion.ts` | Simple chat conversation    | System messages, user prompts           |
| `example-chat-completion-tool.ts`   | Tool calling with functions | Weather API tool, function execution    |
| `example-streaming-chat.ts`         | Streaming responses         | Real-time text generation, SSE          |
| `example-image-recognition.ts`      | Multi-modal with images     | Vision models, image analysis           |
| `example-data-masking.ts`           | Data privacy integration    | DPI masking, anonymization              |
| `example-document-grounding.ts`     | Document grounding (RAG)    | Vector store, retrieval-augmented gen   |
| `example-translation.ts`            | Input/output translation    | Multi-language support, SAP translation |
| `example-embeddings.ts`             | Text embeddings             | Vector generation, semantic similarity  |
| `example-foundation-models.ts`      | Foundation Models API       | Direct model access, logprobs, seed     |

**Running Examples:**

```bash
npx tsx examples/example-generate-text.ts
```

> **Note:** Examples require `AICORE_SERVICE_KEY` environment variable. See
> [Environment Setup](./ENVIRONMENT_SETUP.md) for configuration.

## Migration Guides

### Upgrading from v3.x to v4.x

Version 4.0 migrates from **LanguageModelV2** to **LanguageModelV3**
specification (AI SDK 5.0+). **See the
[Migration Guide](./MIGRATION_GUIDE.md#version-3x-to-4x-breaking-changes) for
complete upgrade instructions.**

**Key changes:**

- **Finish Reason**: Changed from string to object
  (`result.finishReason.unified`)
- **Usage Structure**: Nested format with detailed token breakdown
  (`result.usage.inputTokens.total`)
- **Stream Events**: Structured blocks (`text-start`, `text-delta`, `text-end`)
  instead of simple deltas
- **Warning Types**: Updated format with `feature` field for categorization

**Impact by user type:**

- High-level API users (`generateText`/`streamText`): ✅ Minimal impact (likely
  no changes)
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
- Automatic retries for rate limits (429) and server errors (5xx)

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
  v2.x → v3.x → v4.x)
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

Apache License 2.0 - see [LICENSE](./LICENSE.md) for details.
