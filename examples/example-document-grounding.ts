#!/usr/bin/env node

/**
 * SAP AI Provider - Document Grounding (RAG) Example
 *
 * This example demonstrates document grounding (Retrieval-Augmented Generation)
 * using the SAP AI Core Orchestration API's document grounding module.
 *
 * Document grounding allows you to ground LLM responses in your own documents
 * indexed in SAP grounding data repositories. Retrieved context can improve
 * relevance, but does not guarantee factual answers.
 *
 * Prerequisites:
 * - A configured SAP document grounding data repository with indexed documents
 * - Its data repository ID in VECTOR_STORE_ID
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
// import { createSAPAIProvider, buildDocumentGroundingConfig } from "@jerome-benoit/sap-ai-provider/v4";
import {
  buildDocumentGroundingConfig,
  createSAPAIProvider,
  SAP_AI_PROVIDER_NAME,
} from "../src/index-v4";
import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

/** Compares ungrounded generation with retrieval restricted to the selected repository. */
async function documentGroundingExample() {
  console.log("📚 SAP AI Document Grounding (RAG) Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  // Check for vector store configuration
  const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID?.trim();
  if (!VECTOR_STORE_ID) {
    console.error("Set VECTOR_STORE_ID to your SAP grounding data repository ID.");
    process.exitCode = 1;
    return;
  }

  console.log("📋 Configuration:");
  console.log(`   Vector Store ID: ${VECTOR_STORE_ID}`);
  console.log("");

  try {
    // Example 1: Basic document grounding configuration
    console.log("================================");
    console.log("📖 Example 1: Basic Document Grounding");
    console.log("================================\n");

    const basicGroundingConfig = buildDocumentGroundingConfig({
      filters: [
        {
          // Restrict retrieval to the configured data repository
          data_repositories: [VECTOR_STORE_ID],
        },
      ],
      // Required: Define the placeholders used by the grounding module.
      placeholders: {
        input: ["groundingRequest"],
        output: "groundingOutput",
      },
    });

    const provider = createSAPAIProvider({
      defaultSettings: {
        grounding: basicGroundingConfig,
      },
    });

    const model = provider("gpt-4.1");

    console.log("📝 Query: What are the key features of SAP AI Core?\n");

    const { text } = await generateText({
      model,
      prompt: "Question: {{?groundingRequest}}\nContext: {{?groundingOutput}}",
      providerOptions: {
        [SAP_AI_PROVIDER_NAME]: {
          escapeTemplatePlaceholders: false,
          placeholderValues: {
            groundingRequest: "What are the key features of SAP AI Core?",
          },
        },
      },
    });

    console.log("🤖 Grounded Response:", text);
    console.log("\n📌 Note: Retrieved repository documents provide context; verify the answer.");

    // Example 2: Advanced grounding with metadata
    console.log("\n================================");
    console.log("📊 Example 2: Grounding with Metadata");
    console.log("================================\n");

    const advancedGroundingConfig = buildDocumentGroundingConfig({
      filters: [
        {
          data_repositories: [VECTOR_STORE_ID],
        },
      ],
      // Request metadata about the retrieved chunks
      metadata_params: ["file_name", "document_id", "chunk_id"],
      placeholders: {
        input: ["groundingRequest"],
        output: "groundingOutput",
      },
    });

    const providerAdvanced = createSAPAIProvider({
      defaultSettings: {
        grounding: advancedGroundingConfig,
      },
    });

    const modelAdvanced = providerAdvanced("gpt-4.1");

    console.log("📝 Query: How do I deploy a model in SAP AI Core? Include sources.\n");

    const { text: advancedText } = await generateText({
      model: modelAdvanced,
      prompt: "Question: {{?groundingRequest}}\nContext: {{?groundingOutput}}",
      providerOptions: {
        [SAP_AI_PROVIDER_NAME]: {
          escapeTemplatePlaceholders: false,
          placeholderValues: {
            groundingRequest:
              "How do I deploy a model in SAP AI Core? Please cite your sources with file names.",
          },
        },
      },
    });

    console.log("🤖 Grounded Response with Metadata:", advancedText);

    // Example 3: Comparison with and without grounding
    console.log("\n================================");
    console.log("🔍 Example 3: Grounded vs Ungrounded Comparison");
    console.log("================================\n");

    const providerNoGrounding = createSAPAIProvider();
    const modelNoGrounding = providerNoGrounding("gpt-4.1");

    const query = "What is the latest pricing for our enterprise plan?";
    console.log(`📝 Query: ${query}\n`);

    console.log("🌐 Response WITHOUT grounding (general knowledge):");
    const { text: ungroundedText } = await generateText({
      messages: [
        {
          content: query,
          role: "user",
        },
      ],
      model: modelNoGrounding,
    });
    console.log(ungroundedText);

    console.log("\n📚 Response WITH grounding (your documents):");
    const { text: groundedText } = await generateText({
      model,
      prompt: "Question: {{?groundingRequest}}\nContext: {{?groundingOutput}}",
      providerOptions: {
        [SAP_AI_PROVIDER_NAME]: {
          escapeTemplatePlaceholders: false,
          placeholderValues: {
            groundingRequest: query,
          },
        },
      },
    });
    console.log(groundedText);

    console.log("\n✅ Document grounding example completed!");

    console.log("\n💡 Next Steps:");
    console.log("   - Keep escapeTemplatePlaceholders enabled for normal prompts");
    console.log(
      "   - Set it to false only when sending SAP template placeholders like {{?groundingRequest}}",
    );
    console.log("   - Index your documents through SAP document grounding");
    console.log("   - Set VECTOR_STORE_ID environment variable");
    console.log("   - Use document_metadata filters to restrict search to specific documents");
    console.log("   - Use metadata_params to retrieve source information for citations");
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

      // Common errors
      if (error.statusCode === 400) {
        console.error("\n💡 HTTP 400: inspect the request configuration and grounding setup.");
        console.error("   Verify the SAP grounding data repository is configured.");
      }
    } else {
      const errorName = error instanceof Error ? error.name : "Unknown error";
      console.error("❌ Example failed:", errorName);
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   - Ensure AICORE_SERVICE_KEY is set with valid credentials");
    console.error("   - Check that your SAP AI Core instance is accessible");
    console.error("   - Verify your SAP grounding data repository is configured and populated");
    console.error("   - Ensure VECTOR_STORE_ID matches the data repository ID");
    console.error("   - Check that documents are indexed in that data repository");
  }
}

documentGroundingExample().catch((error: unknown) => {
  process.exitCode = 1;
  console.error("Example failed:", error instanceof Error ? error.name : "Unknown error");
});

export { documentGroundingExample };
