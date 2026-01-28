/**
 * Tests for SAP AI API validation functions.
 */
import { describe, expect, it } from "vitest";

import type { SAPAIModelSettings } from "./sap-ai-settings";

import { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error";
import {
  getEffectiveEscapeTemplatePlaceholders,
  resolveApi,
  validateApiInput,
  validateApiSwitch,
  validateEscapeTemplatePlaceholders,
  validateFoundationModelsOnlyOptions,
  validateOrchestrationOnlyOptions,
  validateSettings,
} from "./sap-ai-validation";

/**
 * Helper to create mock settings for testing.
 * The validation only checks if properties !== undefined, so we use type assertions
 * to avoid having to construct fully valid SDK types.
 * @param partial - Partial settings object to convert.
 * @returns The mock settings cast to SAPAIModelSettings.
 */
function mockSettings(partial: Record<string, unknown>): SAPAIModelSettings {
  return partial as SAPAIModelSettings;
}

describe("resolveApi", () => {
  describe("precedence chain", () => {
    it("should return invocationApi when all levels are set (highest priority)", () => {
      expect(resolveApi("orchestration", "orchestration", "foundation-models")).toBe(
        "foundation-models",
      );
      expect(resolveApi("foundation-models", "foundation-models", "orchestration")).toBe(
        "orchestration",
      );
    });

    it("should return modelApi when invocationApi is undefined", () => {
      expect(resolveApi("orchestration", "foundation-models", undefined)).toBe("foundation-models");
      expect(resolveApi("foundation-models", "orchestration", undefined)).toBe("orchestration");
    });

    it("should return providerApi when both invocationApi and modelApi are undefined", () => {
      expect(resolveApi("foundation-models", undefined, undefined)).toBe("foundation-models");
      expect(resolveApi("orchestration", undefined, undefined)).toBe("orchestration");
    });

    it("should return default 'orchestration' when all levels are undefined", () => {
      expect(resolveApi(undefined, undefined, undefined)).toBe("orchestration");
    });
  });

  describe("partial precedence scenarios", () => {
    it("should skip undefined levels in precedence chain", () => {
      // Provider undefined, model set, invocation undefined -> model wins
      expect(resolveApi(undefined, "foundation-models", undefined)).toBe("foundation-models");

      // Provider set, model undefined, invocation set -> invocation wins
      expect(resolveApi("orchestration", undefined, "foundation-models")).toBe("foundation-models");
    });

    it("should handle all combinations correctly", () => {
      // All permutations of undefined vs set values
      type ApiOrUndefined = "foundation-models" | "orchestration" | undefined;
      const apis: ApiOrUndefined[] = [undefined, "orchestration", "foundation-models"];

      for (const provider of apis) {
        for (const model of apis) {
          for (const invocation of apis) {
            const expected = invocation ?? model ?? provider ?? "orchestration";
            expect(resolveApi(provider, model, invocation)).toBe(expected);
          }
        }
      }
    });
  });
});

describe("validateOrchestrationOnlyOptions", () => {
  it("should pass with undefined settings", () => {
    expect(() => {
      validateOrchestrationOnlyOptions(undefined);
    }).not.toThrow();
  });

  it("should pass with empty settings", () => {
    expect(() => {
      validateOrchestrationOnlyOptions(mockSettings({}));
    }).not.toThrow();
  });

  it("should pass with Foundation Models settings (no Orch-only options)", () => {
    expect(() => {
      validateOrchestrationOnlyOptions(
        mockSettings({
          api: "foundation-models",
          dataSources: [],
          includeReasoning: true,
        }),
      );
    }).not.toThrow();
  });

  it("should throw UnsupportedFeatureError for filtering", () => {
    const settings = mockSettings({ filtering: { input: {} } });

    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(/Content filtering is not supported with Foundation Models API/);
  });

  it("should throw UnsupportedFeatureError for grounding", () => {
    const settings = mockSettings({
      grounding: { config: {}, type: "document_grounding_service" },
    });

    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(/Document grounding is not supported with Foundation Models API/);
  });

  it("should throw UnsupportedFeatureError for masking", () => {
    const settings = mockSettings({
      masking: { masking_providers: [] },
    });

    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(/Data masking is not supported with Foundation Models API/);
  });

  it("should throw UnsupportedFeatureError for translation", () => {
    const settings = mockSettings({
      translation: { input: { config: {}, type: "sap_document_translation" } },
    });

    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(/Translation is not supported with Foundation Models API/);
  });

  it("should throw UnsupportedFeatureError for tools", () => {
    const settings = mockSettings({
      tools: [{ function: { name: "test", parameters: {} }, type: "function" }],
    });

    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(/SAP-format tool definitions.*is not supported with Foundation Models API/);
  });

  it("should check features in order (filtering first)", () => {
    const settings = mockSettings({
      filtering: { input: {} },
      grounding: { type: "document_grounding_service" },
    });

    expect(() => {
      validateOrchestrationOnlyOptions(settings);
    }).toThrow(/Content filtering/);
  });
});

describe("validateFoundationModelsOnlyOptions", () => {
  it("should pass with undefined settings", () => {
    expect(() => {
      validateFoundationModelsOnlyOptions(undefined);
    }).not.toThrow();
  });

  it("should pass with empty settings", () => {
    expect(() => {
      validateFoundationModelsOnlyOptions(mockSettings({}));
    }).not.toThrow();
  });

  it("should pass with Orchestration settings (no FM-only options)", () => {
    expect(() => {
      validateFoundationModelsOnlyOptions(
        mockSettings({
          api: "orchestration",
          filtering: { input: {} },
          includeReasoning: true,
        }),
      );
    }).not.toThrow();
  });

  it("should throw UnsupportedFeatureError for dataSources", () => {
    const settings = mockSettings({
      api: "foundation-models",
      dataSources: [
        {
          parameters: {
            authentication: { type: "system_assigned_managed_identity" },
            endpoint: "https://search.example.com",
            index_name: "my-index",
          },
          type: "azure_search",
        },
      ],
    });

    expect(() => {
      validateFoundationModelsOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
    expect(() => {
      validateFoundationModelsOnlyOptions(settings);
    }).toThrow(/Azure On Your Data \(dataSources\) is not supported with Orchestration API/);
  });

  it("should throw with empty dataSources array (still !== undefined)", () => {
    const settings = mockSettings({
      api: "foundation-models",
      dataSources: [],
    });

    expect(() => {
      validateFoundationModelsOnlyOptions(settings);
    }).toThrow(UnsupportedFeatureError);
  });
});

describe("validateEscapeTemplatePlaceholders", () => {
  describe("with Foundation Models API", () => {
    it("should throw when escapeTemplatePlaceholders=true explicitly", () => {
      expect(() => {
        validateEscapeTemplatePlaceholders("foundation-models", true);
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateEscapeTemplatePlaceholders("foundation-models", true);
      }).toThrow(/escapeTemplatePlaceholders.*is not supported with Foundation Models API/);
    });

    it("should pass when escapeTemplatePlaceholders=false", () => {
      expect(() => {
        validateEscapeTemplatePlaceholders("foundation-models", false);
      }).not.toThrow();
    });

    it("should pass when escapeTemplatePlaceholders=undefined", () => {
      expect(() => {
        validateEscapeTemplatePlaceholders("foundation-models", undefined);
      }).not.toThrow();
    });
  });

  describe("with Orchestration API", () => {
    it("should pass when escapeTemplatePlaceholders=true", () => {
      expect(() => {
        validateEscapeTemplatePlaceholders("orchestration", true);
      }).not.toThrow();
    });

    it("should pass when escapeTemplatePlaceholders=false", () => {
      expect(() => {
        validateEscapeTemplatePlaceholders("orchestration", false);
      }).not.toThrow();
    });

    it("should pass when escapeTemplatePlaceholders=undefined", () => {
      expect(() => {
        validateEscapeTemplatePlaceholders("orchestration", undefined);
      }).not.toThrow();
    });
  });
});

describe("validateApiSwitch", () => {
  it("should pass when APIs are the same (no switch)", () => {
    const settings = mockSettings({ filtering: { input: {} } });
    expect(() => {
      validateApiSwitch("orchestration", "orchestration", settings);
    }).not.toThrow();
  });

  it("should pass when settings are undefined", () => {
    expect(() => {
      validateApiSwitch("orchestration", "foundation-models", undefined);
    }).not.toThrow();
  });

  it("should pass when switching with no conflicting features", () => {
    const settings = mockSettings({
      includeReasoning: true,
      modelParams: { temperature: 0.7 },
    });
    expect(() => {
      validateApiSwitch("orchestration", "foundation-models", settings);
    }).not.toThrow();
  });

  describe("switching from Orchestration to Foundation Models", () => {
    it("should throw ApiSwitchError for filtering", () => {
      const settings = mockSettings({ filtering: { input: {} } });

      expect(() => {
        validateApiSwitch("orchestration", "foundation-models", settings);
      }).toThrow(ApiSwitchError);

      try {
        validateApiSwitch("orchestration", "foundation-models", settings);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiSwitchError);
        const error = e as ApiSwitchError;
        expect(error.fromApi).toBe("orchestration");
        expect(error.toApi).toBe("foundation-models");
        expect(error.conflictingFeature).toBe("filtering");
      }
    });

    it("should throw ApiSwitchError for grounding", () => {
      const settings = mockSettings({
        grounding: { config: {}, type: "document_grounding_service" },
      });

      expect(() => {
        validateApiSwitch("orchestration", "foundation-models", settings);
      }).toThrow(ApiSwitchError);
    });

    it("should throw ApiSwitchError for masking", () => {
      const settings = mockSettings({ masking: { masking_providers: [] } });

      expect(() => {
        validateApiSwitch("orchestration", "foundation-models", settings);
      }).toThrow(ApiSwitchError);
    });

    it("should throw ApiSwitchError for translation", () => {
      const settings = mockSettings({
        translation: { input: { type: "sap_document_translation" } },
      });

      expect(() => {
        validateApiSwitch("orchestration", "foundation-models", settings);
      }).toThrow(ApiSwitchError);
    });

    it("should throw ApiSwitchError for tools", () => {
      const settings = mockSettings({
        tools: [{ function: { name: "test", parameters: {} }, type: "function" }],
      });

      expect(() => {
        validateApiSwitch("orchestration", "foundation-models", settings);
      }).toThrow(ApiSwitchError);
    });
  });

  describe("switching from Foundation Models to Orchestration", () => {
    it("should throw ApiSwitchError for dataSources", () => {
      const settings = mockSettings({
        api: "foundation-models",
        dataSources: [
          {
            parameters: {
              authentication: { type: "system_assigned_managed_identity" },
              endpoint: "https://search.example.com",
              index_name: "my-index",
            },
            type: "azure_search",
          },
        ],
      });

      expect(() => {
        validateApiSwitch("foundation-models", "orchestration", settings);
      }).toThrow(ApiSwitchError);

      try {
        validateApiSwitch("foundation-models", "orchestration", settings);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiSwitchError);
        const error = e as ApiSwitchError;
        expect(error.fromApi).toBe("foundation-models");
        expect(error.toApi).toBe("orchestration");
        expect(error.conflictingFeature).toBe("dataSources");
      }
    });

    it("should pass when FM settings have no dataSources", () => {
      const settings = mockSettings({
        api: "foundation-models",
        includeReasoning: true,
      });

      expect(() => {
        validateApiSwitch("foundation-models", "orchestration", settings);
      }).not.toThrow();
    });
  });
});

describe("validateApiInput", () => {
  it("should pass for 'orchestration'", () => {
    expect(() => {
      validateApiInput("orchestration");
    }).not.toThrow();
  });

  it("should pass for 'foundation-models'", () => {
    expect(() => {
      validateApiInput("foundation-models");
    }).not.toThrow();
  });

  it("should pass for undefined (treated as unset)", () => {
    expect(() => {
      validateApiInput(undefined);
    }).not.toThrow();
  });

  it("should throw for invalid string values", () => {
    expect(() => {
      validateApiInput("invalid");
    }).toThrow(/Invalid API type/);
    expect(() => {
      validateApiInput("invalid");
    }).toThrow(/"orchestration", "foundation-models"/);
  });

  it("should throw for empty string", () => {
    expect(() => {
      validateApiInput("");
    }).toThrow(/Invalid API type/);
  });

  it("should throw for non-string values", () => {
    expect(() => {
      validateApiInput(123);
    }).toThrow(/Invalid API type/);
    expect(() => {
      validateApiInput(null);
    }).toThrow(/Invalid API type/);
    expect(() => {
      validateApiInput({});
    }).toThrow(/Invalid API type/);
    expect(() => {
      validateApiInput([]);
    }).toThrow(/Invalid API type/);
  });

  it("should include the invalid value in error message", () => {
    expect(() => {
      validateApiInput("foobar");
    }).toThrow(/"foobar"/);
    expect(() => {
      validateApiInput(42);
    }).toThrow(/42/);
  });
});

describe("validateSettings", () => {
  it("should pass with valid Orchestration settings", () => {
    expect(() => {
      validateSettings({
        api: "orchestration",
        modelSettings: mockSettings({
          filtering: { input: {} },
          includeReasoning: true,
        }),
      });
    }).not.toThrow();
  });

  it("should pass with valid Foundation Models settings", () => {
    expect(() => {
      validateSettings({
        api: "foundation-models",
        modelSettings: mockSettings({
          api: "foundation-models",
          dataSources: [],
          includeReasoning: true,
        }),
      });
    }).not.toThrow();
  });

  it("should throw for Orchestration features with Foundation Models API", () => {
    expect(() => {
      validateSettings({
        api: "foundation-models",
        modelSettings: mockSettings({ filtering: { input: {} } }),
      });
    }).toThrow(UnsupportedFeatureError);
  });

  it("should throw for Foundation Models features with Orchestration API", () => {
    expect(() => {
      validateSettings({
        api: "orchestration",
        modelSettings: mockSettings({
          api: "foundation-models",
          dataSources: [
            {
              parameters: {
                authentication: { type: "system_assigned_managed_identity" },
                endpoint: "https://test.com",
                index_name: "idx",
              },
              type: "azure_search",
            },
          ],
        }),
      });
    }).toThrow(UnsupportedFeatureError);
  });

  it("should validate API switch when invocation API differs", () => {
    expect(() => {
      validateSettings({
        api: "foundation-models",
        invocationSettings: {
          api: "foundation-models",
        },
        modelApi: "orchestration",
        modelSettings: mockSettings({ filtering: { input: {} } }),
      });
    }).toThrow(ApiSwitchError);
  });

  it("should throw ApiSwitchError when modelApi is undefined but model has orchestration features and invocation switches to foundation-models", () => {
    expect(() => {
      validateSettings({
        api: "orchestration", // effective API from provider
        invocationSettings: {
          api: "foundation-models", // user tries to switch at invocation time
        },
        modelApi: undefined, // default - should be treated as "orchestration"
        modelSettings: mockSettings({ filtering: { input: {} } }), // orchestration-only feature
      });
    }).toThrow(ApiSwitchError);

    try {
      validateSettings({
        api: "orchestration",
        invocationSettings: {
          api: "foundation-models",
        },
        modelApi: undefined,
        modelSettings: mockSettings({ filtering: { input: {} } }),
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ApiSwitchError);
      const error = e as ApiSwitchError;
      expect(error.message).toContain("orchestration");
      expect(error.message).toContain("foundation-models");
      expect(error.conflictingFeature).toBe("filtering");
    }
  });

  it("should not throw when modelApi is undefined and invocation explicitly sets orchestration (no API switch)", () => {
    expect(() => {
      validateSettings({
        api: "orchestration", // effective API after resolution (invocation takes precedence)
        invocationSettings: {
          api: "orchestration", // user explicitly uses orchestration
        },
        modelApi: undefined, // default - treated as "orchestration"
        modelSettings: mockSettings({ filtering: { input: {} } }), // orchestration-only feature is fine
      });
    }).not.toThrow();
  });

  it("should validate invocation-level escapeTemplatePlaceholders", () => {
    expect(() => {
      validateSettings({
        api: "foundation-models",
        invocationSettings: {
          escapeTemplatePlaceholders: true,
        },
      });
    }).toThrow(UnsupportedFeatureError);
  });

  it("should validate model-level escapeTemplatePlaceholders", () => {
    expect(() => {
      validateSettings({
        api: "foundation-models",
        modelSettings: mockSettings({ escapeTemplatePlaceholders: true }),
      });
    }).toThrow(UnsupportedFeatureError);
  });

  it("should validate API input values", () => {
    expect(() => {
      validateSettings({
        api: "invalid" as "orchestration",
      });
    }).toThrow(/Invalid API type/);
  });

  it("should validate invocation API input values", () => {
    expect(() => {
      validateSettings({
        api: "orchestration",
        invocationSettings: {
          api: "invalid" as "orchestration",
        },
      });
    }).toThrow(/Invalid API type/);
  });
});

describe("getEffectiveEscapeTemplatePlaceholders", () => {
  describe("with Foundation Models API", () => {
    it("should always return false regardless of settings", () => {
      expect(
        getEffectiveEscapeTemplatePlaceholders("foundation-models", undefined, undefined),
      ).toBe(false);
      expect(getEffectiveEscapeTemplatePlaceholders("foundation-models", undefined, true)).toBe(
        false,
      );
      expect(
        getEffectiveEscapeTemplatePlaceholders(
          "foundation-models",
          mockSettings({ escapeTemplatePlaceholders: true }),
          undefined,
        ),
      ).toBe(false);
    });
  });

  describe("with Orchestration API", () => {
    it("should use invocation value when provided", () => {
      expect(getEffectiveEscapeTemplatePlaceholders("orchestration", undefined, true)).toBe(true);
      expect(getEffectiveEscapeTemplatePlaceholders("orchestration", undefined, false)).toBe(false);
      // Invocation overrides model
      expect(
        getEffectiveEscapeTemplatePlaceholders(
          "orchestration",
          mockSettings({ escapeTemplatePlaceholders: true }),
          false,
        ),
      ).toBe(false);
    });

    it("should use model value when invocation not provided", () => {
      expect(
        getEffectiveEscapeTemplatePlaceholders(
          "orchestration",
          mockSettings({ escapeTemplatePlaceholders: false }),
          undefined,
        ),
      ).toBe(false);
      expect(
        getEffectiveEscapeTemplatePlaceholders(
          "orchestration",
          mockSettings({ escapeTemplatePlaceholders: true }),
          undefined,
        ),
      ).toBe(true);
    });

    it("should default to true when neither provided", () => {
      expect(getEffectiveEscapeTemplatePlaceholders("orchestration", undefined, undefined)).toBe(
        true,
      );
      expect(
        getEffectiveEscapeTemplatePlaceholders("orchestration", mockSettings({}), undefined),
      ).toBe(true);
    });
  });
});
