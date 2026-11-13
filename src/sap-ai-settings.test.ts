/** Unit tests for re-exported SAP AI SDK orchestration helpers. */

import { describe, expect, it } from "vitest";

import type { FilteringModule } from "./sap-ai-settings.js";

import * as v2Exports from "./index-v2.js";
import { buildGraniteGuardian41Filter } from "./sap-ai-settings.js";

describe("buildGraniteGuardian41Filter", () => {
  it("builds a granite_guardian_4_1 filter accepted by the filtering contract", () => {
    const filtering: FilteringModule = {
      input: { filters: [buildGraniteGuardian41Filter(["harm"])] },
    };

    expect(filtering.input?.filters[0]).toEqual({
      config: { categories: { harm: true } },
      type: "granite_guardian_4_1",
    });
  });

  it("enables every requested category and forwards filter options", () => {
    expect(buildGraniteGuardian41Filter(["harm", "jailbreak"], { enable_reasoning: true })).toEqual(
      {
        config: { categories: { harm: true, jailbreak: true }, enable_reasoning: true },
        type: "granite_guardian_4_1",
      },
    );
  });

  it("is re-exported by the V2 entrypoint", () => {
    expect(v2Exports.buildGraniteGuardian41Filter).toBe(buildGraniteGuardian41Filter);
  });
});
