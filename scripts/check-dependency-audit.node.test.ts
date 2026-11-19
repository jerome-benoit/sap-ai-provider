import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AdvisoryFetch,
  AdvisoryResponse,
  AllowedAdvisory,
  AuditProcessResult,
} from "./check-dependency-audit";

import {
  allowedAdvisories,
  auditChildEnvironment,
  checkAuditProcessResult,
  filterWithdrawnAdvisories,
  getNpmAuditInvocation,
  MAXIMUM_ADVISORY_BYTES,
  runDependencyAudit,
  validateDependencyAudit,
} from "./check-dependency-audit";

const TODAY = "2026-10-23";

const TEST_ADVISORY = "GHSA-1111-1111-1111";

const WITHDRAWN_ADVISORY = "GHSA-wdth-0000-0000";

/** Retraction timestamp, far enough in the past that no runner clock can read it as future. */
const WITHDRAWN_TIMESTAMP = "2020-01-01T00:00:00Z";

const KEPT_ADVISORY = "GHSA-kept-0000-0000";

const CRITICAL_ADVISORY = "GHSA-crit-0000-0000";

const LOW_ADVISORY = "GHSA-low0-0000-0000";

afterEach(() => {
  for (const id of Object.keys(allowedAdvisories)) {
    Reflect.deleteProperty(allowedAdvisories, id);
  }
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

/** Mutable npm audit report fixture. */
interface ReportFixture {
  vulnerabilities: Record<string, Vulnerability>;
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
  report: ReportFixture;
} {
  Object.assign(allowedAdvisories, { [TEST_ADVISORY]: testPolicy() });
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

/**
 * Build the exception fixture for the advisory that report fixtures reference.
 * @returns Temporary exception contract
 */
function testPolicy(): AllowedAdvisory {
  return {
    dependencyPaths: [["@sap-cloud-sdk/connectivity", "jks-js", "node-forge"]],
    direct: false,
    expires: "2026-11-08",
    packageName: "node-forge",
    reason: "Synthetic test exception.",
    scope: "runtime",
    severity: "high",
  };
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

  it("rejects an advisory naming a package other than the excepted one", () => {
    const { lock, report } = fixtures();
    const advisory = requireAdvisory(
      requireVulnerability(report.vulnerabilities, "node-forge").via[0],
    );
    advisory.dependency = "left-pad";
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 package does not match node-forge",
    );
  });

  it("rejects a root record whose severity differs from the exception", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "node-forge").severity = "critical";
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 root severity critical does not match high",
    );
  });

  it("rejects a root record whose directness differs from the exception", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "node-forge").isDirect = true;
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 directness does not match the exception policy",
    );
  });

  it("rejects a root record the lockfile does not resolve to any node", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "node-forge").nodes = [];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 has no lockfile nodes",
    );
  });

  it("rejects an audited node the lockfile assigns to another package", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "node-forge").nodes = ["node_modules/jks-js"];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 has an unapproved dependency route through jks-js",
    );
  });

  it("rejects a second root record naming the excepted package", () => {
    const { lock, report } = fixtures();
    report.vulnerabilities["aliased-node-forge"] = {
      ...requireVulnerability(report.vulnerabilities, "node-forge"),
      nodes: [],
      via: [],
    };
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 has no unique root vulnerability for node-forge",
    );
  });

  it("rejects an approved route whose parent audit record omits the audited child", () => {
    const { lock, report } = fixtures();
    requireVulnerability(report.vulnerabilities, "jks-js").via = [];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "GHSA-1111-1111-1111 audit via for jks-js does not include node-forge",
    );
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
        "--package-lock-only",
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

/** Advisory database response fixture. */
interface AdvisoryStub {
  /** JSON body or raw text body. */
  body?: unknown;
  /** Raw response body chunks, used to exercise the byte bound and decoding. */
  chunks?: readonly (readonly number[] | string)[];
  /** Advertised `content-length` header value. */
  contentLength?: string;
  /** Resolve the response, then never deliver a body chunk or honor the signal. */
  hang?: boolean;
  /** Answer without a response body. */
  noBody?: boolean;
  ok?: boolean;
  /** Answer without a `content-length` header. */
  omitContentLength?: boolean;
  /** Hook invoked when a hanging read is first requested. */
  onHang?: () => void;
  /** Observe response body lifecycle events. */
  record?: (event: "body-cancel" | "get-reader" | "reader-cancel" | "release-lock") => void;
  status?: number;
  /** Reported request origin, used to exercise the origin check. */
  url?: string;
}

/**
 * Build a fetch stub for the GitHub Advisory Database.
 * @param responses - Canned response per advisory identifier
 * @returns Request log, request options log, and fetch implementation
 */
function advisoryFetch(responses: Record<string, AdvisoryStub>): {
  calls: string[];
  fetch: AdvisoryFetch;
  inits: { headers: Record<string, string>; redirect: "error"; signal: AbortSignal }[];
} {
  const calls: string[] = [];
  const inits: { headers: Record<string, string>; redirect: "error"; signal: AbortSignal }[] = [];
  const fetch: AdvisoryFetch = (input, init) => {
    calls.push(input);
    inits.push(init);
    const id = input.slice("https://api.github.com/advisories/".length);
    const stub = responses[id] ?? { ok: false, status: 404 };
    return Promise.resolve(advisoryResponse(id, stub));
  };
  return { calls, fetch, inits };
}

/**
 * Build one advisory database response.
 * @param id - Advisory identifier the response answers
 * @param stub - Response fixture
 * @returns Streaming advisory response
 */
function advisoryResponse(id: string, stub: AdvisoryStub): AdvisoryResponse {
  const encoder = new TextEncoder();
  const body = typeof stub.body === "string" ? stub.body : JSON.stringify(stub.body ?? {});
  const chunks = (stub.chunks ?? [body]).map((chunk) =>
    typeof chunk === "string" ? encoder.encode(chunk) : Uint8Array.from(chunk),
  );
  const declaredBytes = encoder.encode(body).byteLength;
  let next = 0;
  const read = stub.hang
    ? () =>
        new Promise<{ done: boolean; value?: Uint8Array | undefined }>(() => {
          stub.onHang?.();
        })
    : () => {
        const chunk = chunks[next];
        next += 1;
        return Promise.resolve(
          chunk === undefined ? { done: true, value: undefined } : { done: false, value: chunk },
        );
      };
  return {
    body: stub.noBody
      ? null
      : {
          cancel: () => {
            stub.record?.("body-cancel");
            return Promise.resolve();
          },
          getReader: () => {
            stub.record?.("get-reader");
            return {
              cancel: () => {
                stub.record?.("reader-cancel");
                return Promise.resolve();
              },
              read,
              releaseLock: () => {
                stub.record?.("release-lock");
              },
            };
          },
        },
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" && stub.omitContentLength !== true
          ? (stub.contentLength ?? String(declaredBytes))
          : null,
    },
    ok: stub.ok ?? true,
    status: stub.status ?? 200,
    url: stub.url ?? `https://api.github.com/advisories/${id}`,
  };
}

/**
 * Build an advisory cause for a fixture record.
 * @param id - GitHub Security Advisory identifier
 * @param severity - Advisory severity
 * @param affected - Package the advisory names
 * @returns Advisory cause fixture
 */
function cause(id: string, severity: string, affected = "node-forge"): Advisory {
  return {
    dependency: affected,
    name: affected,
    severity,
    url: `https://github.com/advisories/${id}`,
  };
}

/**
 * Point one fixture vulnerability at the given advisory causes.
 * @param report - Mutable report fixture
 * @param report.vulnerabilities - Vulnerability records keyed by package name
 * @param packageName - Vulnerability record to rewrite
 * @param causes - Advisory causes to install
 */
function setCauses(
  report: ReportFixture,
  packageName: string,
  causes: (Advisory | string)[],
): void {
  requireVulnerability(report.vulnerabilities, packageName).via = causes;
}

const WITHDRAWN_RESPONSE = {
  body: { ghsa_id: WITHDRAWN_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
};

describe("withdrawn advisory filtering", () => {
  it("ignores an advisory retracted by the GitHub Advisory Database", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const snapshot = structuredClone(report);
    const { calls, fetch } = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
      },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([`https://api.github.com/advisories/${TEST_ADVISORY}`]);
    expect(filtered.withdrawn).toEqual([TEST_ADVISORY]);
    expect(filtered.report.vulnerabilities["node-forge"]).toBeUndefined();
    expect(report).toEqual(snapshot);
    expect(
      checkAuditProcessResult(processResult(JSON.stringify(filtered.report)), lock, TODAY),
    ).toEqual([]);
  });

  it("derives a retained record severity from the advisory it keeps", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    Object.assign(allowedAdvisories, {
      [KEPT_ADVISORY]: {
        dependencyPaths: [["@sap-cloud-sdk/connectivity", "jks-js", "node-forge"]],
        direct: false,
        expires: "2026-11-08",
        packageName: "node-forge",
        reason: "Synthetic test exception.",
        scope: "runtime",
        severity: "moderate",
      },
    });
    setCauses(report, "node-forge", [
      cause(WITHDRAWN_ADVISORY, "high"),
      cause(KEPT_ADVISORY, "moderate"),
    ]);
    const { calls, fetch } = advisoryFetch({
      [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);
    const validated = checkAuditProcessResult(
      processResult(JSON.stringify(filtered.report)),
      lock,
      TODAY,
    );

    expect(calls).toEqual([`https://api.github.com/advisories/${WITHDRAWN_ADVISORY}`]);
    expect(filtered.withdrawn).toEqual([WITHDRAWN_ADVISORY]);
    const retained = requireVulnerability(filtered.report.vulnerabilities, "node-forge");
    expect(retained.severity).toBe("moderate");
    expect(retained.via).toEqual([cause(KEPT_ADVISORY, "moderate")]);
    expect(validated).toEqual([
      {
        id: KEPT_ADVISORY,
        policy: {
          dependencyPaths: [["@sap-cloud-sdk/connectivity", "jks-js", "node-forge"]],
          direct: false,
          expires: "2026-11-08",
          packageName: "node-forge",
          reason: "Synthetic test exception.",
          scope: "runtime",
          severity: "moderate",
        },
      },
    ]);
  });

  it("reports the most severe advisory among several retained causes", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    requireVulnerability(report.vulnerabilities, "node-forge").severity = "high";
    setCauses(report, "node-forge", [
      cause(WITHDRAWN_ADVISORY, "low"),
      cause(KEPT_ADVISORY, "moderate"),
      cause(CRITICAL_ADVISORY, "critical"),
      cause(LOW_ADVISORY, "low"),
    ]);
    const { calls, fetch } = advisoryFetch({
      [CRITICAL_ADVISORY]: { body: { ghsa_id: CRITICAL_ADVISORY, withdrawn_at: null } },
      [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
      [LOW_ADVISORY]: { body: { ghsa_id: LOW_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([
      `https://api.github.com/advisories/${WITHDRAWN_ADVISORY}`,
      `https://api.github.com/advisories/${KEPT_ADVISORY}`,
      `https://api.github.com/advisories/${CRITICAL_ADVISORY}`,
      `https://api.github.com/advisories/${LOW_ADVISORY}`,
    ]);
    expect(requireVulnerability(filtered.report.vulnerabilities, "node-forge").severity).toBe(
      "critical",
    );
  });

  it("ranks retained advisory severities by the npm audit order", async () => {
    const ladder = ["info", "low", "moderate", "high", "critical"];
    for (const [index, lower] of ladder.entries()) {
      const upper = ladder[index + 1];
      if (!upper) continue;
      const { report } = fixtures();
      Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
      setCauses(report, "node-forge", [
        cause(WITHDRAWN_ADVISORY, "low"),
        cause(KEPT_ADVISORY, lower),
        cause(CRITICAL_ADVISORY, upper),
      ]);
      const { fetch } = advisoryFetch({
        [CRITICAL_ADVISORY]: { body: { ghsa_id: CRITICAL_ADVISORY, withdrawn_at: null } },
        [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
        [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
      });

      const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

      expect(requireVulnerability(filtered.report.vulnerabilities, "node-forge").severity).toBe(
        upper,
      );
    }
  });

  it("keeps npm severity when a transitive cause and an advisory remain", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    requireVulnerability(report.vulnerabilities, "node-forge").severity = "critical";
    setCauses(report, "node-forge", [
      cause(WITHDRAWN_ADVISORY, "low"),
      cause(KEPT_ADVISORY, "moderate"),
      "nested-dep",
    ]);
    const { calls, fetch } = advisoryFetch({
      [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);
    const retained = requireVulnerability(filtered.report.vulnerabilities, "node-forge");

    expect(calls).toEqual([
      `https://api.github.com/advisories/${WITHDRAWN_ADVISORY}`,
      `https://api.github.com/advisories/${KEPT_ADVISORY}`,
    ]);
    expect(retained.severity).toBe("critical");
    expect(retained.via).toEqual([cause(KEPT_ADVISORY, "moderate"), "nested-dep"]);
  });

  it("keeps npm severity while a transitive cause remains", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    setCauses(report, "node-forge", [cause(WITHDRAWN_ADVISORY, "low"), "nested-dep"]);
    const { fetch } = advisoryFetch({ [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);
    const retained = requireVulnerability(filtered.report.vulnerabilities, "node-forge");

    expect(filtered.withdrawn).toEqual([WITHDRAWN_ADVISORY]);
    expect(retained.severity).toBe("high");
    expect(retained.via).toEqual(["nested-dep"]);
  });

  it("looks one withdrawn advisory up once and removes it from every record", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    setCauses(report, "node-forge", [cause(WITHDRAWN_ADVISORY, "high")]);
    setCauses(report, "jks-js", [
      cause(WITHDRAWN_ADVISORY, "high"),
      cause(WITHDRAWN_ADVISORY, "high"),
      "node-forge",
    ]);
    const { calls, fetch } = advisoryFetch({ [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([`https://api.github.com/advisories/${WITHDRAWN_ADVISORY}`]);
    expect(filtered.report.vulnerabilities["node-forge"]).toBeUndefined();
    expect(requireVulnerability(filtered.report.vulnerabilities, "jks-js").via).toEqual([
      "node-forge",
    ]);
  });

  it("ignores letter case in the advisory record identifier", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    setCauses(report, "node-forge", [cause(WITHDRAWN_ADVISORY, "high")]);
    const { fetch } = advisoryFetch({
      [WITHDRAWN_ADVISORY]: {
        body: { ghsa_id: WITHDRAWN_ADVISORY.toUpperCase(), withdrawn_at: WITHDRAWN_TIMESTAMP },
      },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(filtered.withdrawn).toEqual([WITHDRAWN_ADVISORY]);
  });

  it("refuses a withdrawal timestamp in the future", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    setCauses(report, "node-forge", [cause(TEST_ADVISORY, "high")]);
    const { fetch } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "2999-01-01T00:00:00Z" } },
    });

    await expect(filterWithdrawnAdvisories(report, fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} reports a withdrawal timestamp in the future`,
    );
  });

  it("keeps reporting an advisory that the database still lists as active", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const snapshot = structuredClone(report);
    const { fetch } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: null } },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(filtered.withdrawn).toEqual([]);
    expect(report).toEqual(snapshot);
    expect(() =>
      checkAuditProcessResult(processResult(JSON.stringify(filtered.report)), lock, TODAY),
    ).toThrow(`Unexpected dependency advisory: ${TEST_ADVISORY}`);
  });

  it("never queries an advisory that already has an exception policy", async () => {
    const { lock, report } = fixtures();
    const snapshot = structuredClone(report);
    const { calls, fetch } = advisoryFetch({});

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([]);
    expect(filtered.report).toEqual(snapshot);
    expect(report).toEqual(snapshot);
    expect(
      checkAuditProcessResult(processResult(JSON.stringify(filtered.report)), lock, TODAY),
    ).toEqual([
      {
        id: TEST_ADVISORY,
        policy: testPolicy(),
      },
    ]);
  });

  it("fails closed when the advisory database is unavailable or inconsistent", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const unavailable = advisoryFetch({ [TEST_ADVISORY]: { ok: false, status: 503 } });
    const invalidJson = advisoryFetch({ [TEST_ADVISORY]: { body: "not-json" } });
    const mismatched = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: "GHSA-2222-2222-2222" } },
    });
    const invalidWithdrawal = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "" } },
    });
    const absentBody = advisoryFetch({ [TEST_ADVISORY]: { noBody: true } });

    await expect(filterWithdrawnAdvisories(report, unavailable.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} returned HTTP 503`,
    );
    await expect(filterWithdrawnAdvisories(report, invalidJson.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} did not return valid JSON`,
    );
    await expect(filterWithdrawnAdvisories(report, mismatched.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} returned a mismatched identifier`,
    );
    await expect(
      filterWithdrawnAdvisories(report, invalidWithdrawal.fetch, undefined),
    ).rejects.toThrow(`GitHub advisory ${TEST_ADVISORY} has an invalid withdrawn_at value`);
    await expect(filterWithdrawnAdvisories(report, absentBody.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} did not provide a response body`,
    );
  });

  it("fails closed on a rejected transport, an oversized body, and a hanging read", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const rejected = {
      fetch: (() => Promise.reject(new Error("socket hang up"))) as AdvisoryFetch,
    };
    const bodyEvents: string[] = [];
    const declaredTooLarge = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
        contentLength: String(MAXIMUM_ADVISORY_BYTES + 1),
        record: (event) => {
          bodyEvents.push(event);
        },
      },
    });
    const multibyteTooLarge = advisoryFetch({
      [TEST_ADVISORY]: { chunks: ["é".repeat(MAXIMUM_ADVISORY_BYTES)] },
    });
    const chunkedTooLarge = advisoryFetch({
      [TEST_ADVISORY]: {
        chunks: ["a".repeat(MAXIMUM_ADVISORY_BYTES - 1), "a".repeat(MAXIMUM_ADVISORY_BYTES - 1)],
      },
    });
    const controller = new AbortController();
    const hanging = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
        hang: true,
        onHang: () => {
          queueMicrotask(() => {
            controller.abort(new Error("body stalled"));
          });
        },
      },
    });

    await expect(filterWithdrawnAdvisories(report, rejected.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY}: socket hang up`,
    );
    await expect(
      filterWithdrawnAdvisories(report, declaredTooLarge.fetch, undefined),
    ).rejects.toThrow(
      `declared a response body larger than ${String(MAXIMUM_ADVISORY_BYTES)} bytes`,
    );
    expect(bodyEvents).toEqual(["body-cancel"]);
    await expect(
      filterWithdrawnAdvisories(report, multibyteTooLarge.fetch, undefined),
    ).rejects.toThrow(`response body exceeded ${String(MAXIMUM_ADVISORY_BYTES)} bytes`);
    await expect(
      filterWithdrawnAdvisories(report, chunkedTooLarge.fetch, undefined),
    ).rejects.toThrow(`response body exceeded ${String(MAXIMUM_ADVISORY_BYTES)} bytes`);
    await expect(
      filterWithdrawnAdvisories(report, hanging.fetch, undefined, controller.signal),
    ).rejects.toThrow(`Unable to read GitHub advisory ${TEST_ADVISORY} response body`);
  });
});

describe("advisory database responses", () => {
  it("fails closed when the advisory record was deleted", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const { calls, fetch } = advisoryFetch({});

    await expect(filterWithdrawnAdvisories(report, fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} returned HTTP 404`,
    );
    expect(calls).toEqual([`https://api.github.com/advisories/${TEST_ADVISORY}`]);
  });

  it("treats a record without a withdrawal timestamp as active", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const snapshot = structuredClone(report);
    const { calls, fetch } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY } },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([`https://api.github.com/advisories/${TEST_ADVISORY}`]);
    expect(filtered.withdrawn).toEqual([]);
    expect(filtered.report).toEqual(snapshot);
    expect(report).toEqual(snapshot);
  });

  it("fails closed on a JSON array record and a foreign response origin", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const arrayBody = advisoryFetch({ [TEST_ADVISORY]: { body: [] } });
    const foreignOrigin = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
        url: "https://example.com/advisories/GHSA-1111-1111-1111",
      },
    });

    await expect(filterWithdrawnAdvisories(report, arrayBody.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} did not return a JSON object`,
    );
    await expect(filterWithdrawnAdvisories(report, foreignOrigin.fetch, undefined)).rejects.toThrow(
      `GitHub advisory ${TEST_ADVISORY} returned an unexpected response origin`,
    );
  });

  it("sends one redirect-refusing authorized request per advisory", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    setCauses(report, "node-forge", [
      cause(TEST_ADVISORY, "high"),
      cause(WITHDRAWN_ADVISORY, "high"),
    ]);
    const { calls, fetch, inits } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
    });

    await filterWithdrawnAdvisories(report, fetch, "test-token");

    expect(inits).toHaveLength(2);
    expect(calls).toEqual([
      `https://api.github.com/advisories/${TEST_ADVISORY}`,
      `https://api.github.com/advisories/${WITHDRAWN_ADVISORY}`,
    ]);
    for (const init of inits) {
      expect(init.headers.accept).toBe("application/vnd.github+json");
      expect(init.redirect).toBe("error");
      expect(init.headers.authorization).toBe("Bearer test-token");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(inits[0]?.signal).not.toBe(inits[1]?.signal);
  });

  it("reads a maximal body delivered in multibyte-split chunks", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const record = {
      ghsa_id: TEST_ADVISORY,
      p: "",
      withdrawn_at: WITHDRAWN_TIMESTAMP,
    };
    const encoder = new TextEncoder();
    const baseBytes = encoder.encode(JSON.stringify(record)).byteLength;
    const padBytes = MAXIMUM_ADVISORY_BYTES - baseBytes;
    const padding = `${"é".repeat(padBytes >> 1)}${padBytes % 2 === 0 ? "" : "x"}`;
    const body = encoder.encode(JSON.stringify({ ...record, p: padding }));
    expect(body.byteLength).toBe(MAXIMUM_ADVISORY_BYTES);
    const chunks: number[][] = [];
    for (let offset = 0; offset < body.byteLength; offset += 4097) {
      chunks.push([...body.subarray(offset, offset + 4097)]);
    }
    const events: string[] = [];
    const { fetch } = advisoryFetch({
      [TEST_ADVISORY]: {
        chunks,
        omitContentLength: true,
        record: (event) => {
          events.push(event);
        },
      },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(filtered.withdrawn).toEqual([TEST_ADVISORY]);
    expect(events).toEqual(["get-reader", "release-lock"]);
  });
});

describe("advisory exception lifecycle", () => {
  it("rejects an exception whose expiry date has passed", () => {
    const { lock, report } = fixtures();
    Object.assign(allowedAdvisories, {
      [TEST_ADVISORY]: { ...testPolicy(), expires: "2026-10-22" },
    });

    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      `Expired dependency advisory exceptions: ${TEST_ADVISORY}`,
    );
  });

  it("rejects an exception whose advisory the report no longer contains", () => {
    const { lock, report } = fixtures();
    setCauses(report, "node-forge", []);

    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      `Resolved dependency advisory exceptions must be removed: ${TEST_ADVISORY}`,
    );
  });

  it("rejects an exception expiry that is not a real calendar date", () => {
    const { lock, report } = fixtures();
    for (const expires of [
      "2026-11-1",
      "9999-99-99",
      "2026-02-30",
      "2026-02-29",
      "2026-13-01",
      "November 2026",
    ]) {
      Object.assign(allowedAdvisories, {
        [TEST_ADVISORY]: { ...testPolicy(), expires },
      });

      expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
        `${TEST_ADVISORY} exception expiry must be a YYYY-MM-DD date`,
      );
    }
  });

  it("rejects a report whose vulnerability record name cannot be validated", () => {
    const { lock } = fixtures();
    const report = JSON.parse(
      String.raw`{"vulnerabilities":{"__proto__":{"fixAvailable":false,"isDirect":true,"name":"x","nodes":[],"severity":"high","via":[]}}}`,
    ) as unknown;

    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "npm audit vulnerability report contains the unusable record name __proto__",
    );
  });

  it("accepts real expiry dates and keeps the expiry day valid", () => {
    const { lock, report } = fixtures();
    for (const expires of ["2026-10-23", "2027-10-23", "2028-02-29", "9999-12-31"]) {
      Object.assign(allowedAdvisories, { [TEST_ADVISORY]: { ...testPolicy(), expires } });

      expect(() => validateDependencyAudit(report, lock, TODAY)).not.toThrow();
    }
  });

  it("compares an expiry year below 0100 as a calendar date", () => {
    const { lock, report } = fixtures();
    Object.assign(allowedAdvisories, {
      [TEST_ADVISORY]: { ...testPolicy(), expires: "0004-02-29" },
    });

    // Reaching the expiry comparison proves the date itself was accepted.
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      `Expired dependency advisory exceptions: ${TEST_ADVISORY}`,
    );
  });

  it("rejects a report that is not an object", () => {
    const { lock } = fixtures();

    expect(() => validateDependencyAudit(null, lock, TODAY)).toThrow(
      "npm audit did not return a valid vulnerability report",
    );
  });

  it("keeps every spelling of the advisory token out of the npm child", () => {
    const child = auditChildEnvironment({
      GITHUB_TOKEN: "secret",
      Github_Token: "secret",
      github_token: "secret",
      npm_config_audit: "kept",
      PATH: "/bin",
    });

    expect(Object.keys(child).filter((name) => name.toUpperCase() === "GITHUB_TOKEN")).toEqual([]);
    expect(child.PATH).toBe("/bin");
    expect(child.npm_config_audit).toBe("kept");
    const inherited = auditChildEnvironment({ ...process.env, GITHUB_TOKEN: "secret" });
    expect(inherited.GITHUB_TOKEN).toBeUndefined();
  });

  it("rejects a lockfile whose instance name cannot be validated", () => {
    const { report } = fixtures();
    const lock = JSON.parse(
      String.raw`{"lockfileVersion":3,"packages":{"__proto__":{"version":"1.0.0"}}}`,
    ) as unknown;

    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
      "package-lock.json package map contains the unusable record name __proto__",
    );
  });

  it("rejects a lockfile dependency declaration that cannot be validated", () => {
    const { report } = fixtures();
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const path of ["", "node_modules/jks-js"]) {
        // `JSON.parse` reports the literal key as an own property; an object literal would not.
        const lock = JSON.parse(
          `{"lockfileVersion":3,"packages":{"":{},"${path}":{"${field}":{"__proto__":"^1.0.0"}}}}`,
        ) as unknown;

        expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow(
          `package-lock.json dependency map of ${path === "" ? "<root>" : path} contains the unusable record name __proto__`,
        );
      }
    }
  });
});

describe("npm audit advisory lookup pipeline", () => {
  it("rejects a malformed report whose advisory reference is withdrawn", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const advisory = requireAdvisory(
      requireVulnerability(report.vulnerabilities, "node-forge").via[0],
    ) as Partial<Advisory>;
    delete advisory.severity;
    const { calls, fetch } = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
      },
    });

    await expect(filterWithdrawnAdvisories(report, fetch, undefined)).rejects.toThrow(
      "npm audit did not return a valid vulnerability report",
    );
    expect(calls).toEqual([]);
  });

  it("looks every unknown advisory up before accepting the report", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    setCauses(report, "jks-js", [cause(WITHDRAWN_ADVISORY, "high")]);
    setCauses(report, "node-forge", [cause(KEPT_ADVISORY, "high")]);
    const { calls, fetch } = advisoryFetch({
      [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([
      `https://api.github.com/advisories/${WITHDRAWN_ADVISORY}`,
      `https://api.github.com/advisories/${KEPT_ADVISORY}`,
    ]);
    expect(filtered.withdrawn).toEqual([WITHDRAWN_ADVISORY]);
    expect(() => validateDependencyAudit(filtered.report, lock, TODAY)).toThrow(
      `Unexpected dependency advisory: ${KEPT_ADVISORY}`,
    );
  });

  it("accepts a withdrawn advisory and still rejects an active one", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const { fetch: withdrawnFetch } = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
      },
    });
    const { fetch: activeFetch } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: null } },
    });

    const filtered = await filterWithdrawnAdvisories(report, withdrawnFetch, undefined);
    expect(validateDependencyAudit(filtered.report, lock, TODAY)).toEqual([]);
    const retained = await filterWithdrawnAdvisories(report, activeFetch, undefined);
    expect(() => validateDependencyAudit(retained.report, lock, TODAY)).toThrow(
      `Unexpected dependency advisory: ${TEST_ADVISORY}`,
    );
  });
});

describe("dependency audit run", () => {
  it("logs an ignored withdrawal and passes the filtered report to the policy", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const lines: string[] = [];
    const { calls, fetch, inits } = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: WITHDRAWN_TIMESTAMP },
      },
    });

    const validated = await runDependencyAudit({
      audit: processResult(JSON.stringify(report)),
      authorization: "test-token",
      fetchImplementation: fetch,
      lockValue: lock,
      log: (line) => {
        lines.push(line);
      },
      today: TODAY,
    });

    expect(calls).toEqual([`https://api.github.com/advisories/${TEST_ADVISORY}`]);
    expect(inits[0]?.redirect).toBe("error");
    expect(inits[0]?.headers.authorization).toBe("Bearer test-token");
    expect(lines).toEqual([`Withdrawn advisory ignored: ${TEST_ADVISORY}`]);
    expect(validated).toEqual([]);
  });

  it("logs each validated exception occurrence", async () => {
    const { lock, report } = fixtures();
    const lines: string[] = [];
    const { calls, fetch } = advisoryFetch({});

    const validated = await runDependencyAudit({
      audit: processResult(JSON.stringify(report)),
      fetchImplementation: fetch,
      lockValue: lock,
      log: (line) => {
        lines.push(line);
      },
      today: TODAY,
    });

    expect(calls).toEqual([]);
    expect(validated).toEqual([{ id: TEST_ADVISORY, policy: testPolicy() }]);
    expect(lines).toEqual([
      `Allowed until 2026-11-08: ${TEST_ADVISORY} (high) - Synthetic test exception.`,
    ]);
  });

  it("reports the ignored withdrawal before the policy rejects the report", async () => {
    const { lock, report } = fixtures();
    const lines: string[] = [];
    setCauses(report, "jks-js", [
      cause(WITHDRAWN_ADVISORY, "high"),
      cause(KEPT_ADVISORY, "high"),
      "node-forge",
    ]);
    const { fetch } = advisoryFetch({
      [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: WITHDRAWN_RESPONSE,
    });

    await expect(
      runDependencyAudit({
        audit: processResult(JSON.stringify(report)),
        fetchImplementation: fetch,
        lockValue: lock,
        log: (line) => {
          lines.push(line);
        },
        today: TODAY,
      }),
    ).rejects.toThrow(`Unexpected dependency advisory: ${KEPT_ADVISORY}`);
    expect(lines).toEqual([`Withdrawn advisory ignored: ${WITHDRAWN_ADVISORY}`]);
  });

  it("stops the run when the database still lists the advisory", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const lines: string[] = [];
    const { fetch } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: null } },
    });

    await expect(
      runDependencyAudit({
        audit: processResult(JSON.stringify(report)),
        fetchImplementation: fetch,
        lockValue: lock,
        log: (line) => {
          lines.push(line);
        },
        today: TODAY,
      }),
    ).rejects.toThrow(`Unexpected dependency advisory: ${TEST_ADVISORY}`);
    expect(lines).toEqual([]);
  });

  it("stops the run when the advisory record was deleted", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const { fetch } = advisoryFetch({});

    await expect(
      runDependencyAudit({
        audit: processResult(JSON.stringify(report)),
        fetchImplementation: fetch,
        lockValue: lock,
        log: () => undefined,
        today: TODAY,
      }),
    ).rejects.toThrow(`GitHub advisory ${TEST_ADVISORY} returned HTTP 404`);
  });

  it("stops the run when the npm audit process fails", async () => {
    const { lock } = fixtures();

    await expect(
      runDependencyAudit({
        audit: { error: undefined, signal: null, status: 1, stderr: " registry down ", stdout: "" },
        fetchImplementation: advisoryFetch({}).fetch,
        lockValue: lock,
        log: () => undefined,
        today: TODAY,
      }),
    ).rejects.toThrow("npm audit exited with status 1: registry down");
  });
});

const TSX_ENTRY = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));

const CHECKER_ENTRY = fileURLToPath(new URL("./check-dependency-audit-cli.ts", import.meta.url));

interface CompletedRun {
  error?: Error;
  status: null | number;
  stderr: string;
  stdout: string;
}

/**
 * Describe a finished child process inside an assertion message.
 * @param run - Completed child process
 * @returns Exit status, spawn error, and both output streams
 */
function describeRun(run: CompletedRun): string {
  return `status=${String(run.status)} error=${run.error?.message ?? "none"} out=${run.stdout.trim()} err=${run.stderr.trim()}`;
}

/**
 * Read the command that CI and contributors are told to run.
 * @returns Runner and script path of the published npm script
 */
function publishedAuditCommand(): { runner: string; script: string } {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { scripts: Record<string, string> };
  const [runner = "", script = ""] = (manifest.scripts["check-dependency-audit"] ?? "").split(" ");
  return { runner, script };
}

/**
 * Run the checker as a command without an npm context.
 * @param entry - Path used to invoke the checker
 * @returns Exit status, error, and output of the child
 */
function runChecker(entry: string): CompletedRun {
  const run = spawnSync(process.execPath, [TSX_ENTRY, entry], {
    encoding: "utf8",
    env: withoutNpmContext(process.env),
  });
  return { error: run.error, status: run.status, stderr: run.stderr, stdout: run.stdout };
}

/**
 * Copy an environment with every npm context marker removed.
 *
 * Windows environment names are case-insensitive, so dropping only the lower-case spelling can
 * leave a differently cased entry in the block a child process receives. That child finds a real
 * npm, audits the real checkout, and exits successfully while the test believes nothing ran.
 * @param source - Environment to copy
 * @returns Copy without any `npm_execpath` spelling
 */
function withoutNpmContext(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => key.toLowerCase() !== "npm_execpath"),
  );
}

describe("spawn environment preparation", () => {
  it("removes npm context in every casing", () => {
    const prepared = withoutNpmContext({
      Npm_ExecPath: "stale-one",
      npm_execpath: "stale-two",
      PATH: "/bin",
    });

    // Dropping only the lower-case spelling leaves the first key, and a child on Windows reads it
    // back as the npm context.
    expect(Object.keys(prepared).filter((key) => key.toLowerCase() === "npm_execpath")).toEqual([]);
    expect(prepared.PATH).toBe("/bin");
  });
});

describe("command-line entry", () => {
  // Creating a file link needs elevated privileges on Windows, where this check is skipped.
  it.runIf(process.platform !== "win32")(
    "runs the gate when invoked through a symlinked entry file",
    { timeout: 60_000 },
    () => {
      const directory = mkdtempSync(join(tmpdir(), "audit-entry-"));
      const link = join(directory, "linked-checker.ts");
      symlinkSync(CHECKER_ENTRY, link);
      try {
        // A skipped gate would exit 0 silently, indistinguishable from a clean audit.
        for (const entry of [CHECKER_ENTRY, link]) {
          const { status, stderr } = runChecker(entry);
          expect(status).toBe(1);
          expect(stderr.match(/Missing npm_execpath/g)).toHaveLength(1);
        }
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );

  // The published command is what both CI workflows and the contribution docs run, so the npm
  // script itself is executed here: pointing it at a file that does not run the gate must fail.
  it("runs the gate through the published npm command", { timeout: 120_000 }, () => {
    const { runner, script } = publishedAuditCommand();
    expect(runner).toBe("tsx");
    const environment = withoutNpmContext(process.env);
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)),
        fileURLToPath(new URL(`../${script}`, import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: environment,
      },
    );

    expect(run.status, describeRun(run)).toBe(1);
    expect(run.stderr).toContain("Missing npm_execpath");
  });

  // The child-facing path is only observable in a real process: what npm is asked to run, which
  // environment it receives, and whether the report it prints reaches the exception policy.
  it("runs the gate end to end against a stubbed npm child", { timeout: 180_000 }, () => {
    const directory = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const shim = join(directory, "fake-npm.cjs");
    const recorded = join(directory, "invocation.json");
    writeFileSync(
      shim,
      [
        'const { writeFileSync } = require("node:fs");',
        "writeFileSync(",
        "  process.env.AUDIT_STUB_FILE,",
        "  JSON.stringify({ argv: process.argv.slice(2), env: process.env }),",
        ");",
        'process.stdout.write(process.env.AUDIT_STUB_STDOUT ?? "");',
        "",
      ].join("\n"),
    );
    const environment: NodeJS.ProcessEnv = {
      ...withoutNpmContext(process.env),
      AUDIT_STUB_FILE: recorded,
      AUDIT_STUB_STDOUT: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }),
      GITHUB_TOKEN: "audit-cli-secret",
      npm_execpath: shim,
    };
    if (process.platform !== "win32") environment.Github_Token = "audit-cli-secret";

    const run = (lock: string): CompletedRun => {
      writeFileSync(join(directory, "package-lock.json"), lock);
      rmSync(recorded, { force: true });
      const child = spawnSync(process.execPath, [TSX_ENTRY, CHECKER_ENTRY], {
        cwd: directory,
        encoding: "utf8",
        env: environment,
      });
      return {
        error: child.error,
        status: child.status,
        stderr: child.stderr,
        stdout: child.stdout,
      };
    };
    const invocation = (): { argv: string[]; env: NodeJS.ProcessEnv } =>
      JSON.parse(readFileSync(recorded, "utf8")) as { argv: string[]; env: NodeJS.ProcessEnv };

    try {
      const clean = run('{"lockfileVersion":3,"packages":{"":{}}}');
      expect([clean.status, clean.stderr]).toEqual([0, ""]);
      // A missing record means the checker exited without running npm, i.e. it failed to treat
      // the path it was invoked with as its own entry point, which is a silent skip.
      expect(existsSync(recorded), `npm child never ran: ${describeRun(clean)}`).toBe(true);
      expect(clean.stdout).not.toContain("audit-cli-secret");
      expect(clean.stderr).not.toContain("audit-cli-secret");
      const recordedInit = invocation();
      expect(recordedInit.argv).toEqual(
        getNpmAuditInvocation(shim, process.execPath).args.slice(1),
      );
      expect(recordedInit.env.GITHUB_TOKEN).toBeUndefined();
      expect(recordedInit.env.npm_execpath).toBe(shim);
      if (process.platform !== "win32") {
        expect(recordedInit.env.Github_Token).toBeUndefined();
      }

      // A non-canonical advisory URL reaches policy validation without any network lookup.
      environment.AUDIT_STUB_STDOUT = JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {
          "aliased-dep": {
            effects: [],
            fixAvailable: false,
            isDirect: false,
            name: "aliased-dep",
            nodes: ["node_modules/aliased-dep"],
            severity: "high",
            via: [
              {
                dependency: "aliased-dep",
                name: "aliased-dep",
                severity: "high",
                url: "https://non-canonical.example/advisories/GHSA-1111-1111-1111",
              },
            ],
          },
        },
      });
      const reported = run('{"lockfileVersion":3,"packages":{"":{}}}');
      expect(reported.status).toBe(1);
      expect(reported.stderr).toContain("Invalid GitHub advisory URL:");
      expect(reported.stderr).not.toContain("audit-cli-secret");

      // The lockfile next to the run is the graph the policy validates against.
      environment.AUDIT_STUB_STDOUT = JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
      });
      const lockless = run('{"lockfileVersion":3,"packages":{}}');
      expect(lockless.status).toBe(1);
      expect(lockless.stderr).toContain("missing its root package entry");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
