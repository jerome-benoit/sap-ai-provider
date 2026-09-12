/**
 * Unit tests for deep merge utility.
 *
 * Tests recursive object merging, array replacement, special type handling,
 * prototype pollution protection, and circular reference detection.
 */

import { describe, expect, it } from "vitest";

import { deepMerge } from "./deep-merge";

describe("deepMerge", () => {
  describe("basic merging", () => {
    it("should merge two flat objects", () => {
      const result = deepMerge<Record<string, number>>({ a: 1, b: 2 }, { b: 3, c: 4 });
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

    it("should isolate mutations of merged nested objects from every source", () => {
      const target = { config: { nested: { value: 1 } } };
      const source = { config: { nested: { extra: 2 } } };
      const result = deepMerge<Record<string, unknown>>(target, source);
      ((result.config as Record<string, unknown>).nested as Record<string, unknown>).value = 3;
      expect(target.config.nested.value).toBe(1);
      expect(source.config.nested).toEqual({ extra: 2 });
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

    it("should copy only own enumerable properties", () => {
      const source = Object.create({ inherited: "ignored" }) as Record<string, unknown>;
      source.own = "kept";
      expect(deepMerge(source)).toEqual({ own: "kept" });
    });
  });

  describe("security", () => {
    it("should preserve special data keys without changing any object prototype", () => {
      const source = JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
      ) as Record<string, unknown>;
      const result = deepMerge<Record<string, unknown>>(source, {
        constructor: { prototype: { extra: true } },
      });
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.hasOwn(result, "__proto__")).toBe(true);
      expect(result.__proto__).toEqual({ polluted: true });
      expect(result.constructor).toEqual({ prototype: { extra: true, polluted: true } });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(source.constructor).toEqual({ prototype: { polluted: true } });
    });

    it("should retain required JSON Schema properties named constructor and prototype", () => {
      const schema = {
        properties: { constructor: { type: "string" }, prototype: { type: "number" } },
        required: ["constructor", "prototype"],
      };
      const result = deepMerge({ responseFormat: { schema } });
      expect(result.responseFormat.schema).toEqual(schema);
      expect(Object.keys(result.responseFormat.schema.properties)).toEqual(schema.required);
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
        expect(result).toEqual(deepObj);
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
  });
});
