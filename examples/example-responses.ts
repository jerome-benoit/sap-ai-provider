#!/usr/bin/env node

/**
 * OpenAI Responses generation, streaming, and tool round trips through SAP AI Core.
 * Configure AICORE_SERVICE_KEY or a SAP BTP service binding before running.
 */
import "dotenv/config";
import { APICallError } from "@ai-sdk/provider";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

// In an AI SDK 7 application, import from "@jerome-benoit/sap-ai-provider/v4".
import { createSAPAIProvider } from "../src/index-v4.js";

const provider = createSAPAIProvider({ api: "responses" });
const model = provider("gpt-6.1-sol", {
  responses: { reasoningEffort: "low" },
});
const tools = {
  add: tool({
    description: "Add two numbers, with an optional offset.",
    execute: ({ a, b, offset }) => ({ sum: a + b + (offset ?? 0) }),
    inputSchema: z.object({
      a: z.number(),
      b: z.number(),
      offset: z.number().optional(),
    }),
  }),
};

/** Runs both generation methods with a local tool and a model follow-up. */
async function main(): Promise<void> {
  const generated = await generateText({
    model,
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? { toolName: "add", type: "tool" } : "none",
    }),
    prompt: "Use add to calculate 19 + 23. Omit offset, then explain the result.",
    stopWhen: stepCountIs(3),
    tools,
  });
  console.log("Generated:", generated.text);

  const streamed = streamText({
    model,
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? { toolName: "add", type: "tool" } : "none",
    }),
    prompt: "Use add to calculate 25 + 17. Omit offset, then explain the result.",
    stopWhen: stepCountIs(3),
    tools,
  });
  process.stdout.write("Streamed: ");
  for await (const part of streamed.stream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta") process.stdout.write(part.text);
  }
  process.stdout.write("\n");
}

void main().catch((error: unknown) => {
  process.exitCode = 1;
  if (APICallError.isInstance(error)) {
    console.error("Responses request failed:", error.statusCode, error.name);
  } else {
    console.error(
      "Responses example failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
  }
});
