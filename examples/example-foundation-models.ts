#!/usr/bin/env node

/**
 * SAP AI Provider - Foundation Models API Example
 *
 * This example demonstrates direct Azure OpenAI access through the Foundation
 * Models API, including logprobs, seed, and stop-sequence request parameters.
 * Orchestration can also forward model-specific parameters; support depends on the model.
 *
 * When to use Foundation Models API:
 * - You want to configure Azure OpenAI-specific request parameters
 * - You want best-effort reproducibility with seed (not guaranteed determinism)
 * - You need custom stop sequences
 * - You want direct model access without orchestration features
 *
 * When to use Orchestration API (default):
 * - You need data masking/anonymization
 * - You need content filtering
 * - You need document grounding
 * - You need prompt templating
 *
 * Authentication:
 * - On SAP BTP: Automatically uses service binding (VCAP_SERVICES)
 * - Locally: Set AICORE_SERVICE_KEY environment variable with your service key JSON
 */

// Load environment variables
import "dotenv/config";
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { embed, generateText, streamText } from "ai";

// NOTE: In production, use: import { createSAPAIProvider, SAP_AI_PROVIDER_NAME, UnsupportedFeatureError } from "@jerome-benoit/sap-ai-provider/v4";
import {
  createSAPAIProvider,
  SAP_AI_PROVIDER_NAME,
  UnsupportedFeatureError,
} from "../src/index-v4";
import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

/**
 * Demonstrates Foundation Models API features
 */
async function foundationModelsExample() {
  console.log("🔧 SAP AI Foundation Models API Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  try {
    console.log("📌 1. Provider-level API Selection\n");

    // Create a provider that defaults to Foundation Models API
    const fmProvider = createSAPAIProvider({
      api: "foundation-models",
    });

    // All models from this provider use Foundation Models API by default
    const result1 = await generateText({
      model: fmProvider("gpt-4.1"),
      prompt: "What is 2 + 2? Reply with just the number.",
    });

    console.log("   📄 Response:", result1.text);
    console.log(
      "   📊 Usage:",
      `${String(result1.usage.inputTokens)} input + ${String(result1.usage.outputTokens)} output`,
    );

    console.log("\n📌 2. Model-level API Selection\n");

    // Create a default provider (uses Orchestration by default)
    const provider = createSAPAIProvider();

    // Override to Foundation Models for specific model
    const fmModel = provider("gpt-4.1", { api: "foundation-models" });

    const result2 = await generateText({
      model: fmModel,
      prompt: "What is the capital of France? Reply in one word.",
    });

    console.log("   📄 Response:", result2.text);

    console.log("\n3. Configuring Logprobs\n");

    const result3 = await generateText({
      model: provider("gpt-4.1", {
        api: "foundation-models",
        modelParams: {
          logprobs: true,
          maxTokens: 5,
          top_logprobs: 3, // Get top 3 alternative tokens
        },
      }),
      prompt: "The quick brown",
    });

    console.log("   📄 Generated:", result3.text);

    // The request enables logprobs, but this provider does not expose them in
    // providerMetadata or response.body. Use the SAP SDK directly to inspect them.
    console.log("   Logprobs requested; token probabilities are not exposed by this provider.");

    console.log("\n4. Seed - Best-Effort Reproducibility\n");

    const seedValue = 12345;

    // Generate twice with same seed
    const deterministicModel = provider("gpt-4.1", {
      api: "foundation-models",
      modelParams: {
        max_tokens: 10,
        seed: seedValue,
        temperature: 0.7, // Seed requests repeatable sampling; identical output is not guaranteed.
      },
    });

    const result4a = await generateText({
      model: deterministicModel,
      prompt: "Generate a random 4-digit number.",
    });

    const result4b = await generateText({
      model: deterministicModel,
      prompt: "Generate a random 4-digit number.",
    });

    console.log(`   📄 First call (seed=${String(seedValue)}):`, result4a.text);
    console.log(`   📄 Second call (seed=${String(seedValue)}):`, result4b.text);
    console.log("   🔍 Same output?", result4a.text === result4b.text ? "Yes ✅" : "No ❌");

    console.log("\n📌 5. Stop Sequences\n");

    const result5 = await generateText({
      model: provider("gpt-4.1", {
        api: "foundation-models",
        modelParams: {
          max_tokens: 50,
          stop: [".", "!"], // Stop at first period or exclamation
        },
      }),
      prompt: "Write a sentence about the ocean",
    });

    console.log("   📄 Response (stopped at '.' or '!'):", result5.text);

    console.log("\n📌 6. Streaming with Foundation Models\n");

    let streamError: unknown;
    const stream = streamText({
      model: provider("gpt-4.1", {
        api: "foundation-models",
        modelParams: { max_tokens: 50 },
      }),
      onError: ({ error }) => {
        streamError = error;
      },
      prompt: "Count from 1 to 5, one number per line.",
    });

    process.stdout.write("   📡 Streaming: ");
    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }
    // textStream omits error events; let the common handler report the original error.
    if (streamError !== undefined) {
      throw streamError instanceof Error
        ? streamError
        : new Error("Streaming failed", { cause: streamError });
    }
    console.log("\n");

    console.log("📌 7. Embeddings with Foundation Models\n");

    const { embedding } = await embed({
      model: fmProvider.embedding("text-embedding-3-small"),
      value: "Hello, world!",
    });

    console.log(`   📊 Embedding dimensions: ${String(embedding.length)}`);
    console.log(
      `   📄 First 5 values: [${embedding
        .slice(0, 5)
        .map((v) => v.toFixed(6))
        .join(", ")}...]`,
    );

    console.log("\n📌 8. Call-level API Override\n");

    // Even with a provider defaulting to Orchestration,
    // you can override at the call level
    const orchProvider = createSAPAIProvider({ api: "orchestration" });

    const result8 = await generateText({
      model: orchProvider("gpt-4.1"),
      prompt: "Say hello",
      providerOptions: {
        [SAP_AI_PROVIDER_NAME]: {
          api: "foundation-models", // Override for this call only
          modelParams: {
            max_tokens: 10,
            seed: 42,
          },
        },
      },
    });

    console.log("   📄 Response:", result8.text);
    console.log("   📌 (Used Foundation Models API despite provider default)");

    console.log("\n📌 9. Feature Validation\n");

    // Note: UnsupportedFeatureError is thrown at runtime when you try
    // to use Orchestration-only features with Foundation Models API
    // (e.g., masking, filtering, grounding)
    console.log("   🔧 Foundation Models API supports: logprobs, seed, stop, logit_bias, user");
    console.log("   🔧 Orchestration API supports: masking, filtering, grounding, templating");
    console.log("   ⚠️  Using incompatible features throws UnsupportedFeatureError");

    console.log("\n✅ All Foundation Models examples completed!");
  } catch (error: unknown) {
    process.exitCode = 1;
    if (error instanceof LoadAPIKeyError) {
      console.error("❌ Authentication Error:", error.message);
    } else if (error instanceof NoSuchModelError) {
      console.error("❌ Model Not Found:", error.modelId);
    } else if (error instanceof UnsupportedFeatureError) {
      console.error("❌ Unsupported Feature:", error.message);
      console.error("   💡 Use API:", error.suggestedApi);
    } else if (error instanceof APICallError) {
      console.error("❌ API Call Error:", error.statusCode, error.message);

      // Parse SAP-specific metadata
      const sapError = parseSAPErrorResponseBody(error.responseBody);
      if (sapError?.error.request_id) {
        console.error("   SAP Request ID:", sapError.error.request_id);
        console.error("   SAP Error Code:", sapError.error.code);
      }
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("❌ Example failed:", errorMessage);
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   - Ensure AICORE_SERVICE_KEY is set with valid credentials");
    console.error("   - Check that your SAP AI Core instance is accessible");
    console.error("   - Verify the model is available in your deployment");
    console.error("   - Foundation Models API requires direct model deployments");
  }
}

foundationModelsExample().catch((error: unknown) => {
  process.exitCode = 1;
  console.error("Example failed:", error instanceof Error ? error.name : "Unknown error");
});

export { foundationModelsExample };
