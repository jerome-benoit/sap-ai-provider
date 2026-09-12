#!/usr/bin/env node

/**
 * SAP AI Provider - Content Filtering Example
 *
 * This example demonstrates content filtering with the SAP AI Core
 * Orchestration API. Content filtering is not available with the Foundation
 * Models API.
 *
 * Authentication:
 * - On SAP BTP: Automatically uses service binding (VCAP_SERVICES)
 * - Locally: Set AICORE_SERVICE_KEY environment variable with your service key JSON
 */

// Load environment variables
import "dotenv/config";
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { generateText } from "ai";

// In an application, import from the published V4 entrypoint:
// import { createSAPAIProvider, buildAzureContentSafetyFilter } from "@jerome-benoit/sap-ai-provider/v4";
import { buildAzureContentSafetyFilter, createSAPAIProvider } from "../src/index-v4";
import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

/**
 * Runs the content filtering example.
 * @returns A promise that resolves when the example completes.
 */
async function contentFilteringExample() {
  console.log("🛡️ SAP AI Content Filtering Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  try {
    const provider = createSAPAIProvider({
      api: "orchestration",
      defaultSettings: {
        filtering: {
          input: {
            filters: [
              buildAzureContentSafetyFilter("input", {
                hate: "ALLOW_SAFE",
                self_harm: "ALLOW_SAFE",
                sexual: "ALLOW_SAFE",
                violence: "ALLOW_SAFE_LOW_MEDIUM",
              }),
            ],
          },
          output: {
            filters: [
              buildAzureContentSafetyFilter("output", {
                hate: "ALLOW_SAFE",
                self_harm: "ALLOW_SAFE",
                sexual: "ALLOW_SAFE",
                violence: "ALLOW_SAFE_LOW_MEDIUM",
              }),
            ],
          },
        },
      },
    });

    const model = provider("gpt-4.1");

    console.log("📝 Sending a normal prompt with input and output filters enabled...\n");

    const { text } = await generateText({
      messages: [
        {
          content: "Give three safety practices for deploying AI assistants in a company.",
          role: "user",
        },
      ],
      model,
    });

    console.log("🤖 Filtered Response:", text);
    console.log("\n📌 Note: Filtering is evaluated by SAP AI Core orchestration modules.");
    console.log("   Filter behavior depends on your tenant, model, and SAP AI Core setup.");

    console.log("\n✅ Content filtering example completed!");
  } catch (error: unknown) {
    process.exitCode = 1;
    if (error instanceof LoadAPIKeyError) {
      console.error("❌ Authentication Error:", error.name);
    } else if (error instanceof NoSuchModelError) {
      console.error("❌ Model Not Found:", error.modelId);
    } else if (error instanceof APICallError) {
      console.error("❌ API Call Error:", error.statusCode, error.name);

      const sapError = parseSAPErrorResponseBody(error.responseBody);
      if (sapError?.error.request_id) {
        console.error("   SAP Request ID:", sapError.error.request_id);
      }
    } else {
      const errorName = error instanceof Error ? error.name : "Unknown error";
      console.error("❌ Example failed:", errorName);
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   - Ensure AICORE_SERVICE_KEY is set with valid credentials");
    console.error("   - Confirm you are using the Orchestration API");
    console.error("   - Verify content filtering is available in your SAP AI Core tenant");
    console.error("   - Check that the selected model is available in your deployment");
  }
}

contentFilteringExample().catch((error: unknown) => {
  process.exitCode = 1;
  console.error("Example failed:", error instanceof Error ? error.name : "Unknown error");
});

export { contentFilteringExample };
