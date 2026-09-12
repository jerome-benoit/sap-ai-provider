#!/usr/bin/env node

/**
 * SAP AI Provider - Simple Chat Completion Example
 *
 * This example demonstrates basic chat completion using the SAP AI Provider
 * powered by `@sap-ai-sdk/orchestration` and `@sap-ai-sdk/foundation-models`.
 *
 * Authentication:
 * - On SAP BTP: Automatically uses service binding (VCAP_SERVICES)
 * - Locally: Set AICORE_SERVICE_KEY environment variable with your service key JSON
 */

// Load environment variables
import "dotenv/config";
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";

// In an application, import from the published V4 entrypoint:
// import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v4";
import { createSAPAIProvider } from "../src/index-v4";
import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

/** Runs one chat request and classifies authentication, model and API errors. */
async function simpleTest() {
  console.log("🧪 Simple SAP AI Chat Completion Example\n");

  try {
    // Verify AICORE_SERVICE_KEY is set for local development
    if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
      console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
      console.warn("   Set it in your .env file or environment for local development.\n");
    }

    console.log("🔄 Creating SAP AI provider...");

    // Create provider - authentication is handled automatically by SAP AI SDK
    const provider = createSAPAIProvider({
      resourceGroup: "default", // Optional: specify resource group
    });

    console.log("📝 Testing text generation with gpt-4.1...");

    const model = provider("gpt-4.1", {
      modelParams: {
        maxTokens: 1000,
        temperature: 0.7,
      },
    });

    const result = await model.doGenerate({
      prompt: [
        {
          content: [{ text: "How to cook a delicious chicken recipe?", type: "text" }],
          role: "user",
        },
      ],
    });

    // Extract text from content array
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("");

    console.log("✅ Success!");
    console.log("📄 Generated text:", text);
    console.log(
      "📊 Usage:",
      `${String(result.usage.inputTokens.total)} prompt + ${String(result.usage.outputTokens.total)} completion tokens`,
    );
    console.log("🏁 Finish reason:", result.finishReason);
    console.log("");
  } catch (error: unknown) {
    process.exitCode = 1;
    if (error instanceof LoadAPIKeyError) {
      // 401/403: Authentication or permission issue
      console.error("❌ Authentication Error:", error.name);
    } else if (error instanceof NoSuchModelError) {
      // 404: Model or deployment not found
      console.error("❌ Model Not Found:", error.modelId);
    } else if (error instanceof APICallError) {
      console.error("❌ API Call Error:", error.statusCode, error.name);

      // Parse SAP-specific metadata
      const sapError = parseSAPErrorResponseBody(error.responseBody);
      if (sapError?.error.request_id) {
        console.error("   SAP Request ID:", sapError.error.request_id);
      }
    } else {
      const errorName = error instanceof Error ? error.name : "Unknown error";
      console.error("❌ Test failed:", errorName);
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   - Ensure AICORE_SERVICE_KEY is set with valid credentials");
    console.error("   - Check that your SAP AI Core instance is accessible");
    console.error("   - Verify the model is available in your deployment");
  }
}

simpleTest().catch((error: unknown) => {
  process.exitCode = 1;
  console.error("Example failed:", error instanceof Error ? error.name : "Unknown error");
});

export { simpleTest };
