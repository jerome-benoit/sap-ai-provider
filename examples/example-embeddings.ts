#!/usr/bin/env node

/**
 * SAP AI Provider - Embeddings Example
 *
 * This example demonstrates text embedding generation using the SAP AI Provider
 * with the Vercel AI SDK's embed and embedMany functions.
 *
 * Use cases:
 * - RAG (Retrieval-Augmented Generation)
 * - Semantic search
 * - Document similarity
 * - Clustering
 *
 * Authentication:
 * - On SAP BTP: Automatically uses service binding (VCAP_SERVICES)
 * - Locally: Set AICORE_SERVICE_KEY environment variable with your service key JSON
 */

// Load environment variables
import "dotenv/config";
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { cosineSimilarity, embed, embedMany } from "ai";

// In an application, import from the published V4 entrypoint:
// import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v4";
import { createSAPAIProvider } from "../src/index-v4";
import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

/**
 * Demonstrates single and batch embedding generation
 */
async function embeddingsExample() {
  console.log("📊 SAP AI Embeddings Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  try {
    const provider = createSAPAIProvider();

    console.log("🔢 Generating single embedding...\n");

    const { embedding } = await embed({
      model: provider.embedding("text-embedding-3-small"),
      value: "What is machine learning and how does it work?",
    });

    console.log("✅ Single embedding generated:");
    console.log(`   Dimensions: ${String(embedding.length)}`);
    console.log(
      `   First 5 values: [${embedding
        .slice(0, 5)
        .map((v) => v.toFixed(6))
        .join(", ")}...]`,
    );

    console.log("\n🔢 Generating batch embeddings...\n");

    const documents = [
      "Machine learning is a subset of artificial intelligence.",
      "Deep learning uses neural networks with many layers.",
      "Natural language processing helps computers understand text.",
      "Computer vision enables machines to interpret images.",
    ];

    const { embeddings } = await embedMany({
      model: provider.embedding("text-embedding-3-small"),
      values: documents,
    });

    console.log(`✅ Generated ${String(embeddings.length)} embeddings:`);
    embeddings.forEach((emb, idx) => {
      const doc = documents[idx] ?? "";
      console.log(
        `   [${String(idx)}] "${doc.slice(0, 40)}..." → ${String(emb.length)} dimensions`,
      );
    });

    console.log("\n📐 Calculating cosine similarities...\n");

    // Compare each document to the first one
    const referenceDoc = documents[0] ?? "";
    const referenceEmb = embeddings[0] ?? [];
    console.log(`   Reference: "${referenceDoc.slice(0, 40)}..."`);
    for (let i = 1; i < embeddings.length; i++) {
      const currentEmb = embeddings[i] ?? [];
      const currentDoc = documents[i] ?? "";
      const similarity = cosineSimilarity(referenceEmb, currentEmb);
      console.log(`   → "${currentDoc.slice(0, 35)}..." similarity: ${similarity.toFixed(4)}`);
    }

    console.log("\n🏷️  Testing embedding types...\n");

    // Document embedding (for storage/indexing)
    const { embedding: docEmbedding } = await embed({
      model: provider.embedding("text-embedding-3-small", {
        type: "document",
      }),
      value: "This is a document to be indexed for later retrieval.",
    });
    console.log(`   Document embedding: ${String(docEmbedding.length)} dimensions`);

    // Query embedding (for search queries)
    const { embedding: queryEmbedding } = await embed({
      model: provider.embedding("text-embedding-3-small", {
        type: "query",
      }),
      value: "How do I retrieve documents?",
    });
    console.log(`   Query embedding: ${String(queryEmbedding.length)} dimensions`);

    console.log("\n✅ All embedding tests completed!");
  } catch (error: unknown) {
    process.exitCode = 1;
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
    console.error("   - Verify the embedding model is available in your deployment");
  }
}

embeddingsExample().catch((error: unknown) => {
  process.exitCode = 1;
  console.error("Example failed:", error instanceof Error ? error.name : "Unknown error");
});

export { embeddingsExample };
