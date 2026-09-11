# Migration Guide

---

## Choosing Between V3 and V2 Packages

This library publishes two npm packages. The main package exposes three
entrypoints; choose the provider specification that matches your AI SDK major.
Package release numbers (such as 4.x) are independent of provider specification
versions (V2, V3, V4) and AI SDK versions (5, 6, 7).

- **`@jerome-benoit/sap-ai-provider` (V3 Package)**:
  - **When to Use**: Use the root entrypoint with Vercel AI SDK 6, which
    supports `LanguageModelV3`/`EmbeddingModelV3` interfaces. AI SDK 5 cannot
    consume V3 models; AI SDK 7 integrations must use the V4 subpath below.
  - **Key Features**: Implements Vercel AI SDK `LanguageModelV3` and `EmbeddingModelV3` interfaces.

- **`@jerome-benoit/sap-ai-provider-v2` (V2 Facade Package)**:
  - **When to Use**: Use this package if your project requires
    `LanguageModelV2`/`EmbeddingModelV2` interfaces (e.g., for libraries,
    frameworks, or tools that haven't migrated to V3 interfaces yet).
    It targets Vercel AI SDK 5 and is also supported by AI SDK 6 through its
    V2 compatibility layer. The same facade is available from
    `@jerome-benoit/sap-ai-provider/v2`.
    It acts as a facade, wrapping the V3 implementation to provide a V2-compatible
    API surface.
  - **Key Features**: Implements Vercel AI SDK `LanguageModelV2` and `EmbeddingModelV2` interfaces.

- **`@jerome-benoit/sap-ai-provider/v4` (V4 Facade)**:
  - **When to Use**: Use this main-package subpath with Vercel AI SDK 7.
  - **Key Features**: Exposes `LanguageModelV4` and `EmbeddingModelV4` over
    the shared V3 core. See the [V4 API reference](./API_REFERENCE.md#v4-facade-api-ai-sdk-7)
    for reasoning options and file normalization.

### Migrating from V2 to V3 (`@jerome-benoit/sap-ai-provider-v2` → `@jerome-benoit/sap-ai-provider`)

If you are upgrading to Vercel AI SDK 6 and want to use the native V3
interfaces, install `ai@^6` and follow these steps:

1. **Change Package Import**:

   ```typescript
   // Before (V2)
   import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
   // After (V3)
   import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
   ```

2. **Update Type Imports**:
   If you're directly importing AI SDK types for provider definitions, update
   them from `LanguageModelV2` to `LanguageModelV3` (and
   `EmbeddingModelV2` to `EmbeddingModelV3`):

   ```typescript
   // Before (V2)
   import type { LanguageModelV2 } from "@ai-sdk/provider"; // Provider spec V2 (AI SDK 5)
   const model: LanguageModelV2 = createSAPAIProvider()("gpt-4.1");
   // After (V3)
   import type { LanguageModelV3 } from "@ai-sdk/provider"; // Provider spec V3 (AI SDK 6)
   const model: LanguageModelV3 = createSAPAIProvider()("gpt-4.1");
   ```

3. **Response Format Differences**: Note that V3 introduces changes in how
   `finishReason` and `usage` are structured in responses. Refer to the
   "Version 3.x to 4.x" migration section for details on these changes.

### Migrating from V3 to V2 (`@jerome-benoit/sap-ai-provider` → `@jerome-benoit/sap-ai-provider-v2`)

If you need to downgrade your Vercel AI SDK version or require strict
`LanguageModelV2`/`EmbeddingModelV2` compatibility, follow these steps:

1. **Change Package Import**:

   ```typescript
   // Before (V3)
   import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";
   // After (V2)
   import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
   ```

2. **Provider Method Differences**: The V2 package's provider
   (`@jerome-benoit/sap-ai-provider-v2`) only exposes the `textEmbeddingModel()`
   method, aligning with the `ProviderV2` specification.
   The `embedding()` method is not available.

   ```typescript
   // V2 only has textEmbeddingModel()
   const embeddingModel = createSAPAIProvider().textEmbeddingModel("embedding-model");
   ```

---

## Version 4.x to 5.x (Breaking Changes)

Package version **5.0.0** adds AI SDK 7 support through the V4 facade while
retaining the V3 root entrypoint and V2 compatibility. Package version 5 does
**not** mean provider specification V5 or a requirement to use AI SDK 5.

### Summary of Changes

**Breaking Changes:**

- Both packages require Node.js 22.12 or newer, up from Node.js 20.
- Unsupported binary objects and detached `ArrayBuffer` values are rejected
  explicitly instead of silently stringified.

**Benefits:**

- AI SDK 7 support through the V4 facade, including tagged JPEG/PDF inputs.
- Versioned entrypoints preserve V2 and V3 contracts alongside V4.

### Who Is Affected?

| User Type                          | Impact                                               | Action Required                                |
| ---------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| All users upgrading either package | Higher runtime minimum                               | Upgrade Node.js to 22.12 or newer              |
| Existing AI SDK 6 users on V3      | Root contract unchanged                              | Keep the root import and SDK 6                 |
| Existing V2 users                  | Standalone package retained; `/v2` is an alternative | Keep SDK 5 or a compatible current SDK 6 patch |
| AI SDK 7 users                     | V4 facade required                                   | Use the `/v4` entrypoint                       |
| Users of custom binary wrappers    | Unsupported representations now fail explicitly      | Use supported SDK file input forms             |

### Migration Steps

#### 1. Update the Runtime

Both published packages now require **Node.js 22.12 or newer**, up from Node.js 20. Upgrade local development, CI and deployment runtimes before installing
5.x. Node.js 22.12 is also the minimum supported CommonJS runtime for loading
the ESM-only AI SDK provider dependencies without experimental flags.

#### 2. Update the Package and Select the Entrypoint

| AI SDK | Installation                                          | Import                              |
| ------ | ----------------------------------------------------- | ----------------------------------- |
| 7      | `npm install @jerome-benoit/sap-ai-provider@^5 ai@^7` | `@jerome-benoit/sap-ai-provider/v4` |
| 6      | `npm install @jerome-benoit/sap-ai-provider@^5 ai@^6` | `@jerome-benoit/sap-ai-provider`    |
| 5      | `npm install @jerome-benoit/sap-ai-provider@^5 ai@^5` | `@jerome-benoit/sap-ai-provider/v2` |

**Existing AI SDK 6 users keep the root import and V3 model contracts.**
Upgrading the provider package alone does not require switching to AI SDK 7
or to `/v4`. The root entrypoint does not become V4 in this release.

The standalone V2 package remains available:

```bash
npm install @jerome-benoit/sap-ai-provider-v2@^5 ai@^5
```

Its import remains `@jerome-benoit/sap-ai-provider-v2`. The main package's
`/v2` entrypoint is an alternative, not a required migration. For V2 with
AI SDK 6, use a current 6.x patch: the initial 6.0.0 embedding compatibility
adapter has a warning-handling failure absent in 6.0.280. Do not pair the
standalone V2 package with AI SDK 7.

#### 3. Adopt the V4 Facade for AI SDK 7

When adopting AI SDK 7, use `/v4`. Its facade normalizes tagged file data
before passing prompts to the shared V3 implementation, fixing the JPEG/PDF
serialization reported in [#177](https://github.com/jerome-benoit/sap-ai-provider/issues/177).
Do not pass V4 tagged file objects directly to the internal V3 message converter.
Provider-specific top-level file references remain unsupported and are rejected
explicitly; see the [V4 API reference](./API_REFERENCE.md#v4-facade-api-ai-sdk-7).

The standardized `reasoning` option controls the outgoing model parameters.
It does not add extraction of reasoning tokens from SAP response streams or
resolve the separate reasoning-output feature requests.

#### 4. Check Binary Input Representations

The shared message converter no longer silently stringifies arbitrary file
objects. It rejects unsupported objects and detached `ArrayBuffer` values
with `UnsupportedFunctionalityError`. Buffer-like objects with a custom
`toString("base64")` must return canonical base64; generic
`[object Object]` output is not accepted.

Use the selected AI SDK's documented file input forms. For direct V3 provider
calls, prefer base64 strings, genuine `Uint8Array` values (including Node
`Buffer`) or `URL` objects. Base64 strings are still forwarded as supplied;
the stricter buffer-like-object validation is not a general validation of file
contents or of caller-supplied base64 strings.

### Migration Checklist

- [ ] Upgrade every Node.js runtime to 22.12 or newer.
- [ ] Install provider 5.x alongside the intended AI SDK major.
- [ ] Select the matching entrypoint; preserve the root import for SDK 6.
- [ ] Replace arbitrary file wrappers with supported file input forms.
- [ ] Exercise generation, streaming, tool calls and embeddings used by your app.
- [ ] Verify multimodal inputs against your selected SAP models when applicable.

---

## Version 3.x to 4.x (Breaking Changes)

**Package version 4.0 migrates the root entrypoint from LanguageModelV2 to
LanguageModelV3 (AI SDK 6).** The direct provider result examples below are
not the high-level `generateText`/`streamText` result format.

### Summary of Changes

**Breaking Changes:**

- Implements **LanguageModelV3** interface (replacing V2)
- Finish reason changed from `string` to `{ unified: string, raw?: string }`
- Usage structure now nested with detailed token breakdown
- Warning types updated to V3 format with `feature` field
- Stream finish and warning payloads use V3 shapes; text block lifecycle is preserved

**Benefits:**

- Native compatibility with Vercel AI SDK 6
- Access to new V3 capabilities (agents, advanced streaming)
- Better type safety with structured result types
- Structured finish and usage data in streamed responses
- Enhanced token usage metadata
- **New:** Text embeddings support (`EmbeddingModelV3`) for RAG and semantic search

### Who Is Affected?

| User Type                                               | Impact         | Action Required                              |
| ------------------------------------------------------- | -------------- | -------------------------------------------- |
| **High-level API users** (`generateText`, `streamText`) | ✅ Minimal     | Verify code still works (likely no changes)  |
| **Direct provider users** (type annotations)            | ⚠️ Minor       | Update import types from V2 to V3            |
| **Custom stream parsers**                               | ⚠️ Significant | Update stream parsing logic for V3 structure |

### Migration Steps

#### 1. Update Package

```bash
npm install @jerome-benoit/sap-ai-provider@^4.0.0 ai@^6
```

#### 2. Update Type Imports (If Using Direct Provider Access)

**Before (v3.x):**

```typescript
import type { LanguageModelV2 } from "@ai-sdk/provider";

const model: LanguageModelV2 = provider("gpt-4.1");
```

**After (v4.x):**

```typescript
import type { LanguageModelV3 } from "@ai-sdk/provider";

const model: LanguageModelV3 = provider("gpt-4.1");
```

#### 3. Update Stream Parsing (If Manually Parsing Streams)

**Before (v3.x - V2 Streams):**

```typescript
for await (const chunk of stream) {
  if (chunk.type === "text-delta") {
    process.stdout.write(chunk.delta); // V2 also uses delta
  }
}
```

**After (v4.x - V3 Streams):**

```typescript
for await (const chunk of stream) {
  if (chunk.type === "text-delta") {
    process.stdout.write(chunk.delta); // Text deltas retain the same property
  }

  // V3 preserves the structured text block lifecycle
  if (chunk.type === "text-start") {
    console.log("Text block started:", chunk.id);
  }

  if (chunk.type === "text-end") {
    console.log("Text block ended:", chunk.id);
  }
}
```

#### 4. Update Finish Reason Access (If Accessing Directly)

**Before (v3.x):**

```typescript
const result = await model.doGenerate(options);
if (result.finishReason === "stop") {
  console.log("Completed normally");
}
```

**After (v4.x):**

```typescript
const result = await model.doGenerate(options);
if (result.finishReason.unified === "stop") {
  console.log("Completed normally");
  console.log("Raw reason:", result.finishReason.raw); // Optional SAP-specific value
}
```

#### 5. Update Usage Access (If Accessing Token Details)

**Before (v3.x):**

```typescript
const result = await model.doGenerate(options);
console.log("Input tokens:", result.usage.inputTokens);
console.log("Output tokens:", result.usage.outputTokens);
```

**After (v4.x):**

```typescript
const result = await model.doGenerate(options);
// Direct V3 results have nested usage; generateText totals remain numbers.
console.log("Input tokens:", result.usage.inputTokens?.total);
console.log("Output tokens:", result.usage.outputTokens?.total);
```

#### 6. Update Warning Handling (If Checking Warnings)

**Before (v3.x):**

```typescript
if (result.warnings) {
  result.warnings.forEach((warning) => {
    if (warning.type === "unsupported-setting") {
      console.warn("Unsupported setting:", warning.setting);
    }
  });
}
```

**After (v4.x):**

```typescript
if (result.warnings) {
  result.warnings.forEach((warning) => {
    if (warning.type === "unsupported") {
      console.warn("Unsupported feature:", warning.feature); // New field name
      console.warn("Details:", warning.details);
    }
  });
}
```

### V3 Features Not Supported

Current support for these capabilities depends on the provider and selected
SAP model (this table describes the current implementation, not only 4.0):

| Feature                      | Status           | Behavior                                                                          |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| **File content generation**  | ❌ Not supported | The provider does not generate file content                                       |
| **Reasoning effort**         | Model-dependent  | Pass `modelParams.reasoning_effort`; V4 also maps the standard `reasoning` option |
| **Source attribution**       | Model-dependent  | Orchestration citations are exposed when returned by SAP                          |
| **Tool approval requests**   | ❌ Not supported | Not applicable                                                                    |
| **Detailed token breakdown** | ⚠️ Partial       | Nested structure present but details may be undefined                             |

### New in v4.x: Foundation Models API Support

Version 4.x adds support for the **Foundation Models API** as an alternative to
the Orchestration API, providing access to additional model parameters.

#### Choosing an API

| Feature                          | Orchestration API (default) | Foundation Models API |
| -------------------------------- | --------------------------- | --------------------- |
| Data masking                     | ✅                          | ❌                    |
| Content filtering                | ✅                          | ❌                    |
| Document grounding               | ✅                          | ❌                    |
| Translation                      | ✅                          | ❌                    |
| `logprobs`, `seed`, `logit_bias` | Model-dependent             | ✅                    |
| Azure OpenAI `dataSources`       | ❌                          | ✅                    |

`seed` and stop sequences are mapped by both strategies. Other model
parameters are passed through and depend on the selected SAP model.

#### Using Foundation Models API

```typescript
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider";

// Option 1: Provider-level (affects all models)
const provider = createSAPAIProvider({ api: "foundation-models" });

// Option 2: Model-level (overrides provider)
const model = provider("gpt-4.1", { api: "foundation-models" });

// Option 3: Call-level (highest precedence)
const result = await generateText({
  model,
  prompt: "Hello",
  providerOptions: {
    [SAP_AI_PROVIDER_NAME]: { api: "foundation-models" },
  },
});
```

#### Foundation Models-Specific Settings

```typescript
const provider = createSAPAIProvider({
  api: "foundation-models",
  defaultSettings: {
    modelParams: {
      logprobs: true,
      topLogprobs: 5,
      seed: 42,
      logitBias: { "50256": -100 },
      user: "user-123",
    },
  },
});
```

> **Note**: If you're using Orchestration-only features (masking, filtering,
> grounding, translation), continue using the default Orchestration API.

### Testing Your Migration

1. **Run your tests:**

   ```bash
   npm test
   ```

2. **Check for TypeScript errors:**

   ```bash
   npx tsc --noEmit
   ```

3. **Test streaming if used:**

   ```typescript
   import { streamText } from "ai";

   const { textStream } = await streamText({
     model: provider("gpt-4.1"),
     prompt: "Count to 5",
   });

   for await (const text of textStream) {
     process.stdout.write(text);
   }
   ```

### Rollback Strategy

If you encounter issues, you can stay on v3.x:

```bash
npm install @jerome-benoit/sap-ai-provider@3.x.x
```

Version 3.x will receive security updates for 6 months after v4.0.0 release.

### Common Migration Issues

#### Issue: "Property 'textDelta' does not exist"

**Cause**: Mixing the old V1 `textDelta` field with V2/V3 direct stream parts.

**Fix**: Change `textDelta` to `delta`:

```typescript
// ❌ Before
chunk.textDelta;

// ✅ After
chunk.delta;
```

#### Issue: "Cannot read property 'total' of undefined"

**Cause**: Trying to access nested usage structure that doesn't exist in your
version.

**Fix**: Use the result shape of the API you called; do not mix formats:

```typescript
// Direct V3 provider result:
const directResult = await model.doGenerate(options);
const directInputTokens = directResult.usage.inputTokens.total;

// High-level AI SDK result:
const sdkResult = await generateText({ model, prompt });
const inputTokens = sdkResult.usage.inputTokens;
```

#### Issue: TypeScript errors on LanguageModelV2 types

**Cause**: Importing old V2 types.

**Fix**: Update imports to V3:

```typescript
// ❌ Before
import type { LanguageModelV2 } from "@ai-sdk/provider";

// ✅ After
import type { LanguageModelV3 } from "@ai-sdk/provider";
```

### FAQ

**Q: Do I need to change my code if I only use `generateText()` and
`streamText()`?**

A: High-level APIs abstract most V2/V3 differences, but the root V3 entrypoint
requires AI SDK 6. AI SDK 5 users must select the V2 facade; AI SDK 7 users
must select `/v4`. See [Installation](./README.md#installation).

**Q: Why did the finish reason become an object?**

A: V3 separates the standardized finish reason (`unified`) from
provider-specific values (`raw`), improving consistency across providers.

**Q: Will SAP AI Core support file generation or reasoning mode in the future?**

A: The provider does not generate files. Reasoning effort is already forwarded
to compatible models (see the capability table above). Model support must be
checked against your deployment; this guide does not predict SAP's roadmap.

**Q: Can I use v3.x and v4.x in the same project?**

A: No, you can only use one version at a time. Choose based on your needs and
migrate when ready.

**Q: How long will v3.x be supported?**

A: Version 3.x will receive security and critical bug fixes for 6 months after
v4.0.0 release.

---

## Version 2.x to 3.x (Breaking Changes)

**Version 3.0 standardizes error handling to use Vercel AI SDK native error
types.**

### Summary of Changes

**Breaking Changes:**

- `SAPAIError` class removed from exports
- All errors now use `APICallError` from `@ai-sdk/provider`
- Error handling is now fully compatible with AI SDK ecosystem

**Benefits:**

- Automatic retry with exponential backoff for rate limits and server errors
- Consistent error handling across all AI SDK providers
- Better integration with AI SDK tooling and frameworks
- Improved error messages with SAP-specific metadata preserved

### Migration Steps

#### 1. Update Package

```bash
npm install @jerome-benoit/sap-ai-provider@3.x.x
```

#### 2. Update Error Handling

**Before (v2.x):**

```typescript
import { SAPAIError } from "@jerome-benoit/sap-ai-provider";

try {
  const result = await generateText({ model, prompt });
} catch (error) {
  if (error instanceof SAPAIError) {
    console.error("SAP AI Error:", error.code, error.message);
    console.error("Request ID:", error.requestId);
  }
}
```

**After (v3.x):**

```typescript
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";

try {
  const result = await generateText({ model, prompt });
} catch (error) {
  if (error instanceof LoadAPIKeyError) {
    // 401/403: Authentication issue
    console.error("Auth Error:", error.message);
  } else if (error instanceof NoSuchModelError) {
    // 404: Model not found
    console.error("Model not found:", error.modelId);
  } else if (error instanceof APICallError) {
    // Other API errors
    console.error("API Error:", error.statusCode, error.message);
    const sapError = JSON.parse(error.responseBody || "{}");
    console.error("Request ID:", sapError.error?.request_id);
  }
}
```

#### 3. SAP Error Metadata Access

SAP AI Core error metadata (request ID, code, location) is preserved in the
`responseBody` field:

```typescript
catch (error) {
  if (error instanceof APICallError) {
    const sapError = JSON.parse(error.responseBody || '{}');
    console.error({
      statusCode: error.statusCode,
      message: sapError.error?.message,
      code: sapError.error?.code,
      location: sapError.error?.location,
      requestId: sapError.error?.request_id
    });
  }
}
```

#### 4. Automatic Retries

Package version 3.x leverages the AI SDK's built-in retry mechanism for transient errors (429,
500, 503). No code changes needed - retries happen automatically with
exponential backoff.

---

## Version 1.x to 2.x (Breaking Changes)

**Version 2.0 is a complete rewrite using the official SAP AI SDK
(@sap-ai-sdk/orchestration).**

### Summary of Changes

**Breaking Changes:**

- Provider creation is now **synchronous** (no more `await`)
- Authentication via `AICORE_SERVICE_KEY` environment variable (no more
  `serviceKey` option)
- Uses official SAP AI SDK for authentication and API communication
- Targeted Vercel AI SDK 5 and its V2 provider specification at release time

**New Features:**

- Complete SAP AI SDK v2 orchestration integration
- Data masking with SAP Data Privacy Integration (DPI)
- Content filtering (Azure Content Safety, Llama Guard)
- Grounding and translation modules support
- Helper functions for configuration (`buildDpiMaskingProvider`,
  `buildAzureContentSafetyFilter`, etc.)
- `responseFormat` configuration for structured outputs
- Enhanced streaming support
- Better error messages with detailed context

**Improvements:**

- Automatic authentication handling by SAP AI SDK
- Better type definitions with comprehensive JSDoc
- Improved error handling
- More reliable streaming

### Migration Steps

#### 1. Update Package

```bash
npm install @jerome-benoit/sap-ai-provider@^2 ai@^5
```

#### 2. Update Authentication

**Key Changes:**

- Environment variable: `SAP_AI_SERVICE_KEY` → `AICORE_SERVICE_KEY`
- Provider creation: Now synchronous (remove `await`)
- Token management: Automatic (SAP AI SDK handles OAuth2)

**Complete setup instructions:**

[Environment Setup Guide](./ENVIRONMENT_SETUP.md)

#### 3. Update Code (Remove await)

```typescript
// v1.x: Async
const provider = await createSAPAIProvider({
  serviceKey: process.env.SAP_AI_SERVICE_KEY,
});

// v2.x: Synchronous
const provider = createSAPAIProvider();

// Rest of your code remains the same
const model = provider("gpt-4.1");
const result = await generateText({ model, prompt: "Hello!" });
```

#### 4. Verify Functionality

After updating authentication and removing `await` from provider creation, run
your tests and basic examples (`examples/`) to verify generation and streaming
work as expected.

#### 5. Optional: Adopt New Features

V2.0 introduces powerful features. See [API Reference](./API_REFERENCE.md)
for complete documentation and [examples/](./examples/) for working code.

**Key new capabilities:**

- **Data Masking (DPI)**: Anonymize sensitive data (emails, names, phone
  numbers) - see [example-data-masking.ts](./examples/example-data-masking.ts)
- **Content Filtering**: Azure Content Safety, Llama Guard - see
  [API Reference - Content Filtering](./API_REFERENCE.md#buildazurecontentsafetyfiltertype-config)
- **Response Format**: Structured outputs with JSON schema - see
  [API Reference - Response Formats](./API_REFERENCE.md#response-formats)
- **Default Settings**: Apply consistent settings across all models - see
  [API Reference - Default Settings](./API_REFERENCE.md#default-settings-configuration-types)
- **Grounding & Translation**: Document grounding, language translation modules

For detailed examples, see the [New Features](#new-features) section below.

---

## Breaking Changes

### Version 3.0.x

| Change                 | Details                                                                                | Migration                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **SAPAIError Removed** | `SAPAIError` class no longer exported                                                  | Use `APICallError` from `@ai-sdk/provider` instead. SAP metadata preserved in `responseBody`. |
| **Error Types**        | All errors now use AI SDK standard types                                               | Import `APICallError` from `@ai-sdk/provider`, not from this package.                         |
| **Error Properties**   | `error.code` → `error.statusCode`, `error.requestId` → parse from `error.responseBody` | Access SAP metadata via `JSON.parse(error.responseBody)`.                                     |

### Version 2.0.x

| Change                   | Details                                                            | Migration                                                                                                |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Authentication**       | `serviceKey` option removed; now uses `AICORE_SERVICE_KEY` env var | Set environment variable, remove `serviceKey` from code. See [Environment Setup](./ENVIRONMENT_SETUP.md) |
| **Synchronous Provider** | `createSAPAIProvider()` no longer async                            | Remove `await` from provider creation                                                                    |
| **Removed Options**      | `token`, `completionPath`, `baseURL`, `headers`, `fetch`           | Use SAP AI SDK automatic handling                                                                        |
| **Token Management**     | Manual OAuth2 removed                                              | Automatic via SAP AI SDK                                                                                 |

---

## Deprecations

### Manual OAuth2 Token Management (Removed in v2.0)

**Status:** Removed in v2.0\
**Replacement:** Automatic authentication via SAP AI SDK with
`AICORE_SERVICE_KEY` environment variable\
**Migration:** See [Environment Setup](./ENVIRONMENT_SETUP.md) for setup
instructions

---

## New Features

### 2.0.x Features

V2.0 introduces several powerful features built on top of the official SAP AI
SDK. For detailed API documentation and complete examples, see
[API Reference](./API_REFERENCE.md).

#### 1. SAP AI SDK Integration

Full integration with `@sap-ai-sdk/orchestration` for authentication and API
communication. Authentication is now automatic via `AICORE_SERVICE_KEY`
environment variable or `VCAP_SERVICES` service binding.

```typescript
const provider = createSAPAIProvider({
  resourceGroup: "production",
  deploymentId: "d65d81e7c077e583", // Optional - auto-resolved if omitted
});
```

**Complete documentation:**
[API Reference - SAPAIProviderSettings](./API_REFERENCE.md#sapaiprovidersettings)

#### 2. Data Masking (DPI)

Automatically anonymize or pseudonymize sensitive information (emails, phone
numbers, names) using SAP's Data Privacy Integration:

```typescript
import { buildDpiMaskingProvider } from "@jerome-benoit/sap-ai-provider";

const dpiConfig = buildDpiMaskingProvider({
  method: "anonymization",
  entities: ["profile-email", "profile-person", "profile-phone"],
});
```

**Complete documentation:**
[API Reference - Data Masking](./API_REFERENCE.md#builddpimaskingproviderconfig),
[example-data-masking.ts](./examples/example-data-masking.ts)

#### 3. Content Filtering

Filter harmful content using Azure Content Safety or Llama Guard for
input/output safety:

```typescript
import { buildAzureContentSafetyFilter } from "@jerome-benoit/sap-ai-provider";

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

#### 4. Response Format Control

Specify structured output formats including JSON schema for deterministic
responses:

```typescript
// JSON object response
const model1 = provider("gpt-4.1", {
  responseFormat: { type: "json_object" },
});

// JSON schema response
const model2 = provider("gpt-4.1", {
  responseFormat: {
    type: "json_schema",
    json_schema: {
      name: "user_profile",
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
});
```

**Complete documentation:**
[API Reference - Response Formats](./API_REFERENCE.md#response-formats)

#### 5. Default Settings

Apply consistent settings across all models created by a provider instance:

```typescript
const provider = createSAPAIProvider({
  defaultSettings: {
    modelParams: { temperature: 0.7, maxTokens: 2000 },
    masking: {/* DPI config */},
  },
});

// All models inherit default settings
const model1 = provider("gpt-4.1"); // temperature=0.7
const model2 = provider("gpt-4.1", {
  modelParams: { temperature: 0.3 }, // Override per model
});
```

**Complete documentation:**
[API Reference - Default Settings](./API_REFERENCE.md#default-settings-configuration-types)

#### 6. Enhanced Streaming & Error Handling

Improved streaming support with better error recovery and detailed error
messages including request IDs and error locations for debugging.

**Complete documentation:** [README - Streaming](./README.md#streaming-responses),
[API Reference - Error Handling](./API_REFERENCE.md#error-handling--reference)

---

## API Changes

### Added APIs (v2.0+)

| API                                     | Purpose                 | Example                                                                           |
| --------------------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `buildDpiMaskingProvider()`             | Data masking helper     | `buildDpiMaskingProvider({ method: "anonymization", entities: [...] })`           |
| `buildAzureContentSafetyFilter()`       | Azure content filtering | `buildAzureContentSafetyFilter("input", { hate: "ALLOW_SAFE" })`                  |
| `buildLlamaGuard38BFilter()`            | Llama Guard filtering   | `buildLlamaGuard38BFilter("input")`                                               |
| `buildDocumentGroundingConfig()`        | Document grounding      | `buildDocumentGroundingConfig({ filters: [...], placeholders: {...} })`           |
| `buildTranslationConfig()`              | Translation module      | `buildTranslationConfig("input", { sourceLanguage: "de", targetLanguage: "en" })` |
| `SAPAISettings.responseFormat`          | Structured outputs      | `{ type: "json_schema", json_schema: {...} }`                                     |
| `SAPAISettings.masking`                 | Masking configuration   | `{ providers: [...] }`                                                            |
| `SAPAISettings.filtering`               | Content filtering       | `{ input: { filters: [...] } }`                                                   |
| `SAPAIProviderSettings.defaultSettings` | Provider defaults       | `{ defaultSettings: { modelParams: {...} } }`                                     |

**See [API Reference](./API_REFERENCE.md) for complete documentation.**

### Modified APIs

**`createSAPAIProvider`** - Now synchronous:

```typescript
// v1.x: Async with serviceKey
await createSAPAIProvider({
  serviceKey,
  token,
  deploymentId,
  baseURL,
  headers,
  fetch,
});

// v2.x: Synchronous with SAP AI SDK
createSAPAIProvider({
  resourceGroup,
  deploymentId,
  destination,
  defaultSettings,
});
```

### Removed APIs

- `serviceKey` option → Use `AICORE_SERVICE_KEY` env var
- `token` option → Automatic authentication
- `baseURL`, `completionPath`, `headers`, `fetch` → Handled by SAP AI SDK

---

## Migration Checklist

### Upgrading from 2.x to 3.x

- [ ] Update package: `npm install @jerome-benoit/sap-ai-provider@3.x.x`
- [ ] Replace `SAPAIError` imports with `APICallError` from `@ai-sdk/provider`
- [ ] Update error handling code to use `error.statusCode` instead of
      `error.code`
- [ ] Update error metadata access to parse `error.responseBody` JSON for SAP
      details
- [ ] Remove any custom retry logic (now automatic with AI SDK)
- [ ] Run tests to verify error handling works correctly
- [ ] Test automatic retry behavior with rate limits (429) and server errors
      (500, 503)

### Upgrading from 1.x to 2.x

- [ ] Update packages: `npm install @jerome-benoit/sap-ai-provider@^2 ai@^5`
- [ ] Set `AICORE_SERVICE_KEY` environment variable (remove `serviceKey` from
      code)
- [ ] Remove `await` from `createSAPAIProvider()` calls (now synchronous)
- [ ] Remove `serviceKey`, `token`, `baseURL`, `completionPath` options from
      provider settings
- [ ] Update masking configuration to use `buildDpiMaskingProvider()` helper
- [ ] Update filtering configuration to use helper functions if applicable
- [ ] Run tests to verify existing functionality
- [ ] Review new features (content filtering, grounding, translation)
- [ ] Consider adopting default settings for cleaner code
- [ ] Update documentation to reflect v2 API
- [ ] Update TypeScript imports if using advanced types

### Testing Checklist

After migration:

- [ ] Provider initialization works
- [ ] Text generation works
- [ ] Streaming works
- [ ] Tool calling works (if used)
- [ ] Multi-modal inputs work (if used)
- [ ] Structured outputs work (if used)
- [ ] Error handling works correctly
- [ ] Performance is acceptable
- [ ] All tests pass

---

## Common Migration Issues

| Issue                       | Cause                     | Solution                                                                                                  |
| --------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Authentication failures** | Missing/incorrect env var | Verify `AICORE_SERVICE_KEY` is set. See [Environment Setup](./ENVIRONMENT_SETUP.md)                       |
| **Masking errors**          | Incorrect configuration   | Use `buildDpiMaskingProvider()` helper. See [example-data-masking.ts](./examples/example-data-masking.ts) |

For detailed troubleshooting, see [Troubleshooting Guide](./TROUBLESHOOTING.md).

---

## Rollback Instructions

If you need to rollback to a previous version:

### Rollback to 2.x

```bash
npm install @jerome-benoit/sap-ai-provider@2.x.x
```

> **Note:** Version 2.x exports `SAPAIError` class for error handling.

### Rollback to 1.x

```bash
npm install @jerome-benoit/sap-ai-provider@1.0.3 ai@^5.0.0
```

> **Note:** Version 1.x uses a different authentication approach and async
> provider creation.

### Verify Installation

```bash
npm list @jerome-benoit/sap-ai-provider
```

### Clear Cache

```bash
rm -rf node_modules
rm package-lock.json
npm install
```

---

## Getting Help

If you encounter issues during migration:

1. **Check Documentation:**
   - [README](./README.md)
   - [API Reference](./API_REFERENCE.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

2. **Search Issues:**
   - [GitHub Issues](https://github.com/jerome-benoit/sap-ai-provider/issues)

3. **Create New Issue:**
   - Include: Version numbers, error messages, code samples
   - Tag as: `migration`, `question`, or `bug`

4. **Community:**
   - Check discussions for similar issues
   - Ask questions with detailed context

---

## Related Documentation

- [README](./README.md) - Getting started and feature overview
- [API Reference](./API_REFERENCE.md) - Complete API documentation for v2.x
- [Environment Setup](./ENVIRONMENT_SETUP.md) - Authentication setup for both
  v1 and v2
- [Architecture](./ARCHITECTURE.md) - Technical architecture (v2
  implementation)
- [Contributing Guide](./CONTRIBUTING.md) - Development and contribution guidelines
- [cURL API Testing Guide](./CURL_API_TESTING_GUIDE.md) - Direct API testing for debugging
