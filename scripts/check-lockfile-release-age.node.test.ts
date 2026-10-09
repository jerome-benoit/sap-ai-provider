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
  parseCliArguments,
  POLICY_BASE_SHA,
  selectLockArtifacts,
  validateArtifactMetadata,
  validateArtifactsConcurrently,
  validateMinimumReleaseAge,
} from "./check-lockfile-release-age.mjs";

const BASE_SHA = "a".repeat(40);
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

/**
 * Build a minimal fetch response accepted by the checker.
 * @param body - JSON response body or parsing error
 * @param options - Response status and URL overrides
 * @param options.ok - HTTP success state
 * @param options.status - HTTP status code
 * @param options.url - Final response URL
 * @returns Minimal packument response
 */
function response(
  body: unknown,
  options: { ok?: boolean; status?: number; url?: string } = {},
): PackumentResponse {
  return {
    json() {
      return body instanceof Error ? Promise.reject(body) : Promise.resolve(body);
    },
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url ?? REGISTRY,
  };
}

describe("lockfile release-age gate modes", () => {
  it("preserves policy/all/base modes and parses the exact trusted head/base mode", () => {
    expect(POLICY_BASE_SHA).toBe("62cd5dab23e0b8c0faf3b843943013a608318c36");
    expect(parseCliArguments([])).toEqual({
      baseSha: POLICY_BASE_SHA,
      mode: "policy",
    });
    expect(parseCliArguments(["--all"])).toEqual({ mode: "all" });
    expect(parseCliArguments(["--base", BASE_SHA])).toEqual({
      baseSha: BASE_SHA,
      mode: "differential",
    });
    expect(parseCliArguments(["--head", HEAD_SHA, "--base", BASE_SHA])).toEqual({
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      mode: "trusted",
    });
  });

  it("rejects ambiguous, reordered, short, or malformed SHA arguments", () => {
    for (const args of [
      ["--base"],
      ["--base", "abc"],
      ["--head", HEAD_SHA],
      ["--base", BASE_SHA, "--head", HEAD_SHA],
      ["--head", "abc", "--base", BASE_SHA],
      ["--head", HEAD_SHA, "--base", "abc"],
      ["--head", HEAD_SHA, "--base", BASE_SHA, "extra"],
      ["--all", "extra"],
    ]) {
      expect(() => parseCliArguments(args)).toThrow("Usage:");
    }
  });

  it("loads both trusted revisions only through exact git object names", () => {
    const shown: string[] = [];
    const current = lock({ "node_modules/example": artifactEntry("2.0.0") });
    const base = lock({});
    const loaded = loadLockfiles(
      { baseSha: BASE_SHA, headSha: HEAD_SHA, mode: "trusted" },
      () => {
        throw new Error("working tree must not be read");
      },
      (objectName) => {
        shown.push(objectName);
        return JSON.stringify(objectName.startsWith(HEAD_SHA) ? current : base);
      },
    );
    expect(shown).toEqual([`${HEAD_SHA}:package-lock.json`, `${BASE_SHA}:package-lock.json`]);
    expect(loaded).toEqual({ baseLock: base, currentLock: current });
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
        Promise.resolve(response(new SyntaxError("bad json"), { url: `${REGISTRY}example` })),
      ),
    ).rejects.toThrow("valid JSON");
    await expect(
      fetchPackagePackument("example", () =>
        Promise.resolve(response({}, { url: "https://packages.example.test/example" })),
      ),
    ).rejects.toThrow("response origin changed");
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
