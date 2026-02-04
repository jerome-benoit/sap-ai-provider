/** Deep merge utility with prototype pollution protection. */

/**
 * @internal
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * @internal
 */
const MAX_DEPTH = 100;

/**
 * Deep merges multiple objects recursively with prototype pollution protection.
 * @param sources - Objects to merge.
 * @returns Merged object.
 */
export function deepMerge<T extends Record<string, unknown>>(
  ...sources: (Partial<T> | undefined)[]
): T {
  return mergeInternal(sources as Record<string, unknown>[]) as T;
}

/**
 * Deep merges two objects with better type inference for common cases.
 * @param target - Target object.
 * @param source - Source object.
 * @returns Merged object.
 */
export function deepMergeTwo<T extends Record<string, unknown>>(
  target: T | undefined,
  source: Partial<T> | undefined,
): T {
  return deepMerge(target, source);
}

/**
 * @param obj - Object to clone.
 * @param seen - Set of seen objects for circular reference detection.
 * @param depth - Current recursion depth.
 * @returns Cloned object.
 * @internal
 */
function cloneDeep(
  obj: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) {
    throw new Error("Maximum merge depth exceeded");
  }
  if (seen.has(obj)) {
    throw new Error("Circular reference detected during deep merge");
  }
  seen.add(obj);

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!isSafeKey(key)) continue;
    const value = obj[key];
    result[key] = isPlainObject(value) ? cloneDeep(value, seen, depth + 1) : value;
  }
  return result;
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
 * @param key - Key to check.
 * @returns True if key is safe from prototype pollution.
 * @internal
 */
function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

/**
 * @param sources - Objects to merge.
 * @returns Merged object.
 * @internal
 */
function mergeInternal(sources: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  for (const source of sources) {
    if (source == null) continue;
    result = mergeTwo(result, source, new WeakSet(), 0);
  }
  return result;
}

/**
 * @param target - Target object.
 * @param source - Source object.
 * @param seen - Set of seen objects for circular reference detection.
 * @param depth - Current recursion depth.
 * @returns Merged object.
 * @internal
 */
function mergeTwo(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) {
    throw new Error("Maximum merge depth exceeded");
  }
  if (seen.has(source)) {
    throw new Error("Circular reference detected during deep merge");
  }
  seen.add(source);

  for (const key of Object.keys(source)) {
    if (!isSafeKey(key)) continue;

    const sourceValue = source[key];
    const targetValue = target[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      target[key] = mergeTwo({ ...targetValue }, sourceValue, seen, depth + 1);
    } else if (isPlainObject(sourceValue)) {
      target[key] = cloneDeep(sourceValue, seen, depth + 1);
    } else {
      target[key] = sourceValue;
    }
  }
  return target;
}
