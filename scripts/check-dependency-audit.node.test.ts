import { describe, expect, it } from "vitest";

import type { AuditProcessResult } from "./check-dependency-audit";

import {
  checkAuditProcessResult,
  getNpmAuditInvocation,
  validateDependencyAudit,
} from "./check-dependency-audit";

const TODAY = "2026-10-09";

/**
 * Build an isolated mutable report and lockfile fixture.
 * @returns Mutable report and lockfile
 */
function fixtures() {
  return {
    lock: {
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: { "@sap-cloud-sdk/connectivity": "^4.9.1" },
          devDependencies: { "markdownlint-cli2": "^0.23.3" },
        },
        "node_modules/braces": { dev: true, version: "3.0.2" },
        "node_modules/jks-js": { dependencies: { "node-forge": "^1.4.0" } },
        "node_modules/micromatch": { dependencies: { braces: "^3.0.3" }, dev: true },
        "node_modules/node-forge": { version: "1.4.0" },
      },
    },
    report: {
      vulnerabilities: {
        braces: {
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
        "node-forge": {
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
 * Require an indexed fixture value.
 * @param value - Possibly absent indexed value
 * @returns Present fixture value
 */
function requireFixtureValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Invalid test fixture");
  return value;
}

describe("dependency audit policy", () => {
  it("accepts only the two advisories in their attested contexts", () => {
    const { lock, report } = fixtures();
    expect(validateDependencyAudit(report, lock, TODAY)).toHaveLength(2);
  });

  it("rejects an advisory attached to the wrong package", () => {
    const { lock, report } = fixtures();
    const advisory = requireFixtureValue(report.vulnerabilities["node-forge"].via[0]);
    advisory.name = "different-package";
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("package does not match");
  });

  it("rejects npm error reports even if vulnerabilities are present", () => {
    const { lock, report } = fixtures();
    expect(() =>
      validateDependencyAudit({ ...report, error: { code: "EAUDIT" } }, lock, TODAY),
    ).toThrow("valid vulnerability report");
  });

  it("rejects severity escalation to critical", () => {
    const { lock, report } = fixtures();
    const advisory = requireFixtureValue(report.vulnerabilities["node-forge"].via[0]);
    advisory.severity = "critical";
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("severity critical");
  });

  it("rejects a direct occurrence", () => {
    const { lock, report } = fixtures();
    report.vulnerabilities["node-forge"].isDirect = true;
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("directness");
  });

  it("rejects an additional immediate parent for an allowed advisory", () => {
    const { lock, report } = fixtures();
    const extraParentLock = {
      ...lock,
      packages: {
        ...lock.packages,
        "node_modules/other-parent": { dependencies: { "node-forge": "^1.4.0" } },
      },
    };
    expect(() => validateDependencyAudit(report, extraParentLock, TODAY)).toThrow(
      "immediate parent packages",
    );
  });

  it("rejects an additional immediate parent using an npm alias", () => {
    const { lock, report } = fixtures();
    const aliasedParentLock = {
      ...lock,
      packages: {
        ...lock.packages,
        "node_modules/alias-parent": {
          dependencies: { "forge-alias": "npm:node-forge@1.4.0" },
        },
      },
    };
    expect(() => validateDependencyAudit(report, aliasedParentLock, TODAY)).toThrow(
      "immediate parent packages",
    );
  });

  it("rejects transitive reporting for a direct lockfile dependency", () => {
    const { lock, report } = fixtures();
    const directLock = {
      ...lock,
      packages: {
        ...lock.packages,
        "": { ...lock.packages[""], dependencies: { "node-forge": "1.4.0" } },
      },
    };
    expect(() => validateDependencyAudit(report, directLock, TODAY)).toThrow("declared directly");
  });

  it("rejects a development exception that reaches runtime", () => {
    const { lock, report } = fixtures();
    lock.packages["node_modules/braces"].dev = false;
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("scope runtime");
  });

  it("rejects an audit node absent from the lockfile", () => {
    const { lock, report } = fixtures();
    report.vulnerabilities["node-forge"].nodes = ["node_modules/missing"];
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("missing lockfile node");
  });

  it("does not let a duplicate GHSA overwrite a contradictory occurrence", () => {
    const { lock, report } = fixtures();
    const via = report.vulnerabilities["node-forge"].via;
    via.push({ ...requireFixtureValue(via[0]), severity: "critical" });
    expect(() => validateDependencyAudit(report, lock, TODAY)).toThrow("severity critical");
  });
});

describe("npm audit process contract", () => {
  it("rejects exit status 2 before interpreting output", () => {
    const { lock, report } = fixtures();
    expect(() =>
      checkAuditProcessResult({ ...processResult(JSON.stringify(report)), status: 2 }, lock, TODAY),
    ).toThrow("status 2");
  });

  it("rejects signal termination", () => {
    const { lock, report } = fixtures();
    expect(() =>
      checkAuditProcessResult(
        { ...processResult(JSON.stringify(report)), signal: "SIGTERM" },
        lock,
        TODAY,
      ),
    ).toThrow("signal SIGTERM");
  });

  it("rejects invalid JSON even after a zero exit", () => {
    const { lock } = fixtures();
    expect(() => checkAuditProcessResult(processResult("{"), lock, TODAY)).toThrow("valid JSON");
  });

  it("accepts a valid zero-exit report and always requests audit-level none", () => {
    const { lock, report } = fixtures();
    expect(
      checkAuditProcessResult(processResult(JSON.stringify(report)), lock, TODAY),
    ).toHaveLength(2);
    expect(getNpmAuditInvocation().args).toEqual([
      "audit",
      "--json",
      "--audit-level=none",
      "--registry=https://registry.npmjs.org/",
    ]);
  });
});
