import { afterEach, describe, expect, it } from "vitest";

import type { AuditProcessResult } from "./check-dependency-audit";

import {
  allowedAdvisories,
  checkAuditProcessResult,
  getNpmAuditInvocation,
  validateDependencyAudit,
} from "./check-dependency-audit";

const TODAY = "2026-10-23";

const TEST_ADVISORY = "GHSA-1111-1111-1111";

afterEach(() => {
  Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
});

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
 * Build an isolated mutable report and lockfile fixture with the approved runtime route.
 * @returns Mutable report and lockfile fixtures
 */
function fixtures(): {
  lock: { lockfileVersion: 3; packages: Record<string, LockEntry> };
  report: { vulnerabilities: Record<string, Vulnerability> };
} {
  Object.assign(allowedAdvisories, {
    [TEST_ADVISORY]: {
      dependencyPaths: [["@sap-cloud-sdk/connectivity", "jks-js", "node-forge"]],
      direct: false,
      expires: "2026-11-08",
      packageName: "node-forge",
      reason: "Synthetic test exception.",
      scope: "runtime",
      severity: "high",
    },
  });
  return {
    lock: {
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: { "@sap-cloud-sdk/connectivity": "^4.9.1" },
        },
        "node_modules/@sap-cloud-sdk/connectivity": {
          dependencies: { "jks-js": "^1.1.7" },
        },
        "node_modules/jks-js": { dependencies: { "node-forge": "^1.4.0" } },
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
        "jks-js": {
          effects: ["@sap-cloud-sdk/connectivity"],
          fixAvailable: false,
          isDirect: false,
          name: "jks-js",
          nodes: ["node_modules/jks-js"],
          severity: "high",
          via: ["node-forge"],
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
              url: `https://github.com/advisories/${TEST_ADVISORY}`,
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

describe("production advisory policy", () => {
  it("accepts an empty report when there are no advisory exceptions", () => {
    const lock = { lockfileVersion: 3, packages: { "": {} } };
    expect(validateDependencyAudit({ vulnerabilities: {} }, lock, TODAY)).toEqual([]);
  });
});

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
      expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
  it("accepts the approved SAP Cloud SDK runtime route", () => {
    const { lock, report } = fixtures();
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
  });

  it("rejects an unknown advisory alongside an approved advisory", () => {
    const { lock, report } = fixtures();
    const via = requireVulnerability(report.vulnerabilities, "node-forge").via;
    via.push({
      ...requireAdvisory(via[0]),
      url: "https://github.com/advisories/GHSA-0000-0000-0000",
    });
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow();
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
  });

  it("ignores a nested safe version while validating the exact audited node", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "").devDependencies = {
      ...requireLockEntry(lock.packages, "").devDependencies,
      "safe-tool": "1.0.0",
    };
    lock.packages["node_modules/safe-tool"] = {
      dependencies: { "node-forge": "2.0.0" },
      dev: true,
    };
    lock.packages["node_modules/safe-tool/node_modules/node-forge"] = {
      dev: true,
      version: "2.0.0",
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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

  it("rejects SAP connectivity being absent from the root declaration", () => {
    const { lock, report } = fixtures();
    delete requireLockEntry(lock.packages, "").dependencies?.["@sap-cloud-sdk/connectivity"];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("direct root declaration");
  });

  it("rejects SAP connectivity being rooted under another top-level dependency", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    delete root.dependencies?.["@sap-cloud-sdk/connectivity"];
    root.devDependencies = {
      ...root.devDependencies,
      "other-linter": "1.0.0",
    };
    lock.packages["node_modules/other-linter"] = {
      dependencies: { "@sap-cloud-sdk/connectivity": "^4.9.1" },
      dev: true,
    };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "additional incoming route to @sap-cloud-sdk/connectivity",
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
      dependencies: { "node-forge": "^1.4.0" },
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
  });

  it("includes peer dependencies as provenance edges", () => {
    const { lock, report } = fixtures();
    const jks = requireLockEntry(lock.packages, "node_modules/jks-js");
    jks.dependencies = undefined;
    jks.peerDependencies = { "node-forge": "^1.4.0" };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
  });

  it("stops at the direct anchor despite a coherent peer back-edge", () => {
    const { lock, report } = fixtures();
    const connectivity = requireLockEntry(
      lock.packages,
      "node_modules/@sap-cloud-sdk/connectivity",
    );
    connectivity.dependencies = {
      ...connectivity.dependencies,
      formatter: "1.0.0",
    };
    lock.packages["node_modules/formatter"] = {
      peerDependencies: { "@sap-cloud-sdk/connectivity": "^4.9.1" },
    };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
  });

  it("applies an optional dependency override before target resolution", () => {
    const { lock, report } = fixtures();
    const root = requireLockEntry(lock.packages, "");
    root.dependencies = { ...root.dependencies, missing: "npm:required-name@1.0.0" };
    root.optionalDependencies = { missing: "npm:optional-name@1.0.0" };
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
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
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(1);
  });

  it("rejects cycles before reaching an approved root anchor", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "node_modules/node-forge").dependencies = {
      "jks-js": "^1.1.7",
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
    requireVulnerability(report.vulnerabilities, "node-forge").effects = [];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "effects for node-forge do not include jks-js",
    );
  });

  it("rejects a runtime exception whose audited instance becomes development-only", () => {
    const { lock, report } = fixtures();
    requireLockEntry(lock.packages, "node_modules/node-forge").dev = true;
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("scope development");
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

  it("forces the lockfile and every scope despite inherited npm configuration", () => {
    expect(getNpmAuditInvocation("/npm-cli.js", "/node")).toEqual({
      args: [
        "/npm-cli.js",
        "audit",
        "--json",
        "--audit-level=none",
        "--package-lock=true",
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
    ).toHaveLength(1);
    expect(() => getNpmAuditInvocation("", "/node")).toThrow("Missing npm_execpath");
  });
});
