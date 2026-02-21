/**
 * Unit tests for deep merge utility.
 *
 * Tests recursive object merging, array replacement, special type handling,
 * prototype pollution protection, and circular reference detection.
 */

import { describe, expect, it } from "vitest";

import { deepMerge, deepMergeTwo } from "./deep-merge";

describe("deepMerge", () => {
  describe("basic merging", () => {
    it("should merge two flat objects", () => {
      const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 } as Record<string, unknown>);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("should merge multiple objects", () => {
      const result = deepMerge<Record<string, unknown>>({ a: 1 }, { b: 2 }, { c: 3 });
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("should return empty object when no sources provided", () => {
      const result = deepMerge();
      expect(result).toEqual({});
    });

    it("should handle undefined sources", () => {
      const result = deepMerge<Record<string, unknown>>({ a: 1 }, undefined, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("should handle null sources", () => {
      const result = deepMerge<Record<string, unknown>>({ a: 1 }, null as never, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe("nested object merging", () => {
    it("should deeply merge nested objects", () => {
      const result = deepMerge<Record<string, unknown>>(
        { a: { b: 1, c: 2 }, d: 3 },
        { a: { c: 3, e: 4 }, f: 5 },
      );
      expect(result).toEqual({
        a: { b: 1, c: 3, e: 4 },
        d: 3,
        f: 5,
      });
    });

    it("should merge deeply nested objects", () => {
      const result = deepMerge<Record<string, unknown>>(
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { e: 2 } } } },
      );
      expect(result).toEqual({
        a: { b: { c: { d: 1, e: 2 } } },
      });
    });

    it("should handle mixed nested and flat properties", () => {
      const result = deepMerge<Record<string, unknown>>(
        { a: 1, b: { c: 2 } },
        { a: 2, b: { d: 3 }, e: 4 },
      );
      expect(result).toEqual({
        a: 2,
        b: { c: 2, d: 3 },
        e: 4,
      });
    });

    it("should preserve nested objects from first source if not overridden", () => {
      const result = deepMerge<Record<string, unknown>>({ a: { b: { c: 1 } }, d: 2 }, { d: 3 });
      expect(result).toEqual({
        a: { b: { c: 1 } },
        d: 3,
      });
    });
  });

  describe("array handling", () => {
    it("should replace arrays, not merge them", () => {
      const result = deepMerge<Record<string, unknown>>({ arr: [1, 2, 3] }, { arr: [4, 5] });
      expect(result).toEqual({ arr: [4, 5] });
    });

    it("should handle arrays in nested objects", () => {
      const result = deepMerge<Record<string, unknown>>(
        { a: { arr: [1, 2] } },
        { a: { arr: [3, 4, 5] } },
      );
      expect(result).toEqual({
        a: { arr: [3, 4, 5] },
      });
    });

    it("should handle empty arrays", () => {
      const result = deepMerge<Record<string, unknown>>({ arr: [1, 2, 3] }, { arr: [] });
      expect(result).toEqual({ arr: [] });
    });
  });

  describe("primitive value handling", () => {
    it.each([
      { expected: null, original: 1, override: null, type: "null" },
      { expected: undefined, original: 1, override: undefined, type: "undefined" },
      { expected: false, original: true, override: false, type: "boolean (false)" },
      { expected: true, original: false, override: true, type: "boolean (true)" },
      { expected: "world", original: "hello", override: "world", type: "string" },
      { expected: 100, original: 42, override: 100, type: "number" },
      { expected: 0, original: 1, override: 0, type: "zero" },
      { expected: "", original: "hello", override: "", type: "empty string" },
    ])("should override with $type", ({ expected, original, override }) => {
      const result = deepMerge<Record<string, unknown>>({ a: original }, { a: override });
      expect(result).toEqual({ a: expected });
    });
  });

  describe("special object types", () => {
    it.each([
      { factory: () => [new Date("2024-01-01"), new Date("2024-12-31")], type: "Date" },
      { factory: () => [/foo/, /bar/], type: "RegExp" },
      { factory: () => [new Map([["a", 1]]), new Map([["b", 2]])], type: "Map" },
      { factory: () => [new Set([1, 2]), new Set([3, 4])], type: "Set" },
      {
        factory: () => [() => "first", () => "second"],
        type: "Function",
      },
    ])("should replace $type objects (not merge)", ({ factory }) => {
      const [obj1, obj2] = factory();
      const result = deepMerge<Record<string, unknown>>({ value: obj1 }, { value: obj2 });
      expect(result.value).toBe(obj2);
    });

    it("should preserve Symbol values (not as keys)", () => {
      const sym1 = Symbol("first");
      const sym2 = Symbol("second");
      const result = deepMerge<Record<string, unknown>>({ value: sym1 }, { value: sym2 });
      expect(result.value).toBe(sym2);
    });
  });

  describe("immutability", () => {
    it("should not mutate source objects", () => {
      const source1 = { a: { b: 1 } };
      const source2 = { a: { c: 2 } };

      deepMerge<Record<string, unknown>>(source1, source2);

      expect(source1).toEqual({ a: { b: 1 } });
      expect(source2).toEqual({ a: { c: 2 } });
    });

    it("should create new nested objects", () => {
      const source1 = { a: { b: 1 } };
      const result = deepMerge<Record<string, unknown>>(source1, { a: { c: 2 } });

      expect(result.a).not.toBe(source1.a);
    });

    describe("deep cloning during nested merge (regression tests)", () => {
      it("should not mutate deeply nested target objects when merging", () => {
        const target = { a: { b: { c: { original: true } } } };
        const source = { a: { b: { c: { added: true } } } };
        const originalC = target.a.b.c;

        deepMerge<Record<string, unknown>>(target, source);

        // Original nested object should be unchanged
        expect(originalC).toEqual({ original: true });
        expect(target.a.b.c).toEqual({ original: true });
      });

      it("should deeply clone target nested objects (not shallow copy)", () => {
        const deepNested = { level3: { value: 1 } };
        const target = { a: { b: deepNested } };
        const source = { a: { b: { level3: { extra: 2 } } } };

        const result = deepMerge<Record<string, unknown>>(target, source);

        // Result should have merged values
        expect(result).toEqual({ a: { b: { level3: { extra: 2, value: 1 } } } });
        // Original deep nested object should be unchanged
        expect(deepNested).toEqual({ level3: { value: 1 } });
        // Result should not reference original nested object
        expect((result.a as Record<string, unknown>).b).not.toBe(deepNested);
      });

      it("should preserve target immutability across multiple merge levels", () => {
        const level2 = { c: { d: 1 } };
        const level1 = { b: level2 };
        const target = { a: level1 };
        const source = { a: { b: { c: { e: 2 } } } };

        const result = deepMerge<Record<string, unknown>>(target, source);

        // All original nested objects should be unchanged
        expect(level2).toEqual({ c: { d: 1 } });
        expect(level1).toEqual({ b: { c: { d: 1 } } });
        expect(target).toEqual({ a: { b: { c: { d: 1 } } } });
        // Result should have merged values
        expect(result).toEqual({ a: { b: { c: { d: 1, e: 2 } } } });
      });

      it("should handle mutation attempts on result without affecting sources", () => {
        const target = { config: { nested: { value: 1 } } };
        const source = { config: { nested: { extra: 2 } } };

        const result = deepMerge<Record<string, unknown>>(target, source);

        // Mutate the result
        (result.config as Record<string, unknown>).mutated = true;
        ((result.config as Record<string, unknown>).nested as Record<string, unknown>).changed =
          true;

        // Sources should remain unchanged
        expect(target).toEqual({ config: { nested: { value: 1 } } });
        expect(source).toEqual({ config: { nested: { extra: 2 } } });
      });
    });
  });

  describe("edge cases", () => {
    it("should handle objects with null prototype", () => {
      const obj = Object.create(null) as Record<string, unknown>;
      obj.a = 1;

      const result = deepMerge<Record<string, unknown>>(obj, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("should handle objects with numeric keys", () => {
      const result = deepMerge<Record<string, unknown>>(
        { "0": "a", "1": "b" },
        { "1": "c", "2": "d" },
      );
      expect(result).toEqual({ "0": "a", "1": "c", "2": "d" });
    });

    it("should ignore symbol keys (only string keys are processed)", () => {
      const sym1 = Symbol("test1");
      const sym2 = Symbol("test2");

      const result = deepMerge<Record<string | symbol, unknown>>(
        { [sym1]: "value1" },
        { [sym2]: "value2" },
      );

      expect(result[sym1]).toBeUndefined();
      expect(result[sym2]).toBeUndefined();
    });

    it("should handle class instances with inherited properties", () => {
      class Base {
        inherited = "base";
      }
      class Extended extends Base {
        own = "extended";
      }

      const obj = new Extended();
      const result = deepMerge<Record<string, unknown>>(obj as unknown as Record<string, unknown>, {
        other: "value",
      });

      expect(result.other).toBe("value");
      expect(result.own).toBe("extended");
      expect(result.inherited).toBe("base");
    });
  });

  describe("security", () => {
    describe("prototype pollution protection", () => {
      it.each([
        { description: "proto", key: "__proto__" },
        { description: "constructor", key: "constructor" },
        { description: "prototype", key: "prototype" },
      ])("should skip $description key to prevent prototype pollution", ({ key }) => {
        const malicious = { [key]: { polluted: true } };
        const result = deepMerge<Record<string, unknown>>({}, malicious);

        expect(result).toEqual({});
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });

      it("should handle nested __proto__ attempts", () => {
        const malicious = JSON.parse('{"a": {"__proto__": {"polluted": true}}}') as Record<
          string,
          unknown
        >;
        const result = deepMerge<Record<string, unknown>>({ a: { safe: true } }, malicious);

        expect(result).toEqual({ a: { safe: true } });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });

      it.each([
        { json: '{"safe": "value", "__proto__": {"polluted": true}}', key: "__proto__" },
        { json: '{"safe": "value", "constructor": {"polluted": true}}', key: "constructor" },
      ])("should skip $key when cloning source-only plain objects", ({ json }) => {
        const malicious = {
          newKey: JSON.parse(json) as Record<string, unknown>,
        };
        const result = deepMerge<Record<string, unknown>>({}, malicious);

        expect(result.newKey).toEqual({ safe: "value" });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });

    describe("circular reference detection", () => {
      it("should throw error on circular reference", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;

        expect(() => deepMerge<Record<string, unknown>>({}, obj)).toThrow(
          "Circular reference detected during deep merge",
        );
      });

      it("should throw error on deeply nested circular reference", () => {
        const obj: Record<string, unknown> = { a: { b: { c: {} } } };
        (obj.a as Record<string, unknown>).b = obj;

        expect(() => deepMerge<Record<string, unknown>>({}, obj)).toThrow(
          "Circular reference detected during deep merge",
        );
      });

      it("should allow same object in different sources", () => {
        const shared = { value: 1 };
        const result = deepMerge<Record<string, unknown>>({ a: shared }, { b: shared });

        expect(result).toEqual({ a: { value: 1 }, b: { value: 1 } });
      });
    });

    describe("shared object handling (regression tests)", () => {
      it("should handle same object in both target and source at same key", () => {
        const shared = { nested: { value: 1 } };
        const target = { config: shared };
        const source = { config: shared, extra: "new" };

        const result = deepMerge<Record<string, unknown>>(target, source);

        expect(result).toEqual({
          config: { nested: { value: 1 } },
          extra: "new",
        });
      });

      it("should handle diamond pattern (same object referenced multiple times)", () => {
        const shared = { id: 42 };
        const source = {
          left: { ref: shared },
          right: { ref: shared },
        };

        const result = deepMerge<Record<string, unknown>>({}, source);

        expect(result).toEqual({
          left: { ref: { id: 42 } },
          right: { ref: { id: 42 } },
        });
        // Verify deep cloning (not same reference)
        expect(result.left).not.toBe(result.right);
      });

      it("should handle object appearing in target then reappearing in source", () => {
        const shared = { data: "shared" };
        const target = { a: shared, b: { nested: shared } };
        const source = { c: shared };

        const result = deepMerge<Record<string, unknown>>(target, source);

        expect(result).toEqual({
          a: { data: "shared" },
          b: { nested: { data: "shared" } },
          c: { data: "shared" },
        });
      });

      it("should handle deeply nested shared objects", () => {
        const shared = { deep: { value: 1 } };
        const target = { level1: { level2: { shared } } };
        const source = { level1: { level2: { extra: true, shared } } };

        const result = deepMerge<Record<string, unknown>>(target, source);

        expect(result).toEqual({
          level1: { level2: { extra: true, shared: { deep: { value: 1 } } } },
        });
      });

      it("should still detect actual circular references after processing shared objects", () => {
        const shared = { value: 1 };
        const circular: Record<string, unknown> = { shared };
        circular.self = circular; // Actual circular reference

        // First merge with shared object succeeds
        expect(() =>
          deepMerge<Record<string, unknown>>({ a: shared }, { b: shared }),
        ).not.toThrow();

        // Then circular reference is still detected
        expect(() => deepMerge<Record<string, unknown>>({}, circular)).toThrow(
          "Circular reference detected during deep merge",
        );
      });
    });

    describe("depth limit protection", () => {
      it("should throw error when max depth exceeded", () => {
        let deepObj: Record<string, unknown> = { value: "deep" };
        for (let i = 0; i < 150; i++) {
          deepObj = { nested: deepObj };
        }

        expect(() => deepMerge<Record<string, unknown>>({}, deepObj)).toThrow(
          "Maximum merge depth exceeded",
        );
      });

      it("should handle objects within depth limit", () => {
        let deepObj: Record<string, unknown> = { value: "deep" };
        for (let i = 0; i < 50; i++) {
          deepObj = { nested: deepObj };
        }

        const result = deepMerge<Record<string, unknown>>({}, deepObj);
        expect(result).toHaveProperty("nested");
      });
    });
  });

  describe("real-world scenarios", () => {
    it("should merge modelParams from settings and providerOptions", () => {
      const settings = {
        modelParams: {
          customParam: "from-settings",
          nested: { a: 1, b: 2 },
          temperature: 0.3,
        },
      };

      const providerOptions = {
        modelParams: {
          customParam: "from-provider",
          nested: { b: 3, c: 4 },
        },
      };

      const result = deepMerge<Record<string, unknown>>(settings, providerOptions);

      expect(result.modelParams).toEqual({
        customParam: "from-provider",
        nested: { a: 1, b: 3, c: 4 },
        temperature: 0.3,
      });
    });

    it("should merge three levels: defaults + settings + providerOptions", () => {
      const defaults = {
        modelParams: { maxTokens: 1000, temperature: 0.5 },
      };

      const settings = {
        modelParams: { customField: "custom", temperature: 0.7 },
      };

      const providerOptions = {
        modelParams: { customField: "override" },
      };

      const result = deepMerge<Record<string, unknown>>(defaults, settings, providerOptions);

      expect(result.modelParams).toEqual({
        customField: "override",
        maxTokens: 1000,
        temperature: 0.7,
      });
    });

    it("should handle complex nested configuration", () => {
      const base = {
        modelParams: {
          config: {
            advanced: { option1: true, option2: false },
            basic: { timeout: 1000 },
          },
          simple: "value",
        },
      };

      const override = {
        modelParams: {
          config: {
            advanced: { option2: true, option3: true },
          },
          newParam: 42,
        },
      };

      const result = deepMerge<Record<string, unknown>>(base, override);

      expect(result.modelParams).toEqual({
        config: {
          advanced: { option1: true, option2: true, option3: true },
          basic: { timeout: 1000 },
        },
        newParam: 42,
        simple: "value",
      });
    });
  });
});

describe("deepMergeTwo", () => {
  // Note: deepMergeTwo is a convenience wrapper around deepMerge.
  // Core merge behavior (nested, arrays, security, immutability) is tested in deepMerge tests.
  // These tests focus on the two-argument API and undefined handling.

  it("should merge two objects with deep merge behavior", () => {
    const result = deepMergeTwo<Record<string, unknown>>({ a: { b: 1 } }, { a: { c: 2 } });
    expect(result).toEqual({ a: { b: 1, c: 2 } });
  });

  it("should handle undefined target", () => {
    const result = deepMergeTwo<Record<string, unknown>>(undefined, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });

  it("should handle undefined source", () => {
    const result = deepMergeTwo<Record<string, unknown>>({ a: 1 }, undefined);
    expect(result).toEqual({ a: 1 });
  });

  it("should handle both undefined", () => {
    const result = deepMergeTwo(undefined, undefined);
    expect(result).toEqual({});
  });
});
