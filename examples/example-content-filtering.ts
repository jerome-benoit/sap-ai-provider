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

// This example uses relative imports for local development within this repo.
// In YOUR production project, use the published package instead:
// import { createSAPAIProvider, buildAzureContentSafetyFilter } from "@jerome-benoit/sap-ai-provider";
import { buildAzureContentSafetyFilter, createSAPAIProvider } from "../src/index";

interface SAPErrorResponseBody {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
}

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
    if (error instanceof LoadAPIKeyError) {
      console.error("❌ Authentication Error:", error.message);
    } else if (error instanceof NoSuchModelError) {
      console.error("❌ Model Not Found:", error.modelId);
    } else if (error instanceof APICallError) {
      console.error("❌ API Call Error:", error.statusCode, error.message);

      const sapError = parseSAPErrorResponseBody(error.responseBody);
      if (sapError?.error?.request_id) {
        console.error("   SAP Request ID:", sapError.error.request_id);
        console.error("   SAP Error Code:", sapError.error.code);
        console.error("   SAP Error Message:", sapError.error.message);
      }
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("❌ Example failed:", errorMessage);
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   - Ensure AICORE_SERVICE_KEY is set with valid credentials");
    console.error("   - Confirm you are using the Orchestration API");
    console.error("   - Verify content filtering is available in your SAP AI Core tenant");
    console.error("   - Check that the selected model is available in your deployment");
  }
}

/**
 * Checks whether a value is a non-null object record.
 * @param value - Value to inspect.
 * @returns True when the value can be accessed as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parses SAP AI Core error details from an API response body.
 * @param responseBody - Raw API response body from APICallError.
 * @returns Parsed SAP error details when the body matches the expected shape.
 */
function parseSAPErrorResponseBody(
  responseBody: string | undefined,
): SAPErrorResponseBody | undefined {
  if (!responseBody) {
    return undefined;
  }

  try {
    const parsedResponseBody: unknown = JSON.parse(responseBody);

    if (!isRecord(parsedResponseBody) || !isRecord(parsedResponseBody.error)) {
      return undefined;
    }

    return {
      error: {
        code:
          typeof parsedResponseBody.error.code === "string"
            ? parsedResponseBody.error.code
            : undefined,
        message:
          typeof parsedResponseBody.error.message === "string"
            ? parsedResponseBody.error.message
            : undefined,
        request_id:
          typeof parsedResponseBody.error.request_id === "string"
            ? parsedResponseBody.error.request_id
            : undefined,
      },
    };
  } catch {
    return undefined;
  }
}

contentFilteringExample().catch(console.error);

export { contentFilteringExample };
