#!/usr/bin/env node
/** Policy-baseline, complete, or differential gate for registry artifacts in package-lock.json. */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_PROTOCOL = /^(?:file|link|workspace):/i;
const MAXIMUM_METADATA_CONCURRENCY = 8;
const MINIMUM_RELEASE_AGE_DAYS = 3;
export const POLICY_BASE_SHA = "62cd5dab23e0b8c0faf3b843943013a608318c36";
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
    if (entry.link === true || (typeof resolved === "string" && LOCAL_PROTOCOL.test(resolved))) {
      continue;
    }
    if (resolved !== undefined && typeof resolved !== "string") {
      throw new Error(`Invalid resolved source at ${path}`);
    }
    if (entry.inBundle !== undefined && typeof entry.inBundle !== "boolean") {
      throw new Error(`Invalid inBundle state at ${path}`);
    }

    const inBundle = entry.inBundle === true;
    const name = inferPackageName(path, entry);
    const version = entry.version;
    const integrity = entry.integrity;
    const resolvedUrl = resolved ?? null;
    let approvedResolved = false;
    if (resolvedUrl !== null && /^https?:\/\//i.test(resolvedUrl)) {
      try {
        approvedResolved = new URL(resolvedUrl).origin === PUBLIC_NPM_REGISTRY_ORIGIN;
      } catch {
        approvedResolved = false;
      }
    }
    if (
      approvedResolved &&
      typeof version === "string" &&
      version.length > 0 &&
      typeof integrity === "string" &&
      integrity.length > 0
    ) {
      artifacts.push({ inBundle, integrity, name, resolved: resolvedUrl, version });
      continue;
    }
    remoteSources.push({
      inBundle,
      integrity: typeof integrity === "string" ? integrity : "",
      name,
      resolved: resolvedUrl,
      version: typeof version === "string" ? version : "",
    });
  }
  return { artifacts, remoteSources };
}

/**
 * Find every unique attestable registry artifact in a lockfile.
 * Unattestable entries fail closed in complete mode.
 * @param lockValue - Parsed current lockfile
 * @returns Unique registry artifacts
 */
export function findAllLockArtifacts(lockValue) {
  const current = extractLockArtifacts(lockValue);
  rejectUnattestableSources(current.remoteSources, "Lockfile source");
  return deduplicateArtifacts(current.artifacts);
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
  const baseFingerprints = new Set(base.artifacts.map(artifactFingerprint));
  const baseRemoteFingerprints = new Set(base.remoteSources.map(artifactFingerprint));
  const baseByNameVersion = new Map();
  for (const artifact of base.artifacts) {
    const key = artifactIdentity(artifact);
    const versions = baseByNameVersion.get(key) ?? [];
    versions.push(artifact);
    baseByNameVersion.set(key, versions);
  }

  const newRemoteSources = current.remoteSources.filter(
    (source) => !baseRemoteFingerprints.has(artifactFingerprint(source)),
  );
  rejectUnattestableSources(newRemoteSources, "New source");

  const newByNameVersion = new Map();
  for (const artifact of current.artifacts) {
    const fingerprint = artifactFingerprint(artifact);
    if (baseFingerprints.has(fingerprint)) continue;
    const key = artifactIdentity(artifact);
    const baseVersions = baseByNameVersion.get(key);
    if (baseVersions) {
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
 * Parse the default cumulative policy mode or an explicit complete/differential mode.
 * @param args - Command-line arguments after the script name
 * @returns Validated gate mode
 */
export function parseCliArguments(args) {
  if (args.length === 0) return { baseSha: POLICY_BASE_SHA, mode: "policy" };
  if (args.length === 1 && args[0] === "--all") return { mode: "all" };
  const [option, baseSha] = args;
  if (
    args.length !== 2 ||
    option !== "--base" ||
    !baseSha ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(baseSha)
  ) {
    throw new Error("Usage: npm run check-lockfile-release-age -- [--all | --base <full-git-sha>]");
  }
  return { baseSha, mode: "differential" };
}

/**
 * Select artifacts for a policy-baseline, complete, or differential gate without process I/O.
 * @param mode - Validated gate mode
 * @param currentLock - Parsed current lockfile
 * @param baseLock - Parsed base lockfile required in differential mode
 * @returns Unique artifacts requiring registry attestation
 */
export function selectLockArtifacts(mode, currentLock, baseLock) {
  if (mode.mode === "all") return findAllLockArtifacts(currentLock);
  if (baseLock === undefined) {
    throw new Error("Differential release-age mode requires a base package-lock.json");
  }
  return findNewLockArtifacts(baseLock, currentLock);
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

/**
 * Build a stable full artifact fingerprint, including bundled state.
 * @param artifact - Extracted lockfile artifact or source
 * @returns Stable fingerprint
 */
function artifactFingerprint(artifact) {
  return `${artifact.name}\0${artifact.version}\0${String(artifact.resolved)}\0${artifact.integrity}\0${String(artifact.inBundle)}`;
}

/**
 * Build a package identity used to reject conflicting duplicate artifacts.
 * @param artifact - Extracted lockfile artifact
 * @returns Name and exact version identity
 */
function artifactIdentity(artifact) {
  return `${artifact.name}\0${artifact.version}`;
}

/**
 * Deduplicate identical lockfile artifacts and reject conflicting fingerprints.
 * @param artifacts - Extracted registry artifacts
 * @returns Unique artifacts in lockfile order
 */
function deduplicateArtifacts(artifacts) {
  const unique = new Map();
  for (const artifact of artifacts) {
    const key = artifactIdentity(artifact);
    const existing = unique.get(key);
    if (existing && artifactFingerprint(existing) !== artifactFingerprint(artifact)) {
      throw new Error(`Conflicting artifact fingerprints for ${artifact.name}@${artifact.version}`);
    }
    unique.set(key, artifact);
  }
  return [...unique.values()];
}

/**
 * Return a portable npm CLI invocation supplied by the parent npm process.
 * @returns Node.js command and npm CLI prefix arguments
 */
function getNpmInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error(
      "Missing npm_execpath; run this checker through npm run check-lockfile-release-age",
    );
  }
  return { args: [npmExecPath], command: process.execPath };
}

/** Run the release-age command-line gate. */
async function main() {
  const mode = parseCliArguments(process.argv.slice(2));
  const npmInvocation = getNpmInvocation();
  const configuredAge = validateMinimumReleaseAge(
    parseJson(
      runSync(npmInvocation.command, [
        ...npmInvocation.args,
        "config",
        "get",
        "min-release-age",
        "--json",
      ]),
      "npm min-release-age configuration",
    ),
  );

  const currentLock = parseJson(readFileSync("package-lock.json", "utf8"), "package-lock.json");
  const baseLock =
    mode.mode !== "all"
      ? parseJson(
          runSync("git", ["show", `${mode.baseSha}:package-lock.json`]),
          "Base package-lock.json",
        )
      : undefined;
  const artifacts = selectLockArtifacts(mode, currentLock, baseLock);
  await validateArtifactsConcurrently(artifacts, npmInvocation, configuredAge, Date.now());
  const qualifier = mode.mode === "all" ? "lockfile" : "new lockfile";
  console.log(`Verified release age for ${artifacts.length} ${qualifier} artifact(s).`);
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
 * Reject sources that cannot be attested against the configured public registry.
 * @param sources - Unattestable lockfile entries
 * @param label - Diagnostic prefix
 */
function rejectUnattestableSources(sources, label) {
  const source = sources[0];
  if (!source) return;
  throw new Error(
    `${label} cannot be attested by ${PUBLIC_NPM_REGISTRY}: ${source.name}@${source.version || "unknown"} (${source.resolved ?? "no resolved URL"})`,
  );
}

/**
 * Run one subprocess asynchronously without a shell and require normal success.
 * @param command - Executable name
 * @param args - Separate process arguments
 * @returns Standard output
 */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      reject(new Error(`Unable to run ${command}: ${error.message}`));
    });
    child.on("close", (status, signal) => {
      if (signal !== null) {
        reject(new Error(`${command} terminated by signal ${signal}`));
      } else if (status !== 0) {
        const diagnostic = stderr.trim();
        reject(
          new Error(
            `${command} exited with status ${status ?? "unknown"}${diagnostic ? `: ${diagnostic}` : ""}`,
          ),
        );
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Run one subprocess synchronously without a shell and require normal success.
 * @param command - Executable name
 * @param args - Separate process arguments
 * @returns Standard output
 */
function runSync(command, args) {
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

/**
 * Validate registry metadata with bounded concurrency and deterministic errors.
 * @param artifacts - Unique artifacts requiring attestation
 * @param npmInvocation - Portable npm CLI invocation
 * @param minimumAgeDays - Required age in days
 * @param nowMs - Current Unix timestamp in milliseconds
 */
async function validateArtifactsConcurrently(artifacts, npmInvocation, minimumAgeDays, nowMs) {
  let nextIndex = 0;
  const failures = new Array(artifacts.length);
  const worker = async () => {
    while (nextIndex < artifacts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const artifact = artifacts[index];
      try {
        const metadata = parseJson(
          await run(npmInvocation.command, [
            ...npmInvocation.args,
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
        validateArtifactMetadata(artifact, metadata, minimumAgeDays, nowMs);
      } catch (error) {
        failures[index] = error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  const workerCount = Math.min(MAXIMUM_METADATA_CONCURRENCY, artifacts.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  for (const failure of failures) {
    if (failure) throw failure;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
