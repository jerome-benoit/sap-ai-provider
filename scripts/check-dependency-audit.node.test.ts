import { afterEach, describe, expect, it } from "vitest";

import type { AdvisoryFetch, AdvisoryResponse, AuditProcessResult } from "./check-dependency-audit";

import {
  allowedAdvisories,
  checkAuditProcessResult,
  filterWithdrawnAdvisories,
  getNpmAuditInvocation,
  MAXIMUM_ADVISORY_BYTES,
  validateDependencyAudit,
} from "./check-dependency-audit";

const TODAY = "2026-10-23";

const TEST_ADVISORY = "GHSA-1111-1111-1111";

const WITHDRAWN_ADVISORY = "GHSA-wdth-0000-0000";

const KEPT_ADVISORY = "GHSA-kept-0000-0000";

afterEach(() => {
  for (const id of [TEST_ADVISORY, WITHDRAWN_ADVISORY, KEPT_ADVISORY]) {
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

/** Advisory database response fixture. */
interface AdvisoryStub {
  /** JSON body or raw text body. */
  body?: unknown;
  /** Raw UTF-8 body chunks, used to exercise the byte bound. */
  chunks?: readonly string[];
  /** Advertised `content-length` header value. */
  contentLength?: string;
  ok?: boolean;
  /** Hook invoked when a stalled read is first requested. */
  onStall?: () => void;
  /** Resolve the response, then never deliver a body chunk. */
  stall?: boolean;
  status?: number;
}

/**
 * Build a fetch stub for the GitHub Advisory Database.
 * @param responses - Canned response per advisory identifier
 * @returns Request log and fetch implementation
 */
function advisoryFetch(responses: Record<string, AdvisoryStub>): {
  calls: string[];
  fetch: AdvisoryFetch;
} {
  const calls: string[] = [];
  const fetch: AdvisoryFetch = (input, init) => {
    calls.push(input);
    const id = input.slice("https://api.github.com/advisories/".length);
    const stub = responses[id] ?? { ok: false, status: 404 };
    return Promise.resolve(advisoryResponse(id, stub, init.signal));
  };
  return { calls, fetch };
}

/**
 * Build one advisory database response.
 * @param id - Advisory identifier the response answers
 * @param stub - Response fixture
 * @param signal - Request deadline signal
 * @returns Streaming advisory response
 */
function advisoryResponse(id: string, stub: AdvisoryStub, signal: AbortSignal): AdvisoryResponse {
  const encoder = new TextEncoder();
  const body = typeof stub.body === "string" ? stub.body : JSON.stringify(stub.body);
  const chunks = (stub.chunks ?? [body]).map((chunk) => encoder.encode(chunk));
  const declaredBytes = encoder.encode(body).byteLength;
  let next = 0;
  const read = stub.stall
    ? () =>
        new Promise<{ done: boolean; value?: Uint8Array | undefined }>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const reason: unknown = signal.reason;
              reject(reason instanceof Error ? reason : new Error(String(reason)));
            },
            { once: true },
          );
          stub.onStall?.();
        })
    : () => {
        const chunk = chunks[next];
        next += 1;
        return Promise.resolve(
          chunk === undefined ? { done: true, value: undefined } : { done: false, value: chunk },
        );
      };
  return {
    body: {
      cancel: () => Promise.resolve(),
      getReader: () => ({
        cancel: () => Promise.resolve(),
        read,
        releaseLock: () => undefined,
      }),
    },
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length"
          ? (stub.contentLength ?? String(declaredBytes))
          : null,
    },
    ok: stub.ok ?? true,
    status: stub.status ?? 200,
    url: `https://api.github.com/advisories/${id}`,
  };
}

describe("withdrawn advisory filtering", () => {
  it("ignores an advisory retracted by the GitHub Advisory Database", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const { calls, fetch } = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "2026-11-18T15:38:56Z" },
      },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([`https://api.github.com/advisories/${TEST_ADVISORY}`]);
    expect(filtered.withdrawn).toEqual([TEST_ADVISORY]);
    expect(filtered.report.vulnerabilities["node-forge"]).toBeUndefined();
    expect(
      checkAuditProcessResult(processResult(JSON.stringify(filtered.report)), lock, TODAY),
    ).toEqual([]);
  });

  it("derives a retained record severity from the advisory it keeps", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const withdrawnUrl = `https://github.com/advisories/${WITHDRAWN_ADVISORY}`;
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
    requireVulnerability(report.vulnerabilities, "node-forge").via = [
      {
        dependency: "node-forge",
        name: "node-forge",
        severity: "high",
        url: withdrawnUrl,
      },
      {
        dependency: "node-forge",
        name: "node-forge",
        severity: "moderate",
        url: `https://github.com/advisories/${KEPT_ADVISORY}`,
      },
    ];
    const { fetch } = advisoryFetch({
      [KEPT_ADVISORY]: { body: { ghsa_id: KEPT_ADVISORY, withdrawn_at: null } },
      [WITHDRAWN_ADVISORY]: {
        body: { ghsa_id: WITHDRAWN_ADVISORY, withdrawn_at: "2026-11-18T15:38:56Z" },
      },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);
    const validated = checkAuditProcessResult(
      processResult(JSON.stringify(filtered.report)),
      lock,
      TODAY,
    );

    expect(filtered.withdrawn).toEqual([WITHDRAWN_ADVISORY]);
    expect(requireVulnerability(filtered.report.vulnerabilities, "node-forge").severity).toBe(
      "moderate",
    );
    expect(validated).toHaveLength(1);
    expect(validated[0]?.id).toBe(KEPT_ADVISORY);
    expect(validated[0]?.policy.severity).toBe("moderate");
  });

  it("keeps reporting an advisory that the database still lists as active", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const { fetch } = advisoryFetch({
      [TEST_ADVISORY]: { body: { ghsa_id: TEST_ADVISORY, withdrawn_at: null } },
    });

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(filtered.withdrawn).toEqual([]);
    expect(filtered.report).toBe(report);
    expect(() =>
      checkAuditProcessResult(processResult(JSON.stringify(filtered.report)), lock, TODAY),
    ).toThrow(`Unexpected dependency advisory: ${TEST_ADVISORY}`);
  });

  it("never queries an advisory that already has an exception policy", async () => {
    const { lock, report } = fixtures();
    const { calls, fetch } = advisoryFetch({});

    const filtered = await filterWithdrawnAdvisories(report, fetch, undefined);

    expect(calls).toEqual([]);
    expect(filtered.report).toBe(report);
    expect(
      checkAuditProcessResult(processResult(JSON.stringify(filtered.report)), lock, TODAY),
    ).toHaveLength(1);
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
  });

  it("fails closed on a rejected transport, an oversized body, and a stalled read", async () => {
    const { report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const rejected = {
      calls: [] as string[],
      fetch: (() => Promise.reject(new Error("socket hang up"))) as AdvisoryFetch,
    };
    const declaredTooLarge = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "2026-11-18T15:38:56Z" },
        contentLength: String(MAXIMUM_ADVISORY_BYTES + 1),
      },
    });
    const multibyteTooLarge = advisoryFetch({
      [TEST_ADVISORY]: {
        chunks: ["é".repeat(MAXIMUM_ADVISORY_BYTES)],
      },
    });
    const controller = new AbortController();
    const stalled = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "2026-11-18T15:38:56Z" },
        onStall: () => {
          queueMicrotask(() => {
            controller.abort(new Error("body stalled"));
          });
        },
        stall: true,
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
    await expect(
      filterWithdrawnAdvisories(report, multibyteTooLarge.fetch, undefined),
    ).rejects.toThrow(`response body exceeded ${String(MAXIMUM_ADVISORY_BYTES)} bytes`);
    await expect(
      filterWithdrawnAdvisories(report, stalled.fetch, undefined, controller.signal),
    ).rejects.toThrow(`Unable to read GitHub advisory ${TEST_ADVISORY} response body`);
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
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "2026-11-18T15:38:56Z" },
      },
    });

    await expect(filterWithdrawnAdvisories(report, fetch, undefined)).rejects.toThrow(
      "npm audit did not return a valid vulnerability report",
    );
    expect(calls).toEqual([]);
  });

  it("accepts a withdrawn advisory and still rejects an active one", async () => {
    const { lock, report } = fixtures();
    Reflect.deleteProperty(allowedAdvisories, TEST_ADVISORY);
    const { fetch: withdrawnFetch } = advisoryFetch({
      [TEST_ADVISORY]: {
        body: { ghsa_id: TEST_ADVISORY, withdrawn_at: "2026-11-18T15:38:56Z" },
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
