/**
 * Freeze and deprecation gate for the standalone V2 package.
 *
 * The library performs no work on import: every registry read and every registry write is an
 * explicit call. The `check` entry is read-only and safe for continuous integration, while
 * `deprecate` writes and must be run by a maintainer with an authenticated npm CLI.
 */
import { statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";

import { fetchPackagePackument } from "./check-lockfile-release-age.mjs";

/** Published name of the deprecated standalone package. */
export const STANDALONE_PACKAGE_NAME = "@jerome-benoit/sap-ai-provider-v2";

/** Last version published to the standalone package; any newer version breaks the freeze. */
export const FROZEN_VERSION = "5.1.2";

/** Package spec this gate passes to `npm deprecate`; npm alone selects the versions. */
export const DEPRECATION_SPEC = `${STANDALONE_PACKAGE_NAME}@<=${FROZEN_VERSION}`;

/** Registry the gate reads and the one-time deprecation write targets. */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** Smallest npm document that carries the per-version `deprecated` field. */
const ABBREVIATED_DOCUMENT_ACCEPT = "application/vnd.npm.install-v1+json";

/** Canonical message to apply to every published version of the standalone package. */
export const DEPRECATION_MESSAGE = [
  `${STANDALONE_PACKAGE_NAME}@${FROZEN_VERSION} is the last release of this package.`,
  "Use the /v2 subpath of @jerome-benoit/sap-ai-provider instead: same LanguageModelV2 facade,",
  "shipped with the main package, still supported for AI SDK 5.",
  "https://github.com/jerome-benoit/sap-ai-provider/blob/main/MIGRATION_GUIDE.md",
].join(" ");

/** Longest version string npm publishes, the limit npm's own semver applies. */
const MAXIMUM_VERSION_LENGTH = 256;

/**
 * Canonical npm version grammar: three unprefixed numbers and an optional prerelease of
 * dot-separated identifiers, where a fully numeric identifier carries no leading zero. Build
 * metadata is absent because npm will not publish it.
 */
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** Prerelease identifier made of digits only. */
const numericIdentifierPattern = /^\d+$/;

/** Command asked for, with the only flag that changes its behaviour. */
export interface Invocation {
  readonly apply: boolean;
  readonly command: "check" | "deprecate" | "verify";
}

/** Abbreviated registry document, narrowed to the fields this gate reads. */
export interface PackageDocument {
  readonly versions: Record<string, PackageVersionRecord>;
}

/** Registry record of one published version, narrowed to the fields this gate reads. */
export interface PackageVersionRecord {
  readonly deprecated?: string;
  readonly name: string;
  readonly version: string;
}

interface ParsedVersion {
  readonly build: readonly string[];
  readonly prerelease: readonly string[];
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
    const difference = compareNumericIdentifiers(
      parsedLeft.build[index] ?? "0",
      parsedRight.build[index] ?? "0",
    );
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
    const leftIsNumeric = numericIdentifierPattern.test(a);
    const rightIsNumeric = numericIdentifierPattern.test(b);
    if (leftIsNumeric && rightIsNumeric) {
      return compareNumericIdentifiers(a, b);
    }
    if (leftIsNumeric) {
      return -1;
    }
    if (rightIsNumeric) {
      return 1;
    }
    return a < b ? -1 : 1;
  }
  return parsedLeft.prerelease.length - parsedRight.prerelease.length;
}

/**
 * Read and validate the abbreviated registry document of the standalone package.
 *
 * Transport is the shared npm packument reader of this repository: a 10-second deadline covering
 * headers and body, rejected redirects, a same-origin response check, and a bounded decoded body.
 * @param fetchImpl - Fetch implementation override
 * @returns Registry document
 */
export async function fetchPackageDocument(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PackageDocument> {
  const readAbbreviatedDocument: typeof fetch = (input, init) =>
    fetchImpl(input, { ...init, headers: { accept: ABBREVIATED_DOCUMENT_ACCEPT } });
  let value: unknown;
  try {
    value = await fetchPackagePackument(STANDALONE_PACKAGE_NAME, readAbbreviatedDocument);
  } catch (error) {
    if (isUnavailableRegistryDocument(error)) {
      throw new Error(
        `Registry document for ${STANDALONE_PACKAGE_NAME} is unavailable (HTTP 404); cannot attest the freeze`,
        { cause: error },
      );
    }
    throw error;
  }
  return validatePackageDocument(value);
}

/**
 * Build the npm command that writes the deprecation message.
 *
 * Node launches the npm entry point that `npm run` exports instead of an `npm` shim, which Windows
 * ships as a batch file that cannot be spawned without a shell. The entry point must be an absolute
 * path to an existing `npm-cli.js` file, so neither a Node flag nor another executable can be
 * started with the credentials of the npm that exported the variable. Both the plain and the scoped
 * registry are pinned to the registry this gate reads, because npm prefers a
 * `@jerome-benoit:registry` setting over a plain `--registry`.
 * npm picks the versions to write from its own uncached registry read, so the package spec caps the
 * write at the frozen version even when that read holds a version this gate never saw.
 * An inherited `dry-run` setting would make npm skip its write and still exit zero, so the command
 * line pins `--dry-run=false`, which outranks both `npm_config_dry_run` and any `.npmrc`.
 * @param npmExecPath - npm entry point exported by `npm run`
 * @param nodeExecPath - Node executable running the gate
 * @returns Executable and arguments of the npm write
 */
export function getNpmDeprecationInvocation(
  npmExecPath = process.env.npm_execpath,
  nodeExecPath = process.execPath,
): { args: string[]; command: string } {
  if (!npmExecPath) {
    throw new Error("Missing npm_execpath; run npm run deprecate-v2-package -- --apply");
  }
  if (
    !isAbsolute(npmExecPath) ||
    basename(npmExecPath) !== "npm-cli.js" ||
    !statSync(npmExecPath, { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error(
      "Invalid npm_execpath: expected an absolute path to an existing npm-cli.js file; run npm run deprecate-v2-package -- --apply",
    );
  }
  return {
    args: [
      npmExecPath,
      "deprecate",
      DEPRECATION_SPEC,
      DEPRECATION_MESSAGE,
      "--dry-run=false",
      `--registry=${DEFAULT_REGISTRY}`,
      `--@jerome-benoit:registry=${DEFAULT_REGISTRY}`,
    ],
    command: nodeExecPath,
  };
}

/**
 * Validate a whole gate command line.
 *
 * Every command rejects arguments it does not use, so a misspelled `--apply` cannot quietly run a
 * read-only command and report success.
 * @param args - Arguments after the Node and script entries
 * @returns Validated invocation
 */
export function parseArguments(args: readonly string[]): Invocation {
  const [command = "check", ...flags] = args;
  if (command !== "check" && command !== "deprecate" && command !== "verify") {
    throw new Error(`Expected command check, verify, or deprecate; received ${command}`);
  }
  if (flags.length === 0) {
    return { apply: false, command };
  }
  if (command === "deprecate" && flags.length === 1 && flags[0] === "--apply") {
    return { apply: true, command };
  }
  throw new Error(`Unexpected arguments for ${command}: ${flags.join(", ")}`);
}

/**
 * Split a canonical version into its numeric build and its prerelease identifiers.
 * @param value - Version string to parse
 * @returns Parsed version, or undefined when npm could not have published the string
 */
export function parseVersion(value: string): ParsedVersion | undefined {
  if (value.length > MAXIMUM_VERSION_LENGTH) {
    return undefined;
  }
  const match = versionPattern.exec(value);
  if (!match) {
    return undefined;
  }
  const [, major = "0", minor = "0", patch = "0", prerelease] = match;
  return {
    build: [major, minor, patch],
    prerelease: prerelease ? prerelease.split(".") : [],
  };
}

/**
 * List the versions that sort strictly above a ceiling.
 * @param versions - Published version strings
 * @param ceiling - Ceiling every listed version must not exceed
 * @returns Versions above the ceiling, sorted
 */
export function versionsAbove(versions: readonly string[], ceiling: string): string[] {
  return versions.filter((version) => compareVersions(version, ceiling) > 0).sort(compareVersions);
}

/**
 * List the versions whose stored deprecation message differs from the canonical one.
 * @param document - Registry document
 * @param message - Canonical deprecation message
 * @returns Versions without the canonical message, sorted
 */
export function versionsWithoutMessage(
  document: PackageDocument,
  message: string = DEPRECATION_MESSAGE,
): string[] {
  return Object.keys(document.versions)
    .filter((version) => document.versions[version]?.deprecated !== message)
    .sort(compareVersions);
}

/**
 * Compare two digit identifiers by exact value, without converting them to a float.
 * @param left - Digit identifier without a leading zero
 * @param right - Digit identifier without a leading zero
 * @returns Negative, zero, or positive number following `Array.prototype.sort` conventions
 */
function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Decide whether a registry value is a usable JSON object.
 * @param value - Value read from the registry
 * @returns True for a non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Decide whether the shared reader was answered that the canonical registry has no document.
 *
 * A missing document proves neither that the frozen package was removed nor that the freeze holds,
 * so the gate still stops; only the diagnostic names the state it observed.
 * @param error - Error raised while reading the packument
 * @returns True for a 404 answered by the canonical registry origin
 */
function isUnavailableRegistryDocument(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const { responseUrl, status } = error as Error & { responseUrl?: unknown; status?: unknown };
  if (status !== 404 || typeof responseUrl !== "string" || !URL.canParse(responseUrl)) {
    return false;
  }
  return new URL(responseUrl).origin === DEFAULT_REGISTRY;
}

/**
 * Reject any registry document this gate cannot read as the frozen standalone package.
 *
 * An empty versions table, a document for another package name, a version key npm could not have
 * published, a missing or moved `latest` tag, a dist-tag pointing outside the table, or a version
 * record whose identity does not match its key all stop the gate: each of them would otherwise let
 * `check` report a held freeze and `verify` report full coverage over a document that proves
 * nothing.
 * @param value - Decoded registry document
 * @returns Document narrowed to the fields this gate reads
 */
function validatePackageDocument(value: unknown): PackageDocument {
  if (!isRecord(value) || value.name !== STANDALONE_PACKAGE_NAME) {
    throw new Error(`Expected the registry document of ${STANDALONE_PACKAGE_NAME}`);
  }

  const tags = value["dist-tags"];
  const versions = value.versions;
  if (!isRecord(versions)) {
    throw new Error(`Registry document for ${STANDALONE_PACKAGE_NAME} has no versions table`);
  }

  const keys = Object.keys(versions);
  if (keys.length === 0) {
    throw new Error(`Registry document for ${STANDALONE_PACKAGE_NAME} lists no version`);
  }

  const unsupported = keys.filter((version) => parseVersion(version) === undefined);
  if (unsupported.length > 0) {
    throw new Error(
      `Registry document for ${STANDALONE_PACKAGE_NAME} holds versions this gate cannot order: ${unsupported.map((version) => JSON.stringify(version)).join(", ")}; review the gate before trusting the freeze`,
    );
  }

  if (!isRecord(tags) || typeof tags.latest !== "string") {
    throw new Error(`Registry document for ${STANDALONE_PACKAGE_NAME} has no latest dist-tag`);
  }
  if (tags.latest !== FROZEN_VERSION) {
    throw new Error(
      `Registry dist-tag latest is ${JSON.stringify(tags.latest)}, not the frozen ${FROZEN_VERSION}`,
    );
  }
  if (!Object.hasOwn(versions, FROZEN_VERSION)) {
    throw new Error(
      `Registry latest tag points at ${FROZEN_VERSION}, which the versions table does not list`,
    );
  }

  for (const [tag, target] of Object.entries(tags)) {
    if (tag === "latest") {
      continue;
    }
    if (typeof target !== "string") {
      throw new Error(`Registry dist-tag ${JSON.stringify(tag)} must point to a version string`);
    }
    if (!Object.hasOwn(versions, target)) {
      throw new Error(
        `Registry dist-tag ${JSON.stringify(tag)} points at ${JSON.stringify(target)}, which the versions table does not list`,
      );
    }
  }

  for (const version of keys) {
    const record = versions[version];
    if (!isRecord(record)) {
      throw new Error(`Registry record of ${STANDALONE_PACKAGE_NAME}@${version} is not readable`);
    }
    if (record.name !== STANDALONE_PACKAGE_NAME || record.version !== version) {
      throw new Error(
        `Registry record of ${STANDALONE_PACKAGE_NAME}@${version} has a missing or mismatched name or version`,
      );
    }
    if (record.deprecated !== undefined && typeof record.deprecated !== "string") {
      throw new Error(`Registry record of ${STANDALONE_PACKAGE_NAME}@${version} is not readable`);
    }
  }

  return { versions: versions as Record<string, PackageVersionRecord> };
}
