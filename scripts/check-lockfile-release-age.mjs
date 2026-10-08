#!/usr/bin/env node
/** Differential release-age gate for new registry artifacts in package-lock.json. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_PROTOCOL = /^(?:file|link|workspace):/i;
const MINIMUM_RELEASE_AGE_DAYS = 3;
const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";
const PUBLIC_NPM_REGISTRY_ORIGIN = new URL(PUBLIC_NPM_REGISTRY).origin;

/**
 * Extract exact registry artifacts and unattestable remote sources.
 * @param lockValue - Parsed package-lock.json v3 value
 * @returns Extracted sources
 */
export function extractLockArtifacts(lockValue) {
  if (
    !lockValue ||
    typeof lockValue !== "object" ||
    Array.isArray(lockValue) ||
    lockValue.lockfileVersion !== 3 ||
    !lockValue.packages ||
    typeof lockValue.packages !== "object" ||
    Array.isArray(lockValue.packages)
  ) {
    throw new Error("Expected a package-lock.json v3 packages map");
  }

  const artifacts = [];
  const remoteSources = [];
  for (const [path, entry] of Object.entries(lockValue.packages)) {
    if (path === "") continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid lockfile entry ${path}`);
    }
    const resolved = entry.resolved;
    if (
      entry.inBundle === true ||
      entry.link === true ||
      (typeof resolved === "string" && LOCAL_PROTOCOL.test(resolved))
    ) {
      continue;
    }
    if (resolved !== undefined && typeof resolved !== "string") {
      throw new Error(`Invalid resolved source at ${path}`);
    }

    const name = inferPackageName(path, entry);
    const version = entry.version;
    const integrity = entry.integrity;
    const resolvedUrl = resolved ?? null;
    const approvedResolved =
      resolvedUrl === null ||
      (/^https?:\/\//i.test(resolvedUrl) &&
        new URL(resolvedUrl).origin === PUBLIC_NPM_REGISTRY_ORIGIN);
    if (
      approvedResolved &&
      typeof version === "string" &&
      version.length > 0 &&
      typeof integrity === "string" &&
      integrity.length > 0
    ) {
      artifacts.push({ integrity, name, resolved: resolvedUrl, version });
      continue;
    }
    remoteSources.push({
      integrity: typeof integrity === "string" ? integrity : "",
      name,
      resolved: resolvedUrl,
      version: typeof version === "string" ? version : "",
    });
  }
  return { artifacts, remoteSources };
}

/**
 * Find exact package versions newly introduced by the current lockfile.
 * Relocated duplicate artifacts are ignored; changed fingerprints fail closed.
 * @param baseLock - Parsed lockfile from the base revision
 * @param currentLock - Parsed current lockfile
 * @returns Unique new registry artifacts
 */
export function findNewLockArtifacts(baseLock, currentLock) {
  const base = extractLockArtifacts(baseLock);
  const current = extractLockArtifacts(currentLock);
  const artifactFingerprint = (artifact) =>
    `${artifact.name}\0${artifact.version}\0${String(artifact.resolved)}\0${artifact.integrity}`;
  const sourceFingerprint = (source) =>
    `${source.name}\0${source.version}\0${String(source.resolved)}\0${source.integrity}`;
  const baseFingerprints = new Set(base.artifacts.map(artifactFingerprint));
  const baseRemoteFingerprints = new Set(base.remoteSources.map(sourceFingerprint));
  const baseByNameVersion = new Map();
  for (const artifact of base.artifacts) {
    const key = `${artifact.name}\0${artifact.version}`;
    const versions = baseByNameVersion.get(key) ?? [];
    versions.push(artifact);
    baseByNameVersion.set(key, versions);
  }

  for (const source of current.remoteSources) {
    if (!baseRemoteFingerprints.has(sourceFingerprint(source))) {
      throw new Error(
        `New source cannot be attested by ${PUBLIC_NPM_REGISTRY}: ${source.name}@${source.version || "unknown"} (${source.resolved ?? "no resolved URL"})`,
      );
    }
  }

  const newByNameVersion = new Map();
  for (const artifact of current.artifacts) {
    const fingerprint = artifactFingerprint(artifact);
    if (baseFingerprints.has(fingerprint)) continue;
    const key = `${artifact.name}\0${artifact.version}`;
    const baseVersions = baseByNameVersion.get(key);
    if (baseVersions) {
      const matchesOmittedResolved = baseVersions.some(
        (baseArtifact) =>
          baseArtifact.integrity === artifact.integrity &&
          (baseArtifact.resolved === null || artifact.resolved === null),
      );
      if (matchesOmittedResolved) continue;
      throw new Error(`Artifact fingerprint changed for ${artifact.name}@${artifact.version}`);
    }
    const existing = newByNameVersion.get(key);
    if (existing && artifactFingerprint(existing) !== fingerprint) {
      throw new Error(
        `Conflicting new artifact fingerprints for ${artifact.name}@${artifact.version}`,
      );
    }
    newByNameVersion.set(key, artifact);
  }
  return [...newByNameVersion.values()];
}

/**
 * Infer the real package name represented by a lockfile package path.
 * @param path - Lockfile package path
 * @param entry - Lockfile package entry
 * @returns Real package name
 */
export function inferPackageName(path, entry) {
  if (typeof entry.name === "string" && entry.name.length > 0) return entry.name;
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error(`Cannot infer package name from lockfile path ${path}`);
  const suffix = path.slice(markerIndex + marker.length);
  const segments = suffix.split("/");
  const name = suffix.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  if (!name || (suffix.startsWith("@") && segments.length < 2)) {
    throw new Error(`Cannot infer package name from lockfile path ${path}`);
  }
  return name;
}

/**
 * Validate registry metadata, artifact identity, and configured minimum age.
 * @param artifact - Exact lockfile artifact
 * @param metadata - Parsed npm view response
 * @param minimumAgeDays - Required age in days
 * @param nowMs - Current Unix timestamp in milliseconds
 */
export function validateArtifactMetadata(artifact, metadata, minimumAgeDays, nowMs) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`Invalid npm metadata for ${artifact.name}@${artifact.version}`);
  }
  const time = metadata.time;
  const nestedDist = metadata.dist;
  const integrity =
    nestedDist && typeof nestedDist === "object" && !Array.isArray(nestedDist)
      ? nestedDist.integrity
      : metadata["dist.integrity"];
  const tarball =
    nestedDist && typeof nestedDist === "object" && !Array.isArray(nestedDist)
      ? nestedDist.tarball
      : metadata["dist.tarball"];
  if (
    !time ||
    typeof time !== "object" ||
    Array.isArray(time) ||
    typeof time[artifact.version] !== "string" ||
    typeof integrity !== "string" ||
    typeof tarball !== "string"
  ) {
    throw new Error(`Incomplete npm metadata for ${artifact.name}@${artifact.version}`);
  }
  if (
    integrity !== artifact.integrity ||
    (artifact.resolved !== null && tarball !== artifact.resolved)
  ) {
    throw new Error(
      `Registry metadata fingerprint mismatch for ${artifact.name}@${artifact.version}`,
    );
  }
  const publishedMs = Date.parse(time[artifact.version]);
  if (!Number.isFinite(publishedMs)) {
    throw new Error(`Invalid publication timestamp for ${artifact.name}@${artifact.version}`);
  }
  if (nowMs - publishedMs < minimumAgeDays * DAY_MS) {
    throw new Error(
      `${artifact.name}@${artifact.version} is newer than the ${minimumAgeDays}-day minimum release age`,
    );
  }
}

/**
 * Validate that npm configuration exactly matches repository release-age policy.
 * @param configuredAge - Parsed npm min-release-age value
 * @returns Repository minimum release age
 */
export function validateMinimumReleaseAge(configuredAge) {
  if (configuredAge !== MINIMUM_RELEASE_AGE_DAYS) {
    throw new Error(
      `npm min-release-age must equal repository policy ${MINIMUM_RELEASE_AGE_DAYS} days`,
    );
  }
  return MINIMUM_RELEASE_AGE_DAYS;
}

/** Run the differential release-age command-line gate. */
function main() {
  const baseSha = process.argv[2];
  if (!baseSha || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(baseSha)) {
    throw new Error("Expected a full hexadecimal base Git SHA");
  }
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const configuredAge = validateMinimumReleaseAge(
    parseJson(
      run(npmCommand, ["config", "get", "min-release-age", "--json"]),
      "npm min-release-age configuration",
    ),
  );

  const currentLock = parseJson(readFileSync("package-lock.json", "utf8"), "package-lock.json");
  const baseLock = parseJson(
    run("git", ["show", `${baseSha}:package-lock.json`]),
    "Base package-lock.json",
  );
  const newArtifacts = findNewLockArtifacts(baseLock, currentLock);
  const nowMs = Date.now();
  for (const artifact of newArtifacts) {
    const metadata = parseJson(
      run(npmCommand, [
        "view",
        `${artifact.name}@${artifact.version}`,
        "time",
        "dist.integrity",
        "dist.tarball",
        "--json",
        `--registry=${PUBLIC_NPM_REGISTRY}`,
      ]),
      `npm metadata for ${artifact.name}@${artifact.version}`,
    );
    validateArtifactMetadata(artifact, metadata, configuredAge, nowMs);
  }
  console.log(`Verified release age for ${newArtifacts.length} new lockfile artifact(s).`);
}

/**
 * Parse complete JSON output with a contextual diagnostic.
 * @param text - JSON text
 * @param description - Diagnostic source name
 * @returns Parsed JSON value
 */
function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${description} did not return valid JSON`);
  }
}

/**
 * Run one subprocess without a shell and require normal success.
 * @param command - Executable name
 * @param args - Separate process arguments
 * @returns Standard output
 */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
  if (result.error) throw new Error(`Unable to run ${command}: ${result.error.message}`);
  if (result.signal !== null) throw new Error(`${command} terminated by signal ${result.signal}`);
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim();
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }
  return result.stdout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
