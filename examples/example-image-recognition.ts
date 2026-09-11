#!/usr/bin/env node

/**
 * SAP AI Provider - Image Recognition Example
 *
 * This example demonstrates multi-modal capabilities (text + images)
 * using the SAP AI Provider with vision-enabled models.
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
// import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v4";
import { createSAPAIProvider } from "../src/index-v4";
import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

/**
 *
 */
async function imageRecognitionExample() {
  console.log("🖼️  SAP AI Image Recognition Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  try {
    const provider = createSAPAIProvider();

    // Example 1: Using a public URL
    console.log("📸 Example 1: Public URL Image");
    console.log("==============================");

    const { text: urlResponse } = await generateText({
      messages: [
        {
          content: [
            {
              text: "What do you see in this image?",
              type: "text",
            },
            {
              data: {
                type: "url",
                url: new URL(
                  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
                ),
              },
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
      model: provider("gpt-4.1"),
    });

    console.log("🤖 Response:", urlResponse);
    console.log("");

    // Example 2: Using base64 encoded image
    console.log("📸 Example 2: Base64 Encoded Image");
    console.log("==================================");

    // Small 1x1 pixel red PNG for demo
    const base64Image =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    const { text: base64Response } = await generateText({
      messages: [
        {
          content: [
            {
              text: "Describe this image in detail.",
              type: "text",
            },
            {
              data: { data: base64Image, type: "data" },
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
      model: provider("gpt-4.1"),
    });

    console.log("🤖 Response:", base64Response);
    console.log("");

    // Example 3: Multiple images analysis
    console.log("📸 Example 3: Multiple Images Analysis");
    console.log("=====================================");

    const { text: multiResponse } = await generateText({
      messages: [
        {
          content: [
            {
              text: "Compare these two images and tell me what you notice:",
              type: "text",
            },
            {
              data: {
                type: "url",
                url: new URL(
                  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
                ),
              },
              mediaType: "image/png",
              type: "file",
            },
            {
              data: { data: base64Image, type: "data" },
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
      model: provider("gpt-4.1"),
    });

    console.log("🤖 Response:", multiResponse);
    console.log("");

    console.log("✅ All examples completed successfully!");
  } catch (error: unknown) {
    if (error instanceof LoadAPIKeyError) {
      console.error("❌ Authentication Error:", error.message);
    } else if (error instanceof NoSuchModelError) {
      console.error("❌ Model Not Found:", error.modelId);
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
  }
}

imageRecognitionExample().catch(console.error);

export { imageRecognitionExample };
