/**
 * Tests for SAP AI API validation functions.
 */
import { describe, expect, it } from "vitest";

import type { SAPAIEmbeddingSettings, SAPAIModelSettings } from "./sap-ai-settings";

import { ApiSwitchError, UnsupportedFeatureError } from "./sap-ai-error";
import {
  getEffectiveEscapeTemplatePlaceholders,
  resolveApi,
  validateApiInput,
  validateSettings,
} from "./sap-ai-validation";

/**
 * Helper to create mock embedding settings for testing.
 * @param partial - Partial settings object to convert.
 * @returns The mock settings cast to SAPAIEmbeddingSettings.
 */
function mockEmbeddingSettings(partial: Record<string, unknown>): SAPAIEmbeddingSettings {
  return partial as SAPAIEmbeddingSettings;
}

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
  describe("API input validation", () => {
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

  describe("Orchestration-only model settings with Foundation Models API", () => {
    it("should pass with undefined settings", () => {
      expect(() => {
        validateSettings({ api: "foundation-models" });
      }).not.toThrow();
    });

    it("should pass with empty settings", () => {
      expect(() => {
        validateSettings({ api: "foundation-models", modelSettings: mockSettings({}) });
      }).not.toThrow();
    });

    it("should pass with Foundation Models settings (no Orch-only options)", () => {
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

    it("should throw UnsupportedFeatureError for filtering", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({ filtering: { input: {} } }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({ filtering: { input: {} } }),
        });
      }).toThrow(/Content filtering.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for grounding", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            grounding: { config: {}, type: "document_grounding_service" },
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            grounding: { config: {}, type: "document_grounding_service" },
          }),
        });
      }).toThrow(/Document grounding.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for masking", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({ masking: { masking_providers: [] } }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({ masking: { masking_providers: [] } }),
        });
      }).toThrow(/Data masking.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for translation", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            translation: { input: { config: {}, type: "sap_document_translation" } },
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            translation: { input: { config: {}, type: "sap_document_translation" } },
          }),
        });
      }).toThrow(/Translation.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for tools", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            tools: [{ function: { name: "test", parameters: {} }, type: "function" }],
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            tools: [{ function: { name: "test", parameters: {} }, type: "function" }],
          }),
        });
      }).toThrow(/SAP-format tool definitions.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for orchestrationConfigRef", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            orchestrationConfigRef: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            orchestrationConfigRef: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
          }),
        });
      }).toThrow(/orchestrationConfigRef.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for placeholderValues", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({ placeholderValues: { key: "value" } }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({ placeholderValues: { key: "value" } }),
        });
      }).toThrow(/placeholderValues.*will be ignored by Foundation Models API/);
    });

    it("should throw UnsupportedFeatureError for promptTemplateRef", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            promptTemplateRef: { id: "template-id", scope: "global" },
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            promptTemplateRef: { id: "template-id", scope: "global" },
          }),
        });
      }).toThrow(/promptTemplateRef.*will be ignored by Foundation Models API/);
    });

    it("should check features in order (filtering first)", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          modelSettings: mockSettings({
            filtering: { input: {} },
            grounding: { type: "document_grounding_service" },
          }),
        });
      }).toThrow(/Content filtering/);
    });
  });

  describe("Orchestration-only invocation settings with Foundation Models API", () => {
    it("should throw UnsupportedFeatureError for orchestrationConfigRef", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          invocationSettings: {
            orchestrationConfigRef: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
          },
        });
      }).toThrow(UnsupportedFeatureError);
    });

    it("should throw UnsupportedFeatureError for placeholderValues", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          invocationSettings: {
            placeholderValues: { key: "value" },
          },
        });
      }).toThrow(UnsupportedFeatureError);
    });

    it("should throw UnsupportedFeatureError for promptTemplateRef", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          invocationSettings: {
            promptTemplateRef: { id: "template-id", scope: "global" },
          },
        });
      }).toThrow(UnsupportedFeatureError);
    });

    it("should allow orchestration-only invocation options with Orchestration API", () => {
      expect(() => {
        validateSettings({
          api: "orchestration",
          invocationSettings: {
            orchestrationConfigRef: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
            placeholderValues: { key: "value" },
            promptTemplateRef: { id: "template-id", scope: "global" },
          },
        });
      }).not.toThrow();
    });
  });

  describe("Orchestration-only embedding settings with Foundation Models API", () => {
    it("should pass with undefined embedding settings", () => {
      expect(() => {
        validateSettings({ api: "foundation-models" });
      }).not.toThrow();
    });

    it("should pass with empty embedding settings", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          embeddingSettings: mockEmbeddingSettings({}),
        });
      }).not.toThrow();
    });

    it("should pass with embedding settings that do not include masking", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          embeddingSettings: mockEmbeddingSettings({
            api: "foundation-models",
            modelParams: { dimensions: 256 },
            modelVersion: "2024-05-13",
          }),
        });
      }).not.toThrow();
    });

    it("should throw UnsupportedFeatureError for masking", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          embeddingSettings: mockEmbeddingSettings({
            masking: { masking_providers: [] },
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "foundation-models",
          embeddingSettings: mockEmbeddingSettings({
            masking: { masking_providers: [] },
          }),
        });
      }).toThrow(/Data masking.*will be ignored by Foundation Models API/);
    });

    it("should throw with masking configuration with providers", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          embeddingSettings: mockEmbeddingSettings({
            masking: {
              masking_providers: [
                {
                  entities: [{ type: "profile-email" }],
                  method: "anonymization",
                  type: "sap_data_privacy_integration",
                },
              ],
            },
          }),
        });
      }).toThrow(/Data masking.*will be ignored by Foundation Models API/);
    });

    it("should allow embedding masking with Orchestration API", () => {
      expect(() => {
        validateSettings({
          api: "orchestration",
          embeddingSettings: mockEmbeddingSettings({
            masking: { masking_providers: [] },
          }),
        });
      }).not.toThrow();
    });
  });

  describe("Foundation Models-only options with Orchestration API", () => {
    it("should pass with undefined settings", () => {
      expect(() => {
        validateSettings({ api: "orchestration" });
      }).not.toThrow();
    });

    it("should pass with empty settings", () => {
      expect(() => {
        validateSettings({ api: "orchestration", modelSettings: mockSettings({}) });
      }).not.toThrow();
    });

    it("should pass with Orchestration settings (no FM-only options)", () => {
      expect(() => {
        validateSettings({
          api: "orchestration",
          modelSettings: mockSettings({
            api: "orchestration",
            filtering: { input: {} },
            includeReasoning: true,
          }),
        });
      }).not.toThrow();
    });

    it("should throw UnsupportedFeatureError for dataSources", () => {
      expect(() => {
        validateSettings({
          api: "orchestration",
          modelSettings: mockSettings({
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
          }),
        });
      }).toThrow(UnsupportedFeatureError);
      expect(() => {
        validateSettings({
          api: "orchestration",
          modelSettings: mockSettings({
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
          }),
        });
      }).toThrow(/Azure On Your Data \(dataSources\).*will be ignored by Orchestration API/);
    });

    it("should throw with empty dataSources array (still !== undefined)", () => {
      expect(() => {
        validateSettings({
          api: "orchestration",
          modelSettings: mockSettings({
            api: "foundation-models",
            dataSources: [],
          }),
        });
      }).toThrow(UnsupportedFeatureError);
    });
  });

  describe("escapeTemplatePlaceholders validation", () => {
    describe("with Foundation Models API", () => {
      it("should throw when escapeTemplatePlaceholders=true at invocation level", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: {
              escapeTemplatePlaceholders: true,
            },
          });
        }).toThrow(UnsupportedFeatureError);
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: {
              escapeTemplatePlaceholders: true,
            },
          });
        }).toThrow(/escapeTemplatePlaceholders.*will be ignored by Foundation Models API/);
      });

      it("should throw when escapeTemplatePlaceholders=true at model level", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            modelSettings: mockSettings({ escapeTemplatePlaceholders: true }),
          });
        }).toThrow(UnsupportedFeatureError);
      });

      it("should pass when escapeTemplatePlaceholders=false at invocation level", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: {
              escapeTemplatePlaceholders: false,
            },
          });
        }).not.toThrow();
      });

      it("should pass when escapeTemplatePlaceholders=undefined", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: {},
          });
        }).not.toThrow();
      });
    });

    describe("with Orchestration API", () => {
      it("should pass when escapeTemplatePlaceholders=true", () => {
        expect(() => {
          validateSettings({
            api: "orchestration",
            invocationSettings: {
              escapeTemplatePlaceholders: true,
            },
          });
        }).not.toThrow();
      });

      it("should pass when escapeTemplatePlaceholders=false", () => {
        expect(() => {
          validateSettings({
            api: "orchestration",
            invocationSettings: {
              escapeTemplatePlaceholders: false,
            },
          });
        }).not.toThrow();
      });

      it("should pass when escapeTemplatePlaceholders=undefined", () => {
        expect(() => {
          validateSettings({
            api: "orchestration",
            invocationSettings: {},
          });
        }).not.toThrow();
      });
    });
  });

  describe("API switching validation", () => {
    it("should pass when APIs are the same (no switch)", () => {
      expect(() => {
        validateSettings({
          api: "orchestration",
          invocationSettings: { api: "orchestration" },
          modelApi: "orchestration",
          modelSettings: mockSettings({ filtering: { input: {} } }),
        });
      }).not.toThrow();
    });

    it("should pass when switching with no conflicting features", () => {
      expect(() => {
        validateSettings({
          api: "foundation-models",
          invocationSettings: { api: "foundation-models" },
          modelApi: "orchestration",
          modelSettings: mockSettings({
            includeReasoning: true,
            modelParams: { temperature: 0.7 },
          }),
        });
      }).not.toThrow();
    });

    describe("switching from Orchestration to Foundation Models", () => {
      it("should throw ApiSwitchError for filtering", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({ filtering: { input: {} } }),
          });
        }).toThrow(ApiSwitchError);

        try {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({ filtering: { input: {} } }),
          });
        } catch (e) {
          expect(e).toBeInstanceOf(ApiSwitchError);
          const error = e as ApiSwitchError;
          expect(error.fromApi).toBe("orchestration");
          expect(error.toApi).toBe("foundation-models");
          expect(error.conflictingFeature).toBe("filtering");
        }
      });

      it("should throw ApiSwitchError for grounding", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({
              grounding: { config: {}, type: "document_grounding_service" },
            }),
          });
        }).toThrow(ApiSwitchError);
      });

      it("should throw ApiSwitchError for masking", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({ masking: { masking_providers: [] } }),
          });
        }).toThrow(ApiSwitchError);
      });

      it("should throw ApiSwitchError for translation", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({
              translation: { input: { type: "sap_document_translation" } },
            }),
          });
        }).toThrow(ApiSwitchError);
      });

      it("should throw ApiSwitchError for tools", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({
              tools: [{ function: { name: "test", parameters: {} }, type: "function" }],
            }),
          });
        }).toThrow(ApiSwitchError);
      });

      it("should throw ApiSwitchError for orchestrationConfigRef", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({
              orchestrationConfigRef: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
            }),
          });
        }).toThrow(ApiSwitchError);
      });

      it("should throw ApiSwitchError for placeholderValues", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({ placeholderValues: { key: "value" } }),
          });
        }).toThrow(ApiSwitchError);
      });

      it("should throw ApiSwitchError for promptTemplateRef", () => {
        expect(() => {
          validateSettings({
            api: "foundation-models",
            invocationSettings: { api: "foundation-models" },
            modelApi: "orchestration",
            modelSettings: mockSettings({
              promptTemplateRef: { id: "template-id", scope: "global" },
            }),
          });
        }).toThrow(ApiSwitchError);
      });
    });

    describe("switching from Foundation Models to Orchestration", () => {
      it("should throw ApiSwitchError for dataSources", () => {
        expect(() => {
          validateSettings({
            api: "orchestration",
            invocationSettings: { api: "orchestration" },
            modelApi: "foundation-models",
            modelSettings: mockSettings({
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
            }),
          });
        }).toThrow(ApiSwitchError);

        try {
          validateSettings({
            api: "orchestration",
            invocationSettings: { api: "orchestration" },
            modelApi: "foundation-models",
            modelSettings: mockSettings({
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
            }),
          });
        } catch (e) {
          expect(e).toBeInstanceOf(ApiSwitchError);
          const error = e as ApiSwitchError;
          expect(error.fromApi).toBe("foundation-models");
          expect(error.toApi).toBe("orchestration");
          expect(error.conflictingFeature).toBe("dataSources");
        }
      });

      it("should pass when FM settings have no dataSources", () => {
        expect(() => {
          validateSettings({
            api: "orchestration",
            invocationSettings: { api: "orchestration" },
            modelApi: "foundation-models",
            modelSettings: mockSettings({
              api: "foundation-models",
              includeReasoning: true,
            }),
          });
        }).not.toThrow();
      });
    });

    describe("implicit API switching (modelApi undefined)", () => {
      it("should throw ApiSwitchError when modelApi is undefined but model has orchestration features and invocation switches to foundation-models", () => {
        expect(() => {
          validateSettings({
            api: "orchestration",
            invocationSettings: { api: "foundation-models" },
            modelApi: undefined,
            modelSettings: mockSettings({ filtering: { input: {} } }),
          });
        }).toThrow(ApiSwitchError);

        try {
          validateSettings({
            api: "orchestration",
            invocationSettings: { api: "foundation-models" },
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
            api: "orchestration",
            invocationSettings: { api: "orchestration" },
            modelApi: undefined,
            modelSettings: mockSettings({ filtering: { input: {} } }),
          });
        }).not.toThrow();
      });
    });
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
