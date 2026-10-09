import { describe, expect, it } from "vitest";

import type { AuditProcessResult } from "./check-dependency-audit";

import {
  checkAuditProcessResult,
  getNpmAuditInvocation,
  validateDependencyAudit,
} from "./check-dependency-audit";

const TODAY = "2026-10-09";

/** Mutable advisory fixture. */
interface Advisory {
  dependency: string;
  name: string;
  severity: string;
  url: string;
}

/** Mutable lockfile package fixture. */
interface LockEntry {
  dependencies?: Record<string, string>;
  dev?: boolean;
  devDependencies?: Record<string, string>;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  version?: string;
}

/** Mutable npm vulnerability fixture. */
interface Vulnerability {
  effects?: string[];
  fixAvailable?: unknown;
  isDirect: boolean;
  name: string;
  nodes: string[];
  severity: string;
  via: (Advisory | string)[];
}

/**
 * Build an isolated mutable report and lockfile fixture with all approved routes.
 * @returns Mutable report and lockfile fixtures
 */
function fixtures(): {
  lock: { lockfileVersion: 3; packages: Record<string, LockEntry> };
  report: { vulnerabilities: Record<string, Vulnerability> };
} {
  return {
    lock: {
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: { "@sap-cloud-sdk/connectivity": "^4.9.1" },
          devDependencies: { "markdownlint-cli2": "^0.23.3" },
        },
        "node_modules/@sap-cloud-sdk/connectivity": {
          dependencies: { "jks-js": "^1.1.7" },
        },
        "node_modules/braces": { dev: true, version: "3.0.2" },
        "node_modules/fast-glob": {
          dependencies: { micromatch: "^4.0.8" },
          dev: true,
        },
        "node_modules/globby": {
          dependencies: { "fast-glob": "^3.3.3", micromatch: "^4.0.8" },
          dev: true,
        },
        "node_modules/jks-js": { dependencies: { "node-forge": "^1.4.0" } },
        "node_modules/markdownlint-cli2": {
          dependencies: { globby: "16.2.4", micromatch: "4.0.8" },
          dev: true,
        },
        "node_modules/micromatch": {
          dependencies: { braces: "^3.0.3" },
          dev: true,
        },
        "node_modules/node-forge": { version: "1.4.0" },
      },
    },
    report: {
      vulnerabilities: {
        "@sap-cloud-sdk/connectivity": {
          effects: [],
          fixAvailable: false,
          isDirect: true,
          name: "@sap-cloud-sdk/connectivity",
          nodes: ["node_modules/@sap-cloud-sdk/connectivity"],
          severity: "high",
          via: ["jks-js"],
        },
        braces: {
          effects: ["micromatch"],
          fixAvailable: false,
          isDirect: false,
          name: "braces",
          nodes: ["node_modules/braces"],
          severity: "high",
          via: [
            {
              dependency: "braces",
              name: "braces",
              severity: "high",
              url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
            },
          ],
        },
        "fast-glob": {
          effects: ["globby"],
          fixAvailable: false,
          isDirect: false,
          name: "fast-glob",
          nodes: ["node_modules/fast-glob"],
          severity: "high",
          via: ["micromatch"],
        },
        globby: {
          effects: ["markdownlint-cli2"],
          fixAvailable: false,
          isDirect: false,
          name: "globby",
          nodes: ["node_modules/globby"],
          severity: "high",
          via: ["fast-glob", "micromatch"],
        },
        "jks-js": {
          effects: ["@sap-cloud-sdk/connectivity"],
          fixAvailable: false,
          isDirect: false,
          name: "jks-js",
          nodes: ["node_modules/jks-js"],
          severity: "high",
          via: ["node-forge"],
        },
        "markdownlint-cli2": {
          effects: [],
          fixAvailable: false,
          isDirect: true,
          name: "markdownlint-cli2",
          nodes: ["node_modules/markdownlint-cli2"],
          severity: "high",
          via: ["globby", "micromatch"],
        },
        micromatch: {
          effects: ["fast-glob", "globby", "markdownlint-cli2"],
          fixAvailable: false,
          isDirect: false,
          name: "micromatch",
          nodes: ["node_modules/micromatch"],
          severity: "high",
          via: ["braces"],
        },
        "node-forge": {
          effects: ["jks-js"],
          fixAvailable: false,
          isDirect: false,
          name: "node-forge",
          nodes: ["node_modules/node-forge"],
          severity: "high",
          via: [
            {
              dependency: "node-forge",
              name: "node-forge",
              severity: "high",
              url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
            },
          ],
        },
      },
    },
  };
}

/**
 * Build a successful npm process result.
 * @param stdout - JSON process output
 * @returns Successful process result
 */
function processResult(stdout: string): AuditProcessResult {
  return { signal: null, status: 0, stderr: "", stdout };
}

/**
 * Require an advisory occurrence from a fixture.
 * @param value - Possibly absent advisory value
 * @returns Present advisory occurrence
 */
function requireAdvisory(value: Advisory | string | undefined): Advisory {
  if (!value || typeof value === "string") throw new Error("Invalid test fixture");
  return value;
}

/**
 * Require an exact lockfile package fixture.
 * @param packages - Mutable package fixtures
 * @param path - Exact package path
 * @returns Present lockfile entry
 */
function requireLockEntry(packages: Record<string, LockEntry>, path: string): LockEntry {
  const entry = packages[path];
  if (!entry) throw new Error(`Missing test lockfile entry ${path}`);
  return entry;
}

/**
 * Require an exact vulnerability fixture.
 * @param vulnerabilities - Mutable vulnerability fixtures
 * @param name - Exact vulnerability package name
 * @returns Present vulnerability fixture
 */
function requireVulnerability(
  vulnerabilities: Record<string, Vulnerability>,
  name: string,
): Vulnerability {
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) throw new Error(`Missing test vulnerability ${name}`);
  return vulnerability;
}

describe("npm audit fix availability contract", () => {
  it("rejects a non-forced fix for an allowlisted root vulnerability", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "node-forge").fixAvailable = true;
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "non-forced npm audit fix available",
    );
  });

  it("accepts false and forced fix objects for both major-version states", () => {
    for (const fixAvailable of [
      false,
      { isSemVerMajor: false, name: "node-forge", version: "1.4.1" },
      { isSemVerMajor: true, name: "node-forge", version: "2.0.0" },
    ]) {
      const { lock, report } = fixtures();
      requireVulnerability(report.vulnerabilities, "node-forge").fixAvailable = fixAvailable;
      expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
    }
  });

  it("rejects missing and malformed fix availability fields", () => {
    for (const fixAvailable of [
      undefined,
      {},
      { isSemVerMajor: false, name: "node-forge" },
      { isSemVerMajor: false, name: "", version: "1.4.1" },
      { isSemVerMajor: false, name: "node-forge", version: "" },
      { isSemVerMajor: "false", name: "node-forge", version: "1.4.1" },
      { extra: true, isSemVerMajor: false, name: "node-forge", version: "1.4.1" },
    ]) {
      const { lock, report } = fixtures();
      requireVulnerability(report.vulnerabilities, "node-forge").fixAvailable = fixAvailable;
      expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
        "valid vulnerability report",
      );
    }
  });
});

describe("dependency audit instance graph policy", () => {
  it("accepts the runtime route and all three real Markdownlint routes", () => {
    const { lock, report } = fixtures();
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("rejects an alias instance of the vulnerable package outside an approved route", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").dependencies = {
      ...requireLockEntry(lock.packages, "").dependencies,
      "forge-alias": "npm:node-forge",
    };
    lock.packages["node_modules/forge-alias"] = {
      name: "node-forge",
      version: "1.4.0",
    };
    requireVulnerability(report.vulnerabilities, "node-forge").nodes.push(
      "node_modules/forge-alias",
    );
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("unapproved direct root");
  });

  it("rejects an incoherent alias edge to an audited instance", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").dependencies = {
      ...requireLockEntry(lock.packages, "").dependencies,
      "forge-alias": "npm:different-package@1.4.0",
    };
    lock.packages["node_modules/forge-alias"] = {
      name: "node-forge",
      version: "1.4.0",
    };
    requireVulnerability(report.vulnerabilities, "node-forge").nodes.push(
      "node_modules/forge-alias",
    );
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "incoherent or ambiguous alias edge",
    );
  });

  it("rejects conflicting alias identities across dependency fields", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    root.dependencies = { ...root.dependencies, alias: "npm:node-forge" };
    root.devDependencies = {
      ...root.devDependencies,
      alias: "npm:different-package@1.0.0",
    };
    lock.packages["node_modules/alias"] = {
      name: "node-forge",
      version: "1.4.0",
    };
    requireVulnerability(report.vulnerabilities, "node-forge").nodes.push("node_modules/alias");
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "incoherent or ambiguous alias edge",
    );
  });

  it("ignores a safe aliased instance that npm audit did not report", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").dependencies = {
      ...requireLockEntry(lock.packages, "").dependencies,
      "forge-alias": "npm:node-forge@2.0.0",
    };
    lock.packages["node_modules/forge-alias"] = {
      name: "node-forge",
      version: "2.0.0",
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("accepts bare and versioned scoped aliases for safe instances", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").dependencies = {
      ...requireLockEntry(lock.packages, "").dependencies,
      "scoped-bare": "npm:@scope/pkg",
      "scoped-versioned": "npm:@scope/pkg@^1.0.0",
    };
    lock.packages["node_modules/scoped-bare"] = {
      name: "@scope/pkg",
      version: "1.0.0",
    };
    lock.packages["node_modules/scoped-versioned"] = {
      name: "@scope/pkg",
      version: "1.1.0",
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("ignores a nested safe version while validating the exact audited node", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").devDependencies = {
      ...requireLockEntry(lock.packages, "").devDependencies,
      "safe-tool": "1.0.0",
    };
    lock.packages["node_modules/safe-tool"] = {
      dependencies: { braces: "4.0.0" },
      dev: true,
    };
    lock.packages["node_modules/safe-tool/node_modules/braces"] = {
      dev: true,
      version: "4.0.0",
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("rejects substitution of declarations from a different package instance", () => {
    const { lock, report } = fixtures();
    lock.packages["node_modules/unrelated/node_modules/node-forge"] = {
      name: "node-forge",
      version: "1.4.0",
    };
    requireVulnerability(report.vulnerabilities, "node-forge").nodes = [
      "node_modules/unrelated/node_modules/node-forge",
    ];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("direct root declaration");
  });

  it("rejects Markdownlint being absent from the root declaration", () => {
    const { lock, report } = fixtures();
    delete requireLockEntry(lock.packages, "").devDependencies?.["markdownlint-cli2"];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("direct root declaration");
  });

  it("rejects Markdownlint being rooted under another top-level dependency", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    delete root.devDependencies?.["markdownlint-cli2"];
    root.devDependencies = {
      ...root.devDependencies,
      "other-linter": "1.0.0",
    };
    lock.packages["node_modules/other-linter"] = {
      dependencies: { "markdownlint-cli2": "0.23.3" },
      dev: true,
    };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "additional incoming route to markdownlint-cli2",
    );
  });

  it("stops at a coherently root-declared anchor shared by another dependency", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").dependencies = {
      ...requireLockEntry(lock.packages, "").dependencies,
      "@sap-ai-sdk/core": "2.16.0",
    };
    lock.packages["node_modules/@sap-ai-sdk/core"] = {
      dependencies: { "@sap-cloud-sdk/connectivity": "^4.9.1" },
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("rejects an incoherent shared reference entering a direct anchor", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").dependencies = {
      ...requireLockEntry(lock.packages, "").dependencies,
      "@sap-ai-sdk/core": "2.16.0",
    };
    lock.packages["node_modules/@sap-ai-sdk/core"] = {
      dependencies: {
        "@sap-cloud-sdk/connectivity": "npm:different-package@1.0.0",
      },
    };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "incoherent or ambiguous alias edge",
    );
  });

  it("rejects an additional route anchored at another root dependency", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").devDependencies = {
      ...requireLockEntry(lock.packages, "").devDependencies,
      "other-linter": "1.0.0",
    };
    lock.packages["node_modules/other-linter"] = {
      dependencies: { micromatch: "4.0.8" },
      dev: true,
    };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "unapproved dependency route",
    );
  });

  it("includes optional dependencies as provenance edges", () => {
    const { lock, report } = fixtures();
    const connectivity = requireLockEntry(
      lock.packages,
      "node_modules/@sap-cloud-sdk/connectivity",
    );
    connectivity.dependencies = undefined;
    connectivity.optionalDependencies = { "jks-js": "^1.1.7" };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("includes peer dependencies as provenance edges", () => {
    const { lock, report } = fixtures();
    const jks = requireLockEntry(lock.packages, "node_modules/jks-js");
    jks.dependencies = undefined;
    jks.peerDependencies = { "node-forge": "^1.4.0" };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("ignores the real Markdownlint formatter peer back-edge", () => {
    const { lock, report } = fixtures();
    const markdownlint = requireLockEntry(lock.packages, "node_modules/markdownlint-cli2");
    markdownlint.dependencies = {
      ...markdownlint.dependencies,
      "markdownlint-cli2-formatter-default": "0.0.6",
    };
    lock.packages["node_modules/markdownlint-cli2-formatter-default"] = {
      dev: true,
      peerDependencies: { "markdownlint-cli2": ">=0.0.4" },
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("fails closed on absent required dependency targets", () => {
    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const { lock, report } = fixtures();
      const root = requireLockEntry(lock.packages, "");
      root[field] = { ...root[field], missing: "1.0.0" };
      expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
        "Missing dependency target missing declared by <root>",
      );
    }
  });

  it("allows an unresolved optional dependency target", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").optionalDependencies = { missing: "1.0.0" };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("applies an optional dependency override before target resolution", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    root.dependencies = { ...root.dependencies, missing: "npm:required-name@1.0.0" };
    root.optionalDependencies = { missing: "npm:optional-name@1.0.0" };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("uses only the optional alias identity when overriding a dependency", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    root.dependencies = {
      ...root.dependencies,
      "@sap-cloud-sdk/connectivity": "npm:different-package@1.0.0",
    };
    root.optionalDependencies = {
      "@sap-cloud-sdk/connectivity": "npm:@sap-cloud-sdk/connectivity@4.9.1",
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("keeps dev dependencies and required peers strict beside an optional declaration", () => {
    for (const field of ["devDependencies", "peerDependencies"] as const) {
      const { lock, report } = fixtures();
      const root = requireLockEntry(lock.packages, "");
      root.optionalDependencies = { missing: "1.0.0" };
      root[field] = { ...root[field], missing: "1.0.0" };
      expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
        "Missing dependency target missing declared by <root>",
      );
    }
  });

  it("rejects an unresolved peer dependency target", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").peerDependencies = { missing: "1.0.0" };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "Missing dependency target missing declared by <root>",
    );
  });

  it("allows an unresolved optional peer dependency target", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    root.peerDependencies = { missing: "1.0.0" };
    root.peerDependenciesMeta = { missing: { optional: true } };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("resolves nested instances below a scoped package with Node hoisting semantics", () => {
    const { lock, report } = fixtures();
    delete lock.packages["node_modules/jks-js"];
    delete lock.packages["node_modules/node-forge"];
    const jksPath = "node_modules/@sap-cloud-sdk/connectivity/node_modules/jks-js";
    const forgePath = `${jksPath}/node_modules/node-forge`;
    lock.packages[jksPath] = { dependencies: { "node-forge": "^1.4.0" } };
    lock.packages[forgePath] = { version: "1.4.0" };
    requireVulnerability(report.vulnerabilities, "jks-js").nodes = [jksPath];
    requireVulnerability(report.vulnerabilities, "node-forge").nodes = [forgePath];
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("rejects cycles before reaching an approved root anchor", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "node_modules/micromatch").dependencies = {
      ...requireLockEntry(lock.packages, "node_modules/micromatch").dependencies,
      globby: "^16.2.4",
    };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "unapproved dependency route",
    );
  });

  it("rejects an audit node absent from the lockfile", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "node-forge").nodes = ["node_modules/missing"];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("missing lockfile node");
  });

  it("retains audit effects and via checks as secondary defenses", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "micromatch").effects = [
      "globby",
      "markdownlint-cli2",
    ];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "effects for micromatch do not include fast-glob",
    );
  });

  it("rejects development exceptions that reach runtime", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "node_modules/braces").dev = false;
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("scope runtime");
  });

  it("rejects a contradictory duplicate advisory occurrence", () => {
    const { lock, report } = fixtures();
    const via = requireVulnerability(report.vulnerabilities, "node-forge").via;
    via.push({ ...requireAdvisory(via[0]), severity: "critical" });
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("severity critical");
  });
});

describe("npm audit process contract", () => {
  it("rejects process failures and invalid JSON before policy validation", () => {
    const { lock, report } = fixtures();
    expect(() =>
      checkAuditProcessResult(
        {
          ...processResult(JSON.stringify(report)),
          error: new Error("spawn failed"),
        },
        lock,
        TODAY,
      ),
    ).toThrow("Unable to run npm audit");
    expect(() =>
      checkAuditProcessResult({ ...processResult(JSON.stringify(report)), status: 2 }, lock, TODAY),
    ).toThrow("status 2");
    expect(() =>
      checkAuditProcessResult(
        { ...processResult(JSON.stringify(report)), signal: "SIGTERM" },
        lock,
        TODAY,
      ),
    ).toThrow("signal SIGTERM");
    expect(() => checkAuditProcessResult(processResult("{"), lock, TODAY)).toThrow("valid JSON");
  });

  it("forces every dependency scope even when npm omit configuration is inherited", () => {
    expect(getNpmAuditInvocation("/npm-cli.js", "/node")).toEqual({
      args: [
        "/npm-cli.js",
        "audit",
        "--json",
        "--audit-level=none",
        "--include=prod",
        "--include=dev",
        "--include=optional",
        "--include=peer",
        "--registry=https://registry.npmjs.org/",
      ],
      command: "/node",
    });
  });

  it("accepts a valid zero-exit report and rejects direct execution without npm context", () => {
    const { lock, report } = fixtures();
    expect(
      checkAuditProcessResult(processResult(JSON.stringify(report)), lock, TODAY),
    ).toHaveLength(2);
    expect(() => getNpmAuditInvocation("", "/node")).toThrow("Missing npm_execpath");
  });
});
