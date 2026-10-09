import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  LockArtifact,
  PackumentFetch,
  PackumentResponse,
} from "./check-lockfile-release-age.mjs";

import {
  extractLockArtifacts,
  fetchPackagePackument,
  findAllLockArtifacts,
  findNewLockArtifacts,
  loadLockfiles,
  MAXIMUM_ATTESTED_ARTIFACTS,
  MAXIMUM_LOCKFILE_BYTES,
  MAXIMUM_PACKUMENT_BYTES,
  parseCliArguments,
  POLICY_BASE_SHA,
  selectLockArtifacts,
  validateArtifactMetadata,
  validateArtifactsConcurrently,
  validateMinimumReleaseAge,
} from "./check-lockfile-release-age.mjs";

const BASE_LOCKFILE_PATH = "/tmp/base-package-lock.json";
const BASE_SHA = "a".repeat(40);
const HEAD_LOCKFILE_PATH = "/tmp/head-package-lock.json";
const HEAD_SHA = "b".repeat(40);
const NOW = Date.parse("2026-10-09T00:00:00.000Z");
const OLD_DATE = "2026-09-01T00:00:00.000Z";
const REGISTRY = "https://registry.npmjs.org/";

/** Mutable packument fixture. */
interface PackumentFixture {
  time: Record<string, string>;
  versions: Record<string, PackumentManifest>;
}

/** Mutable version-manifest fixture. */
interface PackumentManifest {
  dist: { integrity: string; tarball: null | string };
  name: string;
  time?: string;
  version: string;
}

interface PackumentResponseOptions {
  contentEncoding?: string;
  contentLength?: string;
  ok?: boolean;
  status?: number;
  url?: string;
}

/**
 * Build one exact registry artifact lock entry.
 * @param version - Exact package version
 * @param name - Real package name
 * @returns Registry lock entry
 */
function artifactEntry(version: string, name = "example"): LockArtifact {
  const packageFileName = name.split("/").at(-1);
  if (!packageFileName) throw new Error("Invalid test package name");
  return {
    inBundle: false,
    integrity: `sha512-${version}`,
    name,
    resolved: `${REGISTRY}${name}/-/${packageFileName}-${version}.tgz`,
    version,
  };
}

/**
 * Require a successful local Git command in a temporary regression repository.
 * @param cwd - Repository directory
 * @param args - Git arguments
 * @returns Standard output
 */
function git(cwd: string, args: string[]): string {
  const env = { ...process.env };
  for (const variable of gitLocalEnvironmentVariables()) Reflect.deleteProperty(env, variable);
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      stderr !== ""
        ? stderr
        : (result.error?.message ??
            `git failed with status ${String(result.status ?? "unknown")}${result.signal ? ` and signal ${result.signal}` : ""}`),
    );
  }
  return result.stdout;
}

/**
 * List environment variables that Git treats as repository-local.
 * @returns Git-local environment variable names
 */
function gitLocalEnvironmentVariables(): string[] {
  const result = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      stderr !== ""
        ? stderr
        : (result.error?.message ??
            `git rev-parse failed with status ${String(result.status ?? "unknown")}${result.signal ? ` and signal ${result.signal}` : ""}`),
    );
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

/**
 * Build a package-lock.json v3 fixture.
 * @param packages - Lockfile package entries
 * @returns Package-lock.json v3 fixture
 */
function lock(packages: Record<string, unknown>) {
  return { lockfileVersion: 3, packages: { "": {}, ...packages } };
}

/**
 * Build a complete canonical packument for exact artifacts.
 * @param artifacts - Exact package artifacts
 * @returns Complete packument fixture
 */
function packument(...artifacts: LockArtifact[]): PackumentFixture {
  return {
    time: Object.fromEntries(artifacts.map((artifact) => [artifact.version, OLD_DATE])),
    versions: Object.fromEntries(
      artifacts.map((artifact) => [
        artifact.version,
        {
          dist: { integrity: artifact.integrity, tarball: artifact.resolved },
          name: artifact.name,
          version: artifact.version,
        },
      ]),
    ),
  };
}

/**
 * Remove Git-local variables from this process and return an exact restorer.
 * @returns Function restoring every original environment value
 */
function removeGitLocalEnvironment(): () => void {
  const snapshot = gitLocalEnvironmentVariables().map((name) => ({
    name,
    value: process.env[name],
  }));
  for (const { name } of snapshot) Reflect.deleteProperty(process.env, name);
  return () => {
    for (const { name, value } of snapshot) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  };
}

/**
 * Require one exact manifest from a packument fixture.
 * @param metadata - Packument fixture
 * @param version - Exact package version
 * @returns Present manifest fixture
 */
function requireManifest(metadata: PackumentFixture, version: string): PackumentManifest {
  const manifest = metadata.versions[version];
  if (!manifest) throw new Error(`Missing test manifest ${version}`);
  return manifest;
}

const TEXT_ENCODER = new TextEncoder();

/**
 * Build a response whose body emits exact byte chunks.
 * @param chunks - Decoded response byte chunks
 * @param options - Response status, URL, and header overrides
 * @returns Minimal packument response
 */
function chunkedResponse(
  chunks: readonly Uint8Array[],
  options: PackumentResponseOptions = {},
): PackumentResponse {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return streamResponse(body, options);
}

/**
 * Build a minimal JSON fetch response accepted by the checker.
 * @param value - JSON response value
 * @param options - Response status, URL, and header overrides
 * @returns Minimal packument response
 */
function response(value: unknown, options: PackumentResponseOptions = {}): PackumentResponse {
  return textResponse(JSON.stringify(value), options);
}

/**
 * Build valid lockfile JSON with an exact UTF-8 byte length.
 * @param byteLength - Required UTF-8 byte length
 * @param includeMultibyte - Whether to include a multibyte character
 * @returns Exact-sized lockfile JSON
 */
function sizedLockfile(byteLength: number, includeMultibyte = false): string {
  const prefix = '{"lockfileVersion":3,"packages":{},"padding":"';
  const suffix = '"}';
  const multibyte = includeMultibyte ? "é" : "";
  const paddingBytes = byteLength - Buffer.byteLength(prefix + multibyte + suffix);
  if (paddingBytes < 0) throw new Error("Requested lockfile fixture is too small");
  const text = prefix + multibyte + "a".repeat(paddingBytes) + suffix;
  if (Buffer.byteLength(text) !== byteLength) {
    throw new Error("Incorrect fixture byte length");
  }
  return text;
}

/**
 * Build a minimal response around an exact Web stream.
 * @param body - Decoded response stream
 * @param options - Response status, URL, and header overrides
 * @returns Minimal packument response
 */
function streamResponse(
  body: null | ReadableStream<Uint8Array>,
  options: PackumentResponseOptions = {},
): PackumentResponse {
  const headers = new Headers();
  if (options.contentEncoding !== undefined) {
    headers.set("content-encoding", options.contentEncoding);
  }
  if (options.contentLength !== undefined) headers.set("content-length", options.contentLength);
  return {
    body,
    headers,
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url ?? REGISTRY,
  };
}

/**
 * Build a streamed UTF-8 text response.
 * @param body - Raw response text
 * @param options - Response status, URL, and header overrides
 * @returns Minimal packument response
 */
function textResponse(body: string, options: PackumentResponseOptions = {}): PackumentResponse {
  return chunkedResponse([TEXT_ENCODER.encode(body)], options);
}

describe("lockfile release-age gate modes", () => {
  it("preserves policy/all/base modes and parses the data-only trusted mode", () => {
    expect(POLICY_BASE_SHA).toBe("3f869c5f5371b35e53ef38bae2173541ab6c209a");
    expect(parseCliArguments([])).toEqual({
      baseSha: POLICY_BASE_SHA,
      mode: "policy",
    });
    expect(parseCliArguments(["--all"])).toEqual({ mode: "all" });
    expect(parseCliArguments(["--base", BASE_SHA])).toEqual({
      baseSha: BASE_SHA,
      mode: "differential",
    });
    expect(
      parseCliArguments([
        "--head-lockfile",
        HEAD_LOCKFILE_PATH,
        "--base-lockfile",
        BASE_LOCKFILE_PATH,
      ]),
    ).toEqual({
      baseLockfilePath: BASE_LOCKFILE_PATH,
      headLockfilePath: HEAD_LOCKFILE_PATH,
      mode: "trusted-files",
    });
  });

  it("rejects ambiguous, reordered, incomplete, or legacy trusted arguments", () => {
    for (const args of [
      ["--base"],
      ["--base", "abc"],
      ["--head", HEAD_SHA, "--base", BASE_SHA],
      ["--head-lockfile", HEAD_LOCKFILE_PATH],
      ["--base-lockfile", BASE_LOCKFILE_PATH, "--head-lockfile", HEAD_LOCKFILE_PATH],
      ["--head-lockfile", "", "--base-lockfile", BASE_LOCKFILE_PATH],
      ["--head-lockfile", HEAD_LOCKFILE_PATH, "--base-lockfile", ""],
      ["--head-lockfile", HEAD_LOCKFILE_PATH, "--base-lockfile", HEAD_LOCKFILE_PATH],
      ["--head-lockfile", HEAD_LOCKFILE_PATH, "--base-lockfile", BASE_LOCKFILE_PATH, "extra"],
      ["--all", "extra"],
    ]) {
      expect(() => parseCliArguments(args)).toThrow("Usage:");
    }
  });

  it("loads trusted revisions only from the selected data files", () => {
    const readPaths: string[] = [];
    const current = lock({ "node_modules/example": artifactEntry("2.0.0") });
    const base = lock({});
    const loaded = loadLockfiles(
      {
        baseLockfilePath: BASE_LOCKFILE_PATH,
        headLockfilePath: HEAD_LOCKFILE_PATH,
        mode: "trusted-files",
      },
      () => {
        throw new Error("working tree must not be read");
      },
      (lockfilePath) => {
        readPaths.push(lockfilePath);
        return JSON.stringify(lockfilePath === HEAD_LOCKFILE_PATH ? current : base);
      },
      () => {
        throw new Error("Git objects must not be read");
      },
    );
    expect(readPaths).toEqual([HEAD_LOCKFILE_PATH, BASE_LOCKFILE_PATH]);
    expect(loaded).toEqual({ baseLock: base, currentLock: current });
  });

  it("fails closed when a trusted lockfile data file is not JSON", () => {
    expect(() =>
      loadLockfiles(
        {
          baseLockfilePath: BASE_LOCKFILE_PATH,
          headLockfilePath: HEAD_LOCKFILE_PATH,
          mode: "trusted-files",
        },
        () => {
          throw new Error("working tree must not be read");
        },
        (lockfilePath) =>
          lockfilePath === HEAD_LOCKFILE_PATH ? "not-json" : JSON.stringify(lock({})),
        () => {
          throw new Error("Git objects must not be read");
        },
      ),
    ).toThrow("Head package-lock.json data file did not return valid JSON");
  });

  it("prevents a follow-up commit from laundering an artifact past the policy baseline", () => {
    const policyBase = lock({});
    const introduced = lock({ "node_modules/example": artifactEntry("2.0.0") });
    const unchangedFollowUp = structuredClone(introduced);
    expect(
      selectLockArtifacts(
        { baseSha: BASE_SHA, mode: "differential" },
        unchangedFollowUp,
        introduced,
      ),
    ).toEqual([]);
    expect(selectLockArtifacts(parseCliArguments([]), unchangedFollowUp, policyBase)).toMatchObject(
      [{ name: "example", version: "2.0.0" }],
    );
  });
});

describe("lockfile artifact extraction", () => {
  it("attests complete bundled children and deduplicates moved artifacts", () => {
    const bundled = { ...artifactEntry("1.0.0", "bundled"), inBundle: true };
    expect(
      extractLockArtifacts(lock({ "node_modules/parent/node_modules/bundled": bundled })),
    ).toEqual({ artifacts: [bundled], remoteSources: [] });
    expect(
      findAllLockArtifacts(
        lock({
          "node_modules/bundled": bundled,
          "node_modules/parent/node_modules/bundled": bundled,
        }),
      ),
    ).toHaveLength(1);
    expect(
      findNewLockArtifacts(
        lock({ "node_modules/parent/node_modules/bundled": bundled }),
        lock({ "node_modules/bundled": bundled }),
      ),
    ).toEqual([]);
  });

  it("fails closed for incomplete bundled or remote sources", () => {
    expect(() =>
      findAllLockArtifacts(
        lock({
          "node_modules/parent/node_modules/bundled": {
            inBundle: true,
            name: "bundled",
            version: "1.0.0",
          },
        }),
      ),
    ).toThrow("cannot be attested");
    expect(() =>
      findNewLockArtifacts(
        lock({}),
        lock({
          "node_modules/example": {
            resolved: "git+https://github.com/example/project.git",
            version: "1.0.0",
          },
        }),
      ),
    ).toThrow("cannot be attested");
  });

  it("rejects changed fingerprints and registry origins", () => {
    const base = lock({ "node_modules/example": artifactEntry("1.0.0") });
    expect(() =>
      findNewLockArtifacts(
        base,
        lock({
          "node_modules/example": {
            ...artifactEntry("1.0.0"),
            integrity: "sha512-changed",
          },
        }),
      ),
    ).toThrow("fingerprint changed");
    expect(() =>
      findNewLockArtifacts(
        lock({}),
        lock({
          "node_modules/example": {
            ...artifactEntry("1.0.0"),
            resolved: "https://packages.example.test/example-1.0.0.tgz",
          },
        }),
      ),
    ).toThrow("cannot be attested");
  });

  it("infers scoped names from exact nested paths", () => {
    const scoped = {
      inBundle: false,
      integrity: "sha512-1.0.0",
      resolved: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz",
      version: "1.0.0",
    };
    expect(
      extractLockArtifacts(lock({ "node_modules/parent/node_modules/@scope/pkg": scoped }))
        .artifacts[0]?.name,
    ).toBe("@scope/pkg");
  });
});

describe("release-age resource contracts", () => {
  it("accepts 1024 selected artifacts and rejects 1025 before registry access", async () => {
    const packages = Object.fromEntries(
      Array.from({ length: MAXIMUM_ATTESTED_ARTIFACTS }, (_, index) => [
        `node_modules/package-${String(index)}`,
        artifactEntry("1.0.0", `package-${String(index)}`),
      ]),
    );
    expect(selectLockArtifacts({ mode: "all" }, lock(packages))).toHaveLength(
      MAXIMUM_ATTESTED_ARTIFACTS,
    );
    const oversizedPackages = {
      ...packages,
      [`node_modules/package-${String(MAXIMUM_ATTESTED_ARTIFACTS)}`]: artifactEntry(
        "1.0.0",
        `package-${String(MAXIMUM_ATTESTED_ARTIFACTS)}`,
      ),
    };
    expect(() => selectLockArtifacts({ mode: "all" }, lock(oversizedPackages))).toThrow(
      "maximum is 1024",
    );
    const oversized = Array.from({ length: MAXIMUM_ATTESTED_ARTIFACTS + 1 }, (_, index) =>
      artifactEntry("1.0.0", `package-${String(index)}`),
    );
    const fetchMock = vi.fn<PackumentFetch>();
    await expect(validateArtifactsConcurrently(oversized, 3, NOW, fetchMock)).rejects.toThrow(
      "maximum is 1024",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops after the first request batch and aborts its in-flight requests", async () => {
    const signals: AbortSignal[] = [];
    const artifacts = Array.from({ length: 9 }, (_, index) =>
      artifactEntry("1.0.0", `package-${String(index)}`),
    );
    const fetchMock = vi.fn<PackumentFetch>((_input, init) => {
      signals.push(init.signal);
      if (signals.length === 1) return Promise.reject(new Error("primary registry failure"));
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            const reason: unknown = init.signal.reason as unknown;
            reject(reason instanceof Error ? reason : new Error("request aborted"));
          },
          { once: true },
        );
      });
    });
    await expect(validateArtifactsConcurrently(artifacts, 3, NOW, fetchMock)).rejects.toThrow(
      "primary registry failure",
    );
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(signals).toHaveLength(8);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("preserves the first metadata failure while aborting the initial batch", async () => {
    const signals: AbortSignal[] = [];
    const artifacts = Array.from({ length: 9 }, (_, index) =>
      artifactEntry("1.0.0", `metadata-package-${String(index)}`),
    );
    const fetchMock = vi.fn<PackumentFetch>((input, init) => {
      signals.push(init.signal);
      if (signals.length === 1) {
        return Promise.resolve(response({}, { url: input.toString() }));
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            const reason: unknown = init.signal.reason as unknown;
            reject(reason instanceof Error ? reason : new Error("request aborted"));
          },
          { once: true },
        );
      });
    });
    await expect(validateArtifactsConcurrently(artifacts, 3, NOW, fetchMock)).rejects.toThrow(
      "Incomplete npm packument",
    );
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("enforces exact UTF-8 byte boundaries for injected readers", () => {
    const exact = sizedLockfile(MAXIMUM_LOCKFILE_BYTES, true);
    expect(loadLockfiles({ mode: "all" }, () => exact).currentLock).toMatchObject({
      lockfileVersion: 3,
      packages: {},
    });
    expect(() =>
      loadLockfiles({ mode: "all" }, () => sizedLockfile(MAXIMUM_LOCKFILE_BYTES + 1, true)),
    ).toThrow(
      `Current package-lock.json exceeds maximum size of ${String(MAXIMUM_LOCKFILE_BYTES)} UTF-8 bytes`,
    );
  });

  it("uses the same oversized diagnostic for file, injected, and Git-object transports", () => {
    const directory = mkdtempSync(join(tmpdir(), "lockfile-size-"));
    const previousCwd = process.cwd();
    let restoreGitEnvironment: (() => void) | undefined;
    const diagnostic = `Base package-lock.json exceeds maximum size of ${String(MAXIMUM_LOCKFILE_BYTES)} UTF-8 bytes`;
    try {
      git(directory, ["init", "--quiet"]);
      git(directory, ["config", "user.email", "test@example.invalid"]);
      git(directory, ["config", "user.name", "Test"]);
      git(directory, ["config", "commit.gpgsign", "false"]);
      writeFileSync(
        join(directory, "package-lock.json"),
        sizedLockfile(MAXIMUM_LOCKFILE_BYTES + 1),
      );
      git(directory, ["add", "package-lock.json"]);
      git(directory, ["commit", "--no-verify", "--quiet", "-m", "oversized lockfile"]);
      const sha = git(directory, ["rev-parse", "HEAD"]).trim();
      writeFileSync(join(directory, "package-lock.json"), JSON.stringify(lock({})));
      restoreGitEnvironment = removeGitLocalEnvironment();
      process.chdir(directory);
      expect(() => loadLockfiles({ baseSha: sha, mode: "differential" })).toThrow(diagnostic);
      const basePath = join(directory, "base-lock.json");
      writeFileSync(basePath, sizedLockfile(MAXIMUM_LOCKFILE_BYTES + 1));
      expect(() =>
        loadLockfiles({
          baseLockfilePath: basePath,
          headLockfilePath: join(directory, "package-lock.json"),
          mode: "trusted-files",
        }),
      ).toThrow(diagnostic);
      expect(() =>
        loadLockfiles(
          {
            baseLockfilePath: join(directory, "base-lock.json"),
            headLockfilePath: join(directory, "package-lock.json"),
            mode: "trusted-files",
          },
          undefined,
          (_path, description) =>
            description.startsWith("Base")
              ? sizedLockfile(MAXIMUM_LOCKFILE_BYTES + 1)
              : JSON.stringify(lock({})),
        ),
      ).toThrow(diagnostic);
    } finally {
      process.chdir(previousCwd);
      restoreGitEnvironment?.();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("reads a real approximately 1.2 MiB Git base lockfile", () => {
    const directory = mkdtempSync(join(tmpdir(), "lockfile-git-buffer-"));
    const previousCwd = process.cwd();
    let restoreGitEnvironment: (() => void) | undefined;
    try {
      git(directory, ["init", "--quiet"]);
      git(directory, ["config", "user.email", "test@example.invalid"]);
      git(directory, ["config", "user.name", "Test"]);
      git(directory, ["config", "commit.gpgsign", "false"]);
      writeFileSync(join(directory, "package-lock.json"), sizedLockfile(1_200_000));
      git(directory, ["add", "package-lock.json"]);
      git(directory, ["commit", "--no-verify", "--quiet", "-m", "large valid lockfile"]);
      const sha = git(directory, ["rev-parse", "HEAD"]).trim();
      restoreGitEnvironment = removeGitLocalEnvironment();
      process.chdir(directory);
      expect(loadLockfiles({ baseSha: sha, mode: "differential" }).baseLock).toMatchObject({
        lockfileVersion: 3,
      });
    } finally {
      process.chdir(previousCwd);
      restoreGitEnvironment?.();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("accepts the exact packument byte limit and rejects the next byte", async () => {
    const prefix = '{"padding":"';
    const suffix = '"}';
    const paddingLength =
      MAXIMUM_PACKUMENT_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
    const exactBody = prefix + "a".repeat(paddingLength) + suffix;
    const exact = await fetchPackagePackument("example", () =>
      Promise.resolve(
        textResponse(exactBody, {
          contentLength: String(MAXIMUM_PACKUMENT_BYTES),
          url: `${REGISTRY}example`,
        }),
      ),
    );
    expect(typeof exact.padding).toBe("string");
    expect((exact.padding as string).length).toBe(paddingLength);

    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(
          chunkedResponse([new Uint8Array(MAXIMUM_PACKUMENT_BYTES + 1)], {
            contentLength: String(MAXIMUM_PACKUMENT_BYTES),
            url: `${REGISTRY}example`,
          }),
        ),
      ),
    ).rejects.toThrow(`response body exceeded ${String(MAXIMUM_PACKUMENT_BYTES)} bytes`);
  }, 15_000);

  it("rejects a declared oversized packument before reading its body", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const getReader = vi.fn();
    const body = { cancel, getReader } as unknown as ReadableStream<Uint8Array>;
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(
          streamResponse(body, {
            contentLength: String(MAXIMUM_PACKUMENT_BYTES + 1),
            url: `${REGISTRY}example`,
          }),
        ),
      ),
    ).rejects.toThrow(`response body larger than ${String(MAXIMUM_PACKUMENT_BYTES)} bytes`);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses streamed bytes for content-encoded responses", async () => {
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(
          response(
            {},
            {
              contentEncoding: "gzip",
              contentLength: String(MAXIMUM_PACKUMENT_BYTES + 1),
              url: `${REGISTRY}example`,
            },
          ),
        ),
      ),
    ).resolves.toEqual({});
  });

  it("times out both the request and packument body read", async () => {
    vi.useFakeTimers();
    try {
      const fetchRequest = fetchPackagePackument(
        "example",
        () => new Promise<PackumentResponse>(() => undefined),
      );
      const fetchExpectation = expect(fetchRequest).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await fetchExpectation;

      const bodyRequest = fetchPackagePackument("example", () =>
        Promise.resolve(
          streamResponse(
            new ReadableStream<Uint8Array>({
              pull: () => new Promise<void>(() => undefined),
            }),
            { url: `${REGISTRY}example` },
          ),
        ),
      );
      const bodyExpectation = expect(bodyRequest).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await bodyExpectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an external abort reason during a stalled body read", async () => {
    let markReading: (() => void) | undefined;
    const reading = new Promise<void>((resolve) => {
      markReading = resolve;
    });
    const cancel = vi.fn();
    const controller = new AbortController();
    const request = fetchPackagePackument(
      "example",
      () =>
        Promise.resolve(
          streamResponse(
            new ReadableStream<Uint8Array>({
              cancel,
              pull() {
                markReading?.();
                return new Promise<void>(() => undefined);
              },
            }),
            { url: `${REGISTRY}example` },
          ),
        ),
      controller.signal,
    );
    await reading;
    const reason = new Error("caller stopped metadata validation");
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("canonical npm packument validation", () => {
  it("uses only top-level packument time even when a manifest time contradicts it", () => {
    const artifact = artifactEntry("2.0.0");
    const metadata = packument(artifact);
    metadata.versions[artifact.version] = {
      ...requireManifest(metadata, artifact.version),
      time: "2026-10-08T00:00:00.000Z",
    };
    expect(() => {
      validateArtifactMetadata(artifact, metadata, 3, NOW);
    }).not.toThrow();
  });

  it("rejects a recent top-level time even when manifest time is old", () => {
    const artifact = artifactEntry("2.0.0");
    const metadata = packument(artifact);
    metadata.time[artifact.version] = "2026-10-08T00:00:00.000Z";
    metadata.versions[artifact.version] = {
      ...requireManifest(metadata, artifact.version),
      time: OLD_DATE,
    };
    expect(() => {
      validateArtifactMetadata(artifact, metadata, 3, NOW);
    }).toThrow("newer than");
  });

  it("rejects manifest name, version, integrity, and tarball divergence", () => {
    const artifact = artifactEntry("2.0.0");
    const canonical = packument(artifact);
    const manifest = requireManifest(canonical, artifact.version);
    for (const divergentManifest of [
      { ...manifest, name: "other" },
      { ...manifest, version: "2.0.1" },
      {
        ...manifest,
        dist: { integrity: "sha512-other", tarball: artifact.resolved },
      },
      {
        ...manifest,
        dist: {
          integrity: artifact.integrity,
          tarball: `${REGISTRY}other.tgz`,
        },
      },
    ]) {
      const metadata = packument(artifact);
      metadata.versions[artifact.version] = divergentManifest;
      expect(() => {
        validateArtifactMetadata(artifact, metadata, 3, NOW);
      }).toThrow();
    }
  });

  it("rejects incomplete, invalid, and too-recent top-level timestamps", () => {
    const artifact = artifactEntry("2.0.0");
    const incomplete = packument(artifact);
    incomplete.time = {};
    expect(() => {
      validateArtifactMetadata(artifact, incomplete, 3, NOW);
    }).toThrow("Incomplete");
    const invalid = packument(artifact);
    invalid.time[artifact.version] = "not-a-date";
    expect(() => {
      validateArtifactMetadata(artifact, invalid, 3, NOW);
    }).toThrow("Invalid publication");
    const recent = packument(artifact);
    recent.time[artifact.version] = "2026-10-08T00:00:00.000Z";
    expect(() => {
      validateArtifactMetadata(artifact, recent, 3, NOW);
    }).toThrow("newer than");
  });

  it("decodes chunked UTF-8 without a Content-Length header", async () => {
    const artifact = artifactEntry("1.0.0");
    const metadata = { ...packument(artifact), label: "café" };
    const encoded = TEXT_ENCODER.encode(JSON.stringify(metadata));
    const split = encoded.indexOf(0xc3) + 1;
    expect(split).toBeGreaterThan(0);
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(
          chunkedResponse([encoded.subarray(0, split), encoded.subarray(split)], {
            url: `${REGISTRY}example`,
          }),
        ),
      ),
    ).resolves.toEqual(metadata);
  });
  it("URL-encodes scoped names and rejects HTTP, JSON, and off-origin responses", async () => {
    const artifact = artifactEntry("1.0.0", "@scope/pkg");
    const requests: string[] = [];
    const successfulFetch: PackumentFetch = (input, init) => {
      requests.push(input.toString());
      expect(init.redirect).toBe("error");
      return Promise.resolve(response(packument(artifact), { url: input.toString() }));
    };
    await expect(fetchPackagePackument("@scope/pkg", successfulFetch)).resolves.toEqual(
      packument(artifact),
    );
    expect(requests).toEqual(["https://registry.npmjs.org/%40scope%2Fpkg"]);

    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(response({}, { ok: false, status: 503, url: `${REGISTRY}example` })),
      ),
    ).rejects.toThrow("HTTP 503");
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(textResponse("{", { url: `${REGISTRY}example` })),
      ),
    ).rejects.toThrow("valid JSON");
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(response({}, { url: "https://packages.example.test/example" })),
      ),
    ).rejects.toThrow("response origin changed");
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(
          streamResponse(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error("body transport failed"));
              },
            }),
            { url: `${REGISTRY}example` },
          ),
        ),
      ),
    ).rejects.toThrow("Unable to read npm packument response body");
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(textResponse("[]", { url: `${REGISTRY}example` })),
      ),
    ).rejects.toThrow("did not return a JSON object");
  });

  it("fetches one packument per package while validating multiple exact versions", async () => {
    const artifacts = [artifactEntry("1.0.0"), artifactEntry("2.0.0")];
    const fetchMock = vi.fn<PackumentFetch>((input) =>
      Promise.resolve(response(packument(...artifacts), { url: input.toString() })),
    );
    await validateArtifactsConcurrently(artifacts, 3, NOW, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires the exact repository minimum release-age configuration", () => {
    expect(() => validateMinimumReleaseAge(2)).toThrow("must equal repository policy 3 days");
    expect(validateMinimumReleaseAge(3)).toBe(3);
  });
});
