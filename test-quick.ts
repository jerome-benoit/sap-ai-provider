#!/usr/bin/env npx tsx
/**
 * Quick test script for SAP AI Provider
 *
 * Usage: npx tsx test-quick.ts
 *
 * Set AICORE_SERVICE_KEY locally or use VCAP_SERVICES on SAP BTP.
 */

import "dotenv/config";
import { generateText } from "ai";

import { createSAPAIProvider } from "./src/index-v4";

/** Checks for configured credentials before a single generation request. */
async function quickTest() {
  console.log("🧪 Quick Test: SAP AI Provider\n");

  // Check for credentials
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.error("Set AICORE_SERVICE_KEY locally or configure VCAP_SERVICES on SAP BTP.");
    process.exitCode = 1;
    return;
  }

  console.log("Authentication configuration found");
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
    // Do not dump request bodies, headers or nested transport errors.
    console.error("Test failed:", error instanceof Error ? error.name : "Unknown error");
    process.exitCode = 1;
  }
}

await quickTest();
