#!/usr/bin/env node

/**
 * SAP AI Provider - Tool Calling Example
 *
 * This example demonstrates tool/function calling with the SAP AI Provider
 * using AI SDK 7 with the V4 entrypoint. Zod input schemas are converted
 * to JSON Schema by AI SDK and passed to SAP through the provider.
 *
 * Authentication:
 * - On SAP BTP: Automatically uses service binding (VCAP_SERVICES)
 * - Locally: Set AICORE_SERVICE_KEY environment variable with your service key JSON
 */

// Load environment variables
import "dotenv/config";
import { APICallError, LoadAPIKeyError, NoSuchModelError } from "@ai-sdk/provider";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

// This example uses relative imports for local development within this repo.
// In YOUR production project, use the published package instead:
// import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider/v4";
import { createSAPAIProvider } from "../src/index-v4";

// Define Zod schemas for type-safe execute functions
const calculatorSchema = z.object({
  a: z.number(),
  b: z.number(),
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
});

const weatherSchema = z.object({
  location: z.string(),
});

// Create AI SDK tools with execute functions
// inputSchema is used both for model-facing JSON Schema and argument validation.
const calculatorTool = tool({
  description: "Perform basic arithmetic operations",
  execute: (args: z.infer<typeof calculatorSchema>) => {
    const { a, b, operation } = args;
    switch (operation) {
      case "add":
        return String(a + b);
      case "divide":
        return b !== 0 ? String(a / b) : "Error: Division by zero";
      case "multiply":
        return String(a * b);
      case "subtract":
        return String(a - b);
      default:
        return "Unknown operation";
    }
  },
  inputSchema: calculatorSchema,
});

const weatherTool = tool({
  description: "Get weather for a location",
  // Demonstration response only; no external weather service is called.
  execute: (args: z.infer<typeof weatherSchema>) => {
    const { location } = args;
    return `Weather in ${location}: sunny, 72°F`;
  },
  inputSchema: weatherSchema,
});

/**
 *
 */
async function simpleToolExample() {
  console.log("🛠️  SAP AI Tool Calling Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  const provider = createSAPAIProvider();

  try {
    const model = provider("gpt-4.1");

    // Test 1: Calculator
    console.log("📱 Calculator Test");
    const result1 = await generateText({
      model,
      prompt: "What is 15 + 27?",
      stopWhen: [stepCountIs(5)],
      tools: {
        calculate: calculatorTool,
      },
    });
    console.log("Answer:", result1.text);
    console.log("");

    // Test 2: Weather
    console.log("🌤️  Weather Test");
    const result2 = await generateText({
      model,
      prompt: "What's the weather in Tokyo?",
      stopWhen: [stepCountIs(5)],
      tools: {
        getWeather: weatherTool,
      },
    });
    console.log("Answer:", result2.text);
    console.log("");

    // Test 3: Multiple tools
    console.log("🔧 Multiple Tools Test");
    const result3 = await generateText({
      model,
      prompt: "Calculate 8 * 7, then tell me about the weather in Paris",
      stopWhen: [stepCountIs(10)],
      tools: {
        calculate: calculatorTool,
        getWeather: weatherTool,
      },
    });
    console.log("Answer:", result3.text);

    console.log("\n✅ All tests completed!");
  } catch (error: unknown) {
    if (error instanceof LoadAPIKeyError) {
      console.error("❌ Authentication Error:", error.message);
    } else if (error instanceof NoSuchModelError) {
      console.error("❌ Model Not Found:", error.modelId);
    } else if (error instanceof APICallError) {
      console.error("❌ API Call Error:", error.statusCode, error.message);

      const sapError = JSON.parse(error.responseBody ?? "{}") as {
        error?: { code?: string; request_id?: string };
      };
      if (sapError.error?.request_id) {
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
    console.error("   - Verify the model supports tool calling");
  }
}

simpleToolExample().catch(console.error);

export { simpleToolExample };
