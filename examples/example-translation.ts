#!/usr/bin/env node

/**
 * SAP AI Provider - Translation Example
 *
 * This example demonstrates input and output translation using the
 * SAP AI Core Orchestration API's translation module.
 *
 * Translation allows you to:
 * - **Input Translation**: Translate user queries from one language to another
 *   before sending to the LLM (e.g., German → English)
 * - **Output Translation**: Translate LLM responses back to the user's language
 *   (e.g., English → German)
 *
 * This is particularly useful for:
 * - Supporting users in multiple languages with a single English-based LLM
 * - Ensuring consistent quality by using the LLM in its strongest language
 * - Building multilingual applications without managing separate models
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
// import { createSAPAIProvider, buildTranslationConfig } from "@jerome-benoit/sap-ai-provider/v4";
import { buildTranslationConfig, createSAPAIProvider } from "../src/index-v4";

/**
 *
 */
async function translationExample() {
  console.log("🌐 SAP AI Translation Example\n");

  // Verify AICORE_SERVICE_KEY is set for local development
  if (!process.env.AICORE_SERVICE_KEY && !process.env.VCAP_SERVICES) {
    console.warn("⚠️  Warning: AICORE_SERVICE_KEY environment variable not set.");
    console.warn("   Set it in your .env file or environment for local development.\n");
  }

  try {
    // Example 1: Input Translation Only
    // User asks in German, LLM processes in English
    console.log("================================");
    console.log("📝 Example 1: Input Translation (German → English)");
    console.log("================================\n");

    const inputTranslationConfig = buildTranslationConfig("input", {
      sourceLanguage: "de", // German input
      targetLanguage: "en", // Translate to English for LLM
    });

    const providerInputTranslation = createSAPAIProvider({
      defaultSettings: {
        translation: {
          input: inputTranslationConfig,
        },
      },
    });

    const modelInputTranslation = providerInputTranslation("gpt-4.1");

    const germanQuery = "Was sind die Hauptvorteile von SAP AI Core?";
    console.log(`🇩🇪 German Query: ${germanQuery}\n`);

    const { text: inputTranslatedText } = await generateText({
      messages: [
        {
          content: germanQuery,
          role: "user",
        },
      ],
      model: modelInputTranslation,
    });

    console.log("🤖 Response (in English):", inputTranslatedText);
    console.log("\n📌 Note: The query was automatically translated from German to English");
    console.log("   before being sent to the LLM.");

    // Example 2: Output Translation Only
    // User asks in English, LLM responds in German
    console.log("\n================================");
    console.log("📝 Example 2: Output Translation (English → German)");
    console.log("================================\n");

    const outputTranslationConfig = buildTranslationConfig("output", {
      targetLanguage: "de", // Translate response to German
    });

    const providerOutputTranslation = createSAPAIProvider({
      defaultSettings: {
        translation: {
          output: outputTranslationConfig,
        },
      },
    });

    const modelOutputTranslation = providerOutputTranslation("gpt-4.1");

    const englishQuery = "What are the main benefits of SAP AI Core?";
    console.log(`🇬🇧 English Query: ${englishQuery}\n`);

    const { text: outputTranslatedText } = await generateText({
      messages: [
        {
          content: englishQuery,
          role: "user",
        },
      ],
      model: modelOutputTranslation,
    });

    console.log("🤖 Response (in German):", outputTranslatedText);
    console.log("\n📌 Note: The LLM processed the query in English and the response");
    console.log("   was automatically translated to German.");

    // Example 3: Bidirectional Translation
    // User asks in French, LLM processes in English, responds in French
    console.log("\n================================");
    console.log("📝 Example 3: Bidirectional Translation (French ↔ English)");
    console.log("================================\n");

    const bidirectionalTranslationConfig = {
      input: buildTranslationConfig("input", {
        sourceLanguage: "fr",
        targetLanguage: "en",
      }),
      output: buildTranslationConfig("output", {
        targetLanguage: "fr",
      }),
    };

    const providerBidirectional = createSAPAIProvider({
      defaultSettings: {
        translation: bidirectionalTranslationConfig,
      },
    });

    const modelBidirectional = providerBidirectional("gpt-4.1");

    const frenchQuery = "Quels sont les principaux avantages de SAP AI Core?";
    console.log(`🇫🇷 French Query: ${frenchQuery}\n`);

    const { text: bidirectionalText } = await generateText({
      messages: [
        {
          content: frenchQuery,
          role: "user",
        },
      ],
      model: modelBidirectional,
    });

    console.log("🤖 Response (in French):", bidirectionalText);
    console.log("\n📌 Note: The query was translated from French to English,");
    console.log(
      "   processed by the LLM in English, and the response was translated back to French.",
    );

    // Example 4: Multilingual Support with Different Languages
    console.log("\n================================");
    console.log("📝 Example 4: Supporting Multiple Languages");
    console.log("================================\n");

    const languages = [
      { code: "es", name: "Spanish", query: "¿Qué es SAP AI Core?" },
      { code: "it", name: "Italian", query: "Cos'è SAP AI Core?" },
      { code: "ja", name: "Japanese", query: "SAP AI Coreとは何ですか？" },
    ];

    for (const lang of languages) {
      console.log(`\n${lang.name} (${lang.code}):`);
      console.log(`   Query: ${lang.query}`);

      const langConfig = {
        input: buildTranslationConfig("input", {
          sourceLanguage: lang.code,
          targetLanguage: "en",
        }),
        output: buildTranslationConfig("output", {
          targetLanguage: lang.code,
        }),
      };

      const langProvider = createSAPAIProvider({
        defaultSettings: {
          translation: langConfig,
        },
      });

      const langModel = langProvider("gpt-4.1");

      const { text: langText } = await generateText({
        messages: [
          {
            content: lang.query,
            role: "user",
          },
        ],
        model: langModel,
      });

      console.log(`   Response: ${langText}`);
    }

    console.log("\n✅ Translation example completed!");

    console.log("\n💡 Key Takeaways:");
    console.log("   - Input translation: Translate user queries to LLM's language");
    console.log("   - Output translation: Translate responses to user's language");
    console.log("   - Bidirectional: Combine both for seamless multilingual UX");
    console.log("   - Supported languages: Use ISO 639-1 codes (en, de, fr, es, etc.)");
    console.log("   - No source language needed for output translation (auto-detected)");
  } catch (error: unknown) {
    if (error instanceof LoadAPIKeyError) {
      console.error("❌ Authentication Error:", error.message);
    } else if (error instanceof NoSuchModelError) {
      console.error("❌ Model Not Found:", error.modelId);
    } else if (error instanceof APICallError) {
      console.error("❌ API Call Error:", error.statusCode, error.message);

      // Parse SAP-specific metadata
      const sapError = JSON.parse(error.responseBody ?? "{}") as {
        error?: { code?: string; message?: string; request_id?: string };
      };
      if (sapError.error?.request_id) {
        console.error("   SAP Request ID:", sapError.error.request_id);
        console.error("   SAP Error Code:", sapError.error.code);
        console.error("   SAP Error Message:", sapError.error.message);
      }

      // Common errors
      if (error.statusCode === 400) {
        console.error("\n💡 Invalid language code or translation configuration.");
        console.error("   Use ISO 639-1 language codes (e.g., en, de, fr, es).");
      }
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("❌ Example failed:", errorMessage);
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   - Ensure AICORE_SERVICE_KEY is set with valid credentials");
    console.error("   - Check that your SAP AI Core instance is accessible");
    console.error("   - Verify the model supports the translation feature");
    console.error("   - Use valid ISO 639-1 language codes (2-letter codes like 'en', 'de')");
    console.error("   - Check SAP AI Core documentation for supported languages");
  }
}

translationExample().catch(console.error);

export { translationExample };
