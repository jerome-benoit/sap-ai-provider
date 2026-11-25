/**
 * Freeze and deprecation gate for the standalone V2 package.
 *
 * The library performs no work on import: every registry read and every registry write is an
 * explicit call. The `check` entry is read-only and safe for continuous integration, while
 * `deprecate` writes and must be run by a maintainer with an authenticated npm CLI.
 */

/** Published name of the deprecated standalone package. */
export const STANDALONE_PACKAGE_NAME = "@jerome-benoit/sap-ai-provider-v2";

/** Last version published to the standalone package; any newer version breaks the freeze. */
export const FROZEN_VERSION = "5.1.2";

/** Registry read by the gate. */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** Message stored on every published version of the standalone package. */
export const DEPRECATION_MESSAGE = [
  `${STANDALONE_PACKAGE_NAME}@${FROZEN_VERSION} is the last release of this package.`,
  "Use the /v2 subpath of @jerome-benoit/sap-ai-provider instead: same LanguageModelV2 facade,",
  "same releases, still supported for AI SDK 5.",
  "https://github.com/jerome-benoit/sap-ai-provider/blob/main/MIGRATION_GUIDE.md",
].join(" ");

const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Abbreviated registry document, narrowed to the fields this gate reads. */
export interface PackageDocument {
  readonly versions: Record<string, PackageVersionRecord>;
}

/** Registry record of one published version, narrowed to the fields this gate reads. */
export interface PackageVersionRecord {
  readonly deprecated?: string;
}

interface ParsedVersion {
  readonly build: readonly number[];
  readonly prerelease: readonly (number | string)[];
}

/**
 * Compare two semantic versions, prerelease-aware, so `5.2.0-rc.0` sorts above `5.1.2` and below
 * `5.2.0`.
 * @param left - First version
 * @param right - Second version
 * @returns Negative, zero, or positive number following `Array.prototype.sort` conventions
 */
export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    throw new Error(`Not a semantic version: ${!parsedLeft ? left : right}`);
  }
  for (let index = 0; index < 3; index += 1) {
    const difference = (parsedLeft.build[index] ?? 0) - (parsedRight.build[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (parsedLeft.prerelease.length === 0 || parsedRight.prerelease.length === 0) {
    return parsedRight.prerelease.length - parsedLeft.prerelease.length === 0
      ? 0
      : parsedLeft.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.min(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = parsedLeft.prerelease[index];
    const b = parsedRight.prerelease[index];
    if (a === undefined || b === undefined) {
      break;
    }
    if (a === b) {
      continue;
    }
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    if (typeof a === "number") {
      return -1;
    }
    if (typeof b === "number") {
      return 1;
    }
    return a < b ? -1 : 1;
  }
  return parsedLeft.prerelease.length - parsedRight.prerelease.length;
}

/**
 * Read the abbreviated registry document of the standalone package.
 * @param name - Package name
 * @param registry - Registry base URL
 * @param fetchImpl - Fetch implementation override
 * @returns Registry document
 */
export async function fetchPackageDocument(
  name: string = STANDALONE_PACKAGE_NAME,
  registry: string = DEFAULT_REGISTRY,
  fetchImpl: typeof fetch = fetch,
): Promise<PackageDocument> {
  const encodedName = name.split("/").join("%2F");
  const response = await fetchImpl(`${registry}/${encodedName}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!response.ok) {
    throw new Error(`Registry answered ${String(response.status)} for ${name}`);
  }
  const document = (await response.json()) as Partial<PackageDocument>;
  if (!document.versions || typeof document.versions !== "object") {
    throw new Error(`Registry answer for ${name} has no versions`);
  }
  return document as PackageDocument;
}

/**
 * Split a semantic version into its numeric build and its prerelease identifiers.
 * @param value - Version string to parse
 * @returns Parsed version, or undefined when the string is not a semantic version
 */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = versionPattern.exec(value);
  if (!match) {
    return undefined;
  }
  const [, major, minor, patch, prerelease] = match;
  return {
    build: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease
      ? prerelease
          .split(".")
          .map((identifier) => (/^\d+$/.test(identifier) ? Number(identifier) : identifier))
      : [],
  };
}

/**
 * List the versions that sort strictly above a ceiling.
 * @param versions - Published versions
 * @param ceiling - Highest version allowed by the freeze
 * @returns Unexpected versions, sorted ascending
 */
export function versionsAbove(versions: readonly string[], ceiling: string): string[] {
  return versions.filter((version) => compareVersions(version, ceiling) > 0).sort(compareVersions);
}

/**
 * List the versions whose stored deprecation message differs from the canonical one.
 * @param document - Registry document of the standalone package
 * @param message - Canonical deprecation message
 * @returns Versions needing a write, sorted ascending
 */
export function versionsWithoutMessage(
  document: PackageDocument,
  message: string = DEPRECATION_MESSAGE,
): string[] {
  return Object.keys(document.versions)
    .filter((version) => document.versions[version]?.deprecated !== message)
    .sort(compareVersions);
}
