#!/usr/bin/env npx tsx
/**
 * Quick test script for SAP AI Provider
 *
 * Usage: npx tsx test-quick.ts
 *
 * Make sure AICORE_SERVICE_KEY is set in .env or environment
 */

import "dotenv/config";
import { generateText } from "ai";

import { createSAPAIProvider } from "./src/index-v4";

/**
 *
 */
async function quickTest() {
  console.log("🧪 Quick Test: SAP AI Provider\n");

  // Check for credentials
  if (!process.env.AICORE_SERVICE_KEY) {
    console.error("❌ AICORE_SERVICE_KEY environment variable is not set!");
    console.error("\nSet it in .env file:");
    console.error('AICORE_SERVICE_KEY=\'{"serviceurls":{"AI_API_URL":"..."},...}\'');
    process.exit(1);
  }

  console.log("✅ AICORE_SERVICE_KEY found");
  console.log("🔄 Creating provider...");

  try {
    const provider = createSAPAIProvider();
    console.log("✅ Provider created (synchronously!)");

    console.log("\n📝 Testing gpt-4.1...");
    const { finishReason, text, usage } = await generateText({
      model: provider("gpt-4.1"),
      prompt: "Say 'Hello from SAP AI Core!' in exactly those words.",
    });

    console.log("\n✅ SUCCESS!");
    console.log("📄 Response:", text);
    console.log(
      "📊 Tokens:",
      `${String(usage.inputTokens ?? "unknown")} in / ${String(usage.outputTokens ?? "unknown")} out`,
    );
    console.log("🏁 Finish:", finishReason);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

await quickTest();
