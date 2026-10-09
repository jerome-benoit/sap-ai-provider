#!/usr/bin/env node
/** Policy-baseline, complete, differential, or trusted gate for package-lock artifacts. */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const LOCAL_PROTOCOL = /^(?:file|link|workspace):/i;
/** Maximum number of unique registry artifacts accepted from one lockfile selection. */
export const MAXIMUM_ATTESTED_ARTIFACTS = 1024;
/** Maximum UTF-8 byte size accepted for every package-lock.json input. */
export const MAXIMUM_LOCKFILE_BYTES = 2 * 1024 * 1024;
/** Maximum decoded UTF-8 byte size accepted for each canonical npm packument. */
export const MAXIMUM_PACKUMENT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_METADATA_CONCURRENCY = 8;
const PACKUMENT_TIMEOUT_MS = 10_000;
const MINIMUM_RELEASE_AGE_DAYS = 3;
/** Default comparison commit; artifacts present in its lockfile are not age-validated. */
export const POLICY_BASE_SHA = "3f869c5f5371b35e53ef38bae2173541ab6c209a";
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
      artifacts.push({
        inBundle,
        integrity,
        name,
        resolved: resolvedUrl,
        version,
      });
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
 * Fetch one raw canonical npm packument without permitting redirects.
 * @param packageName - Exact npm package name
 * @param fetchImplementation - Fetch implementation
 * @param externalSignal - Optional caller cancellation signal
 * @returns Raw canonical packument
 */
export async function fetchPackagePackument(
  packageName,
  fetchImplementation = globalThis.fetch,
  externalSignal,
) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("This Node.js runtime does not provide fetch");
  }
  const requestUrl = new URL(encodeURIComponent(packageName), PUBLIC_NPM_REGISTRY);
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error("npm packument request timed out")),
    PACKUMENT_TIMEOUT_MS,
  );
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal;
  try {
    let response;
    try {
      response = await raceWithAbort(
        fetchImplementation(requestUrl, {
          headers: { accept: "application/json" },
          redirect: "error",
          signal,
        }),
        signal,
      );
    } catch (error) {
      throw new Error(
        `Unable to fetch npm packument for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(`npm packument for ${packageName} returned HTTP ${response.status}`);
    }
    try {
      if (new URL(response.url).origin !== PUBLIC_NPM_REGISTRY_ORIGIN) {
        throw new Error("response origin changed");
      }
    } catch (error) {
      throw new Error(
        `Invalid npm packument response URL for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const packument = await readPackumentResponse(response, packageName, signal);
    if (!packument || typeof packument !== "object" || Array.isArray(packument)) {
      throw new Error(`npm packument for ${packageName} did not return a JSON object`);
    }
    return packument;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Find every unique attestable registry artifact in a lockfile.
 * @param lockValue - Parsed package-lock.json v3 value
 * @returns Unique registry artifacts
 */
export function findAllLockArtifacts(lockValue) {
  const current = extractLockArtifacts(lockValue);
  rejectUnattestableSources(current.remoteSources, "Lockfile source");
  return deduplicateArtifacts(current.artifacts);
}

/**
 * Find exact package versions newly introduced by the current lockfile.
 * @param baseLock - Parsed comparison lockfile
 * @param currentLock - Parsed current lockfile
 * @returns Unique newly introduced registry artifacts
 */
export function findNewLockArtifacts(baseLock, currentLock) {
  const base = extractLockArtifacts(baseLock);
  const current = extractLockArtifacts(currentLock);
  const baseFingerprints = new Set(base.artifacts.map(artifactFingerprint));
  const baseRemoteFingerprints = new Set(base.remoteSources.map(artifactFingerprint));
  const baseIdentities = new Set(base.artifacts.map(artifactIdentity));

  const newRemoteSources = current.remoteSources.filter(
    (source) => !baseRemoteFingerprints.has(artifactFingerprint(source)),
  );
  rejectUnattestableSources(newRemoteSources, "New source");

  const newByNameVersion = new Map();
  for (const artifact of current.artifacts) {
    const fingerprint = artifactFingerprint(artifact);
    if (baseFingerprints.has(fingerprint)) continue;
    const key = artifactIdentity(artifact);
    if (baseIdentities.has(key)) {
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
 * @param path - Exact lockfile package path
 * @param entry - Lockfile package entry
 * @returns Real package name
 */
export function inferPackageName(path, entry) {
  if (typeof entry.name === "string" && entry.name.length > 0) {
    return entry.name;
  }
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Cannot infer package name from lockfile path ${path}`);
  }
  const suffix = path.slice(markerIndex + marker.length);
  const segments = suffix.split("/");
  const name = suffix.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  if (!name || (suffix.startsWith("@") && segments.length < 2)) {
    throw new Error(`Cannot infer package name from lockfile path ${path}`);
  }
  return name;
}

/**
 * Load the exact lockfile revisions selected by a validated mode.
 * @param mode - Validated command-line mode
 * @param readCurrentLock - Working-tree lockfile reader
 * @param readLockfile - Data-only lockfile reader
 * @param showGitObject - Exact trusted Git object reader
 * @returns Selected parsed lockfiles
 */
export function loadLockfiles(
  mode,
  readCurrentLock = () => readBoundedLockfile("package-lock.json", "Current package-lock.json"),
  readLockfile = (lockfilePath, description) => readBoundedLockfile(lockfilePath, description),
  showGitObject = (objectName) =>
    runSync("git", ["show", objectName], {
      maxBuffer: MAXIMUM_LOCKFILE_BYTES + 1,
      oversizedDescription: "Base package-lock.json",
    }),
) {
  if (mode.mode === "trusted-files") {
    const currentLock = parseLockfileJson(
      readLockfile(mode.headLockfilePath, "Head package-lock.json"),
      "Head package-lock.json data file",
      "Head package-lock.json",
    );
    const baseLock = parseLockfileJson(
      readLockfile(mode.baseLockfilePath, "Base package-lock.json"),
      "Base package-lock.json data file",
      "Base package-lock.json",
    );
    return { baseLock, currentLock };
  }
  const currentLock = parseLockfileJson(readCurrentLock(), "Current package-lock.json");
  if (mode.mode === "all") return { currentLock };
  const baseLock = parseLockfileJson(
    showGitObject(`${mode.baseSha}:package-lock.json`),
    "Base package-lock.json",
  );
  return { baseLock, currentLock };
}

/**
 * Parse policy, complete, candidate differential, or data-only trusted mode.
 * @param args - Command-line arguments after the script name
 * @returns Validated gate mode
 */
export function parseCliArguments(args) {
  if (args.length === 0) return { baseSha: POLICY_BASE_SHA, mode: "policy" };
  if (args.length === 1 && args[0] === "--all") return { mode: "all" };
  if (args.length === 2 && args[0] === "--base" && FULL_GIT_SHA.test(args[1] ?? "")) {
    return { baseSha: args[1], mode: "differential" };
  }
  if (
    args.length === 4 &&
    args[0] === "--head-lockfile" &&
    args[1] !== "" &&
    args[2] === "--base-lockfile" &&
    args[3] !== "" &&
    args[1] !== args[3]
  ) {
    return {
      baseLockfilePath: args[3],
      headLockfilePath: args[1],
      mode: "trusted-files",
    };
  }
  throw new Error(
    "Usage: npm run check-lockfile-release-age -- [--all | --base <full-git-sha> | --head-lockfile <path> --base-lockfile <path>]",
  );
}

/**
 * Select artifacts for a policy-baseline, complete, or differential gate.
 * @param mode - Validated command-line mode
 * @param currentLock - Parsed current lockfile
 * @param baseLock - Parsed comparison lockfile
 * @returns Artifacts requiring registry attestation
 */
export function selectLockArtifacts(mode, currentLock, baseLock) {
  let artifacts;
  if (mode.mode === "all") {
    artifacts = findAllLockArtifacts(currentLock);
  } else {
    if (baseLock === undefined) {
      throw new Error("Differential release-age mode requires a base package-lock.json");
    }
    artifacts = findNewLockArtifacts(baseLock, currentLock);
  }
  assertArtifactLimit(artifacts);
  return artifacts;
}

/**
 * Validate canonical packument identity, fingerprint, and publication age.
 * @param artifact - Exact lockfile artifact
 * @param packument - Raw canonical npm packument
 * @param minimumAgeDays - Required age in days
 * @param nowMs - Current Unix timestamp in milliseconds
 */
export function validateArtifactMetadata(artifact, packument, minimumAgeDays, nowMs) {
  if (!packument || typeof packument !== "object" || Array.isArray(packument)) {
    throw new Error(`Invalid npm packument for ${artifact.name}@${artifact.version}`);
  }
  const time = packument.time;
  const versions = packument.versions;
  if (
    !time ||
    typeof time !== "object" ||
    Array.isArray(time) ||
    !versions ||
    typeof versions !== "object" ||
    Array.isArray(versions)
  ) {
    throw new Error(`Incomplete npm packument for ${artifact.name}@${artifact.version}`);
  }
  const manifest = versions[artifact.version];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Incomplete npm packument for ${artifact.name}@${artifact.version}`);
  }
  const dist = manifest.dist;
  if (
    manifest.name !== artifact.name ||
    manifest.version !== artifact.version ||
    !dist ||
    typeof dist !== "object" ||
    Array.isArray(dist) ||
    typeof dist.integrity !== "string" ||
    typeof dist.tarball !== "string" ||
    typeof time[artifact.version] !== "string"
  ) {
    throw new Error(
      `Incomplete or mismatched npm packument for ${artifact.name}@${artifact.version}`,
    );
  }
  if (
    dist.integrity !== artifact.integrity ||
    (artifact.resolved !== null && dist.tarball !== artifact.resolved)
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
 * Validate packuments with bounded concurrency and one request per package name.
 * @param artifacts - Unique artifacts requiring attestation
 * @param minimumAgeDays - Required age in days
 * @param nowMs - Current Unix timestamp in milliseconds
 * @param fetchImplementation - Fetch implementation
 * @returns Completion after every artifact passes
 */
export async function validateArtifactsConcurrently(
  artifacts,
  minimumAgeDays,
  nowMs,
  fetchImplementation = globalThis.fetch,
) {
  assertArtifactLimit(artifacts);
  const artifactsByName = new Map();
  for (const artifact of artifacts) {
    const packageArtifacts = artifactsByName.get(artifact.name);
    if (packageArtifacts) packageArtifacts.push(artifact);
    else artifactsByName.set(artifact.name, [artifact]);
  }
  const packages = [...artifactsByName.entries()];
  for (let offset = 0; offset < packages.length; offset += MAXIMUM_METADATA_CONCURRENCY) {
    const controller = new AbortController();
    let firstFailure;
    const batch = packages.slice(offset, offset + MAXIMUM_METADATA_CONCURRENCY);
    await Promise.all(
      batch.map(async ([name, packageArtifacts]) => {
        try {
          const packument = await fetchPackagePackument(
            name,
            fetchImplementation,
            controller.signal,
          );
          for (const artifact of packageArtifacts) {
            validateArtifactMetadata(artifact, packument, minimumAgeDays, nowMs);
          }
        } catch (error) {
          if (!firstFailure) {
            firstFailure = error instanceof Error ? error : new Error(String(error));
            controller.abort(firstFailure);
          }
        }
      }),
    );
    if (firstFailure) throw firstFailure;
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
 * Build a stable artifact fingerprint.
 * @param artifact - Extracted lockfile artifact
 * @returns Stable fingerprint
 */
function artifactFingerprint(artifact) {
  return `${artifact.name}\0${artifact.version}\0${String(artifact.resolved)}\0${artifact.integrity}\0${String(artifact.inBundle)}`;
}

/**
 * Build an artifact name/version identity.
 * @param artifact - Extracted lockfile artifact
 * @returns Stable identity
 */
function artifactIdentity(artifact) {
  return `${artifact.name}\0${artifact.version}`;
}

/**
 * Reject lockfile selections that exceed the registry-attestation resource contract.
 * @param artifacts - Deduplicated artifacts selected for attestation
 */
function assertArtifactLimit(artifacts) {
  if (artifacts.length > MAXIMUM_ATTESTED_ARTIFACTS) {
    throw new Error(
      `Lockfile selects ${artifacts.length} artifacts; maximum is ${MAXIMUM_ATTESTED_ARTIFACTS}`,
    );
  }
}

/**
 * Reject oversized lockfile text with a transport-independent diagnostic.
 * @param text - Complete UTF-8 lockfile text
 * @param description - Diagnostic source name
 */
function assertLockfileSize(text, description) {
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_LOCKFILE_BYTES) {
    throw new Error(`${description} exceeds maximum size of ${MAXIMUM_LOCKFILE_BYTES} UTF-8 bytes`);
  }
}

/**
 * Cancel a response body without trusting cancellation to settle.
 * @param reader - Active response body reader
 * @param reason - Primary cancellation reason
 */
function cancelBodyRead(reader, reason) {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must not mask the primary failure.
  }
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
 * Return the portable npm CLI invocation supplied by the parent process.
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

/**
 * Run the release-age command-line gate.
 * @returns Completion after all selected artifacts pass
 */
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
  const { baseLock, currentLock } = loadLockfiles(mode);
  const artifacts = selectLockArtifacts(mode, currentLock, baseLock);
  await validateArtifactsConcurrently(artifacts, configuredAge, Date.now());
  const qualifier = mode.mode === "all" ? "lockfile" : "new lockfile";
  console.log(`Verified release age for ${artifacts.length} ${qualifier} artifact(s).`);
}

/**
 * Parse complete JSON text with a contextual diagnostic.
 * @param text - JSON text
 * @param description - Diagnostic source name
 * @returns Parsed JSON value
 */
function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${description} did not return valid JSON`, { cause: error });
  }
}

/**
 * Parse bounded lockfile JSON, including values supplied by injected readers.
 * @param text - Lockfile JSON text
 * @param description - JSON syntax diagnostic source name
 * @param sizeDescription - Size diagnostic source name
 * @returns Parsed lockfile value
 */
function parseLockfileJson(text, description, sizeDescription = description) {
  assertLockfileSize(text, sizeDescription);
  return parseJson(text, description);
}

/**
 * Await an asynchronous operation while honoring the request's complete-operation signal.
 * @param promise - Operation promise
 * @param signal - Combined timeout and caller signal
 * @returns Operation result
 */
function raceWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Read a normal lockfile after a cheap filesystem-size check.
 * @param lockfilePath - Lockfile path
 * @param description - Diagnostic source name
 * @returns Complete UTF-8 lockfile text
 */
function readBoundedLockfile(lockfilePath, description) {
  if (statSync(lockfilePath).size > MAXIMUM_LOCKFILE_BYTES) {
    throw new Error(`${description} exceeds maximum size of ${MAXIMUM_LOCKFILE_BYTES} UTF-8 bytes`);
  }
  return readFileSync(lockfilePath, "utf8");
}

/**
 * Decode one bounded canonical packument response body.
 * @param response - Successful same-origin response
 * @param packageName - Exact npm package name
 * @param signal - Combined timeout and caller signal
 * @returns Parsed response body
 */
async function readPackumentResponse(response, packageName, signal) {
  const contentEncoding = response.headers.get("content-encoding");
  const declaredLength = response.headers.get("content-length");
  const hasDecodedLength =
    contentEncoding === null || contentEncoding.trim().toLowerCase() === "identity";
  if (
    hasDecodedLength &&
    /^\d+$/u.test(declaredLength ?? "") &&
    BigInt(declaredLength) > BigInt(MAXIMUM_PACKUMENT_BYTES)
  ) {
    const error = new Error(
      `npm packument for ${packageName} declared a response body larger than ${MAXIMUM_PACKUMENT_BYTES} bytes`,
    );
    if (response.body) {
      try {
        void response.body.cancel(error).catch(() => undefined);
      } catch {
        // Cancellation is best-effort and must not mask the size failure.
      }
    }
    throw error;
  }
  if (!response.body) {
    throw new Error(`npm packument for ${packageName} did not provide a response body`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const fragments = [];
  let bytesRead = 0;
  let bodyComplete = false;
  try {
    while (true) {
      let result;
      try {
        result = await raceWithAbort(reader.read(), signal);
      } catch (error) {
        cancelBodyRead(reader, error);
        if (signal.aborted) {
          const reason = signal.reason;
          throw reason instanceof Error
            ? reason
            : new Error(String(reason ?? "npm packument request aborted"));
        }
        throw new Error(`Unable to read npm packument response body for ${packageName}`, {
          cause: error,
        });
      }
      if (result.done) {
        bodyComplete = true;
        break;
      }
      if (result.value.byteLength > MAXIMUM_PACKUMENT_BYTES - bytesRead) {
        const error = new Error(
          `npm packument for ${packageName} response body exceeded ${MAXIMUM_PACKUMENT_BYTES} bytes`,
        );
        cancelBodyRead(reader, error);
        throw error;
      }
      bytesRead += result.value.byteLength;
      fragments.push(decoder.decode(result.value, { stream: true }));
    }
    fragments.push(decoder.decode());
  } finally {
    if (bodyComplete) reader.releaseLock();
  }

  let packument;
  try {
    packument = JSON.parse(fragments.join(""));
  } catch (error) {
    throw new Error(`npm packument for ${packageName} did not return valid JSON`, {
      cause: error,
    });
  }
  return packument;
}

/**
 * Reject the first source that cannot be attested against the public registry.
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
 * Run one subprocess synchronously without a shell and require normal success.
 * @param command - Executable name
 * @param args - Separate process arguments
 * @param options - Optional subprocess output bound
 * @returns Standard output
 */
function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  });
  if (result.error) {
    if (result.error.code === "ENOBUFS" && options.oversizedDescription) {
      throw new Error(
        `${options.oversizedDescription} exceeds maximum size of ${MAXIMUM_LOCKFILE_BYTES} UTF-8 bytes`,
      );
    }
    throw new Error(`Unable to run ${command}: ${result.error.message}`);
  }
  if (result.signal !== null) {
    throw new Error(`${command} terminated by signal ${result.signal}`);
  }
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
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
