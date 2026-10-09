import { describe, expect, it } from "vitest";

import {
  extractLockArtifacts,
  findAllLockArtifacts,
  findNewLockArtifacts,
  parseCliArguments,
  POLICY_BASE_SHA,
  selectLockArtifacts,
  validateArtifactMetadata,
  validateMinimumReleaseAge,
} from "./check-lockfile-release-age.mjs";

const BASE_SHA = "a".repeat(40);
const OLD_DATE = "2026-09-01T00:00:00.000Z";
const NOW = Date.parse("2026-10-09T00:00:00.000Z");

/**
 * Build one registry artifact lock entry.
 * @param version - Exact package version
 * @param name - Real package name
 * @returns Registry lock entry
 */
function artifactEntry(version: string, name: string) {
  return {
    inBundle: false,
    integrity: `sha512-${version}`,
    name,
    resolved: `https://registry.npmjs.org/example/-/example-${version}.tgz`,
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
 * Require an indexed fixture value.
 * @param value - Possibly absent indexed value
 * @returns Present fixture value
 */
function requireFixtureValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Invalid test fixture");
  return value;
}

describe("lockfile release-age gate modes", () => {
  it("defaults to the cumulative policy baseline and accepts explicit modes", () => {
    expect(POLICY_BASE_SHA).toBe("62cd5dab23e0b8c0faf3b843943013a608318c36");
    expect(parseCliArguments([])).toEqual({ baseSha: POLICY_BASE_SHA, mode: "policy" });
    expect(parseCliArguments(["--all"])).toEqual({ mode: "all" });
    expect(parseCliArguments(["--base", BASE_SHA])).toEqual({
      baseSha: BASE_SHA,
      mode: "differential",
    });
  });

  it("rejects ambiguous or malformed arguments", () => {
    for (const args of [
      ["--base"],
      [BASE_SHA],
      ["--base", "abc"],
      ["--base", BASE_SHA, "extra"],
      ["--all", "extra"],
      ["--unknown", BASE_SHA],
    ]) {
      expect(() => parseCliArguments(args)).toThrow("Usage:");
    }
  });

  it("prevents a follow-up commit from laundering an artifact past the policy baseline", () => {
    const policyBase = lock({});
    const introduced = lock({
      "node_modules/example": artifactEntry("2.0.0", "example"),
    });
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
  it("attests a complete bundled child as a normal registry artifact", () => {
    const bundled = { ...artifactEntry("1.0.0", "bundled"), inBundle: true };
    expect(
      extractLockArtifacts(lock({ "node_modules/parent/node_modules/bundled": bundled })),
    ).toEqual({
      artifacts: [bundled],
      remoteSources: [],
    });
  });

  it("rejects an incomplete bundled child in complete mode", () => {
    const current = lock({
      "node_modules/parent/node_modules/bundled": {
        inBundle: true,
        name: "bundled",
        version: "1.0.0",
      },
    });
    expect(() => findAllLockArtifacts(current)).toThrow("cannot be attested");
  });

  it("rejects a newly introduced incomplete bundled child in differential mode", () => {
    const current = lock({
      "node_modules/parent/node_modules/bundled": {
        inBundle: true,
        name: "bundled",
        version: "1.0.0",
      },
    });
    expect(() => findNewLockArtifacts(lock({}), current)).toThrow("cannot be attested");
  });

  it("detects a transition into bundled state as a fingerprint change", () => {
    const base = lock({ "node_modules/example": artifactEntry("1.0.0", "example") });
    const current = lock({
      "node_modules/example": {
        ...artifactEntry("1.0.0", "example"),
        inBundle: true,
      },
    });
    expect(() => findNewLockArtifacts(base, current)).toThrow("fingerprint changed");
  });

  it("ignores an unchanged artifact moved by deduplication", () => {
    const entry = artifactEntry("1.0.0", "example");
    const base = lock({ "node_modules/parent/node_modules/example": entry });
    const current = lock({ "node_modules/example": entry });
    expect(findNewLockArtifacts(base, current)).toEqual([]);
  });

  it("deduplicates identical artifacts in complete mode", () => {
    const entry = artifactEntry("1.0.0", "example");
    const current = lock({
      "node_modules/example": entry,
      "node_modules/parent/node_modules/example": entry,
    });
    expect(findAllLockArtifacts(current)).toHaveLength(1);
  });

  it("rejects a newly omitted resolved URL as unattestable", () => {
    const entry = artifactEntry("1.0.0", "example");
    const { resolved: _resolved, ...withoutResolved } = entry;
    const base = lock({ "node_modules/example": entry });
    const current = lock({ "node_modules/example": withoutResolved });
    expect(() => findNewLockArtifacts(base, current)).toThrow("cannot be attested");
  });

  it("accepts metadata for a sufficiently old new version", () => {
    const artifact = artifactEntry("2.0.0", "example");
    expect(() => {
      validateArtifactMetadata(
        artifact,
        {
          "dist.integrity": artifact.integrity,
          "dist.tarball": artifact.resolved,
          time: { "2.0.0": OLD_DATE },
        },
        3,
        NOW,
      );
    }).not.toThrow();
  });

  it("rejects a new registry entry with no resolved URL", () => {
    const entry = artifactEntry("2.0.0", "example");
    const { resolved: _resolved, ...withoutResolved } = entry;
    const current = lock({ "node_modules/example": withoutResolved });
    expect(() => findNewLockArtifacts(lock({}), current)).toThrow("cannot be attested");
  });

  it("rejects a version that is too recent", () => {
    const artifact = artifactEntry("2.0.0", "example");
    expect(() => {
      validateArtifactMetadata(
        artifact,
        {
          dist: { integrity: artifact.integrity, tarball: artifact.resolved },
          time: { "2.0.0": "2026-10-08T00:00:00.000Z" },
        },
        3,
        NOW,
      );
    }).toThrow("newer than");
  });

  it("treats a non-monotone exact version change as new", () => {
    const base = lock({ "node_modules/example": artifactEntry("2.0.0", "example") });
    const current = lock({ "node_modules/example": artifactEntry("1.5.0", "example") });
    expect(findNewLockArtifacts(base, current)).toMatchObject([
      { name: "example", version: "1.5.0" },
    ]);
  });

  it("infers scoped names from nested node_modules paths", () => {
    const scoped = {
      inBundle: false,
      integrity: "sha512-1.0.0",
      resolved: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz",
      version: "1.0.0",
    };
    expect(
      requireFixtureValue(
        extractLockArtifacts(lock({ "node_modules/parent/node_modules/@scope/pkg": scoped }))
          .artifacts[0],
      ).name,
    ).toBe("@scope/pkg");
  });

  it("rejects an HTTP artifact outside the approved registry origin", () => {
    const current = lock({
      "node_modules/example": {
        ...artifactEntry("1.0.0", "example"),
        resolved: "https://packages.example.test/example-1.0.0.tgz",
      },
    });
    expect(() => findNewLockArtifacts(lock({}), current)).toThrow("cannot be attested");
  });

  it("rejects a newly introduced unattestable remote source", () => {
    const base = lock({});
    const current = lock({
      "node_modules/example": {
        resolved: "git+https://github.com/example/project.git",
        version: "1.0.0",
      },
    });
    expect(() => findNewLockArtifacts(base, current)).toThrow("cannot be attested");
  });

  it("rejects a changed integrity for an existing name and version", () => {
    const base = lock({ "node_modules/example": artifactEntry("1.0.0", "example") });
    const current = lock({
      "node_modules/example": { ...artifactEntry("1.0.0", "example"), integrity: "sha512-changed" },
    });
    expect(() => findNewLockArtifacts(base, current)).toThrow("fingerprint changed");
  });

  it("rejects registry metadata with mismatched integrity", () => {
    const artifact = artifactEntry("2.0.0", "example");
    expect(() => {
      validateArtifactMetadata(
        artifact,
        {
          "dist.integrity": "sha512-different",
          "dist.tarball": artifact.resolved,
          time: { "2.0.0": OLD_DATE },
        },
        3,
        NOW,
      );
    }).toThrow("fingerprint mismatch");
  });

  it("rejects release-age configuration below repository policy", () => {
    expect(() => validateMinimumReleaseAge(2)).toThrow("must equal repository policy 3 days");
    expect(validateMinimumReleaseAge(3)).toBe(3);
  });

  it("rejects incomplete or invalid registry metadata", () => {
    const artifact = artifactEntry("2.0.0", "example");
    expect(() => {
      validateArtifactMetadata(
        artifact,
        { dist: { integrity: artifact.integrity, tarball: artifact.resolved }, time: {} },
        3,
        NOW,
      );
    }).toThrow("Incomplete npm metadata");
  });
});
