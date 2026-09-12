/** Plain-object merge utility with own-property copying. */

/** @internal */
const MAX_DEPTH = 100;

/**
 * Recursively merges and copies plain objects without traversing inherited properties.
 * All string keys are preserved as own data properties, including JSON Schema names
 * such as `constructor` and `__proto__`, without changing object prototypes.
 * Arrays and other non-plain values replace earlier values by reference; their
 * contents are not traversed. Undefined sources are skipped, but an explicit
 * undefined property value replaces the earlier property value.
 * @param sources - Objects to merge.
 * @returns Merged object.
 * @throws {Error} When traversed plain objects contain a cycle or exceed the depth limit.
 */
export function deepMerge<T extends Record<string, unknown>>(
  ...sources: (Partial<T> | undefined)[]
): T {
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    if (source != null) mergeInto(result, source, new Set(), 0);
  }
  return result as T;
}

/**
 * @param value - Value to check.
 * @returns True if value is a plain object.
 * @internal
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Merges a source into an owned accumulator with ancestor-based cycle detection.
 * @param target - Private accumulator, never a caller-owned object.
 * @param source - Source object.
 * @param ancestors - Objects in the current recursion path.
 * @param depth - Current recursion depth.
 * @returns The accumulator.
 * @internal
 */
function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  ancestors: Set<object>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) throw new Error("Maximum merge depth exceeded");
  if (ancestors.has(source)) throw new Error("Circular reference detected during deep merge");
  ancestors.add(source);

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = Object.hasOwn(target, key) ? target[key] : undefined;
    const value = isPlainObject(sourceValue)
      ? mergeInto(isPlainObject(targetValue) ? targetValue : {}, sourceValue, ancestors, depth + 1)
      : sourceValue;

    // Define data properties instead of invoking inherited setters such as __proto__.
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  ancestors.delete(source);
  return target;
}
