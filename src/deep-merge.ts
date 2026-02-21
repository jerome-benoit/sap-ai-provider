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
  let result: Record<string, unknown> = {};
  for (const source of sources) {
    if (source == null) continue;
    result = mergeTwo(result, source, new Set(), 0);
  }
  return result as T;
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
 * Deep clones an object with circular reference detection.
 * Uses ancestor tracking: adds object before recursing, removes after.
 * @param obj - Object to clone.
 * @param ancestors - Set of ancestor objects in the current recursion path.
 * @param depth - Current recursion depth.
 * @returns Cloned object.
 * @throws {Error} When maximum merge depth (100) is exceeded.
 * @throws {Error} When circular reference is detected.
 * @internal
 */
function cloneDeep(
  obj: Record<string, unknown>,
  ancestors: Set<object>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) {
    throw new Error("Maximum merge depth exceeded");
  }
  if (ancestors.has(obj)) {
    throw new Error("Circular reference detected during deep merge");
  }

  ancestors.add(obj);

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!isSafeKey(key)) continue;
    const value = obj[key];
    result[key] = isPlainObject(value) ? cloneDeep(value, ancestors, depth + 1) : value;
  }

  ancestors.delete(obj);
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
 * Merges two objects with circular reference detection.
 * Uses ancestor tracking: adds source before recursing, removes after.
 * @param target - Target object.
 * @param source - Source object.
 * @param ancestors - Set of ancestor objects in the current recursion path.
 * @param depth - Current recursion depth.
 * @returns Merged object.
 * @throws {Error} When maximum merge depth (100) is exceeded.
 * @throws {Error} When circular reference is detected.
 * @internal
 */
function mergeTwo(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  ancestors: Set<object>,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) {
    throw new Error("Maximum merge depth exceeded");
  }
  if (ancestors.has(source)) {
    throw new Error("Circular reference detected during deep merge");
  }

  ancestors.add(source);

  for (const key of Object.keys(source)) {
    if (!isSafeKey(key)) continue;

    const sourceValue = source[key];
    const targetValue = target[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      const cloned = cloneDeep(targetValue, new Set(), depth + 1);
      target[key] = mergeTwo(cloned, sourceValue, ancestors, depth + 1);
    } else if (isPlainObject(sourceValue)) {
      target[key] = cloneDeep(sourceValue, new Set(), depth + 1);
    } else {
      target[key] = sourceValue;
    }
  }

  ancestors.delete(source);
  return target;
}
