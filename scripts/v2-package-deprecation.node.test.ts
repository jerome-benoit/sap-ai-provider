import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  DEFAULT_REGISTRY,
  DEPRECATION_MESSAGE,
  fetchPackageDocument,
  FROZEN_VERSION,
  getNpmDeprecationInvocation,
  parseArguments,
  parseVersion,
  STANDALONE_PACKAGE_NAME,
  versionsAbove,
  versionsWithoutMessage,
} from "./v2-package-deprecation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const DOCUMENT_URL = `https://registry.npmjs.org/${encodeURIComponent(STANDALONE_PACKAGE_NAME)}`;

/**
 * Build the registry document of a package held at the frozen version.
 * @param overrides - Fields that replace the frozen defaults
 * @returns Registry document
 */
function frozenDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "dist-tags": { latest: FROZEN_VERSION },
    name: STANDALONE_PACKAGE_NAME,
    versions: { "5.1.2": {} },
    ...overrides,
  };
}

/**
 * Build the registry answer the shared packument reader expects to consume.
 *
 * A real `Response` cannot carry a `url`, and the shared reader verifies the response origin, so the
 * fixture supplies exactly the fields that reader uses.
 * @param body - Decoded document the answer carries
 * @param init - Answer status overrides
 * @param init.ok - Answer success flag
 * @param init.status - HTTP status code
 * @returns Response-like answer
 */
function registryAnswer(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    body: new Blob([JSON.stringify(body)]).stream(),
    headers: new Headers({ "content-type": "application/json" }),
    ok: init.ok ?? true,
    status: init.status ?? 200,
    url: DOCUMENT_URL,
  } as unknown as Response;
}

describe("version comparison", () => {
  it("parses build and prerelease identifiers", () => {
    expect(parseVersion("5.1.2")).toEqual({ build: [5, 1, 2], prerelease: [] });
    expect(parseVersion("5.2.0-rc.1")).toEqual({ build: [5, 2, 0], prerelease: ["rc", 1] });
    expect(parseVersion("5.1.2+build.7")).toBeUndefined();
    expect(parseVersion("latest")).toBeUndefined();
  });

  it("orders releases, then prereleases below their release", () => {
    expect(compareVersions("5.1.10", "5.1.9")).toBeGreaterThan(0);
    expect(compareVersions("5.1.2", "5.1.2")).toBe(0);
    expect(compareVersions("5.2.0-rc.0", "5.1.9")).toBeGreaterThan(0);
    expect(compareVersions("5.2.0-rc.0", "5.2.0")).toBeLessThan(0);
    expect(compareVersions("5.2.0-rc.1", "5.2.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("5.2.0-alpha", "5.2.0-1")).toBeGreaterThan(0);
    expect(compareVersions("5.2.0-rc.1", "5.2.0-rc.1.0")).toBeLessThan(0);
  });

  it("rejects a version it cannot parse", () => {
    expect(() => {
      compareVersions("5.1.2", "next");
    }).toThrow("Not a semantic version: next");
  });
});

describe("freeze check", () => {
  it("reports versions above the frozen ceiling", () => {
    const published = ["4.0.0", "5.1.2", "5.2.0", "5.10.0", "5.2.0-rc.0"];
    expect(versionsAbove(published, FROZEN_VERSION)).toEqual(["5.2.0-rc.0", "5.2.0", "5.10.0"]);
  });

  it("accepts a registry that holds nothing above the ceiling", () => {
    expect(versionsAbove(["5.1.2", "4.4.12-rc.0", "5.1.2"], FROZEN_VERSION)).toEqual([]);
  });
});

describe("deprecation coverage", () => {
  it("lists versions whose message differs from the canonical one", () => {
    const document = {
      versions: {
        "5.0.0": { deprecated: DEPRECATION_MESSAGE },
        "5.1.0": {},
        "5.1.1": { deprecated: "older wording" },
        "5.1.2": { deprecated: DEPRECATION_MESSAGE },
      },
    };
    expect(versionsWithoutMessage(document)).toEqual(["5.1.0", "5.1.1"]);
  });

  it("accepts a fully deprecated document", () => {
    const document = { versions: { "5.1.2": { deprecated: DEPRECATION_MESSAGE } } };
    expect(versionsWithoutMessage(document)).toEqual([]);
  });
});

describe("command line", () => {
  it("checks the freeze when no command is given", () => {
    expect(parseArguments([])).toEqual({ apply: false, command: "check" });
  });

  it("accepts the only flag of the write command", () => {
    expect(parseArguments(["deprecate", "--apply"])).toEqual({ apply: true, command: "deprecate" });
  });

  it("refuses a flag a read-only command ignores", () => {
    expect(() => {
      parseArguments(["check", "--apply"]);
    }).toThrow("Unexpected arguments for check: --apply");
    expect(() => {
      parseArguments(["verify", "--apply"]);
    }).toThrow("Unexpected arguments for verify: --apply");
    expect(() => {
      parseArguments(["deprecate", "--apply", "--apply"]);
    }).toThrow("Unexpected arguments for deprecate: --apply, --apply");
  });

  it("refuses a command it does not implement", () => {
    expect(() => {
      parseArguments(["publish"]);
    }).toThrow("Expected command check, verify, or deprecate; received publish");
  });
});

describe("npm write invocation", () => {
  it("refuses to guess an npm executable", () => {
    expect(() => {
      getNpmDeprecationInvocation("");
    }).toThrow("Missing npm_execpath; run npm run deprecate-v2-package -- --apply");
  });

  it("rejects flags, relative paths, and other executables", () => {
    for (const path of ["--version", "bin/npm-cli.js", process.execPath]) {
      expect(() => {
        getNpmDeprecationInvocation(path);
      }).toThrow("Invalid npm_execpath");
    }
  });

  it("launches an existing npm entry point with Node against the read registry", () => {
    const directory = mkdtempSync(join(tmpdir(), "v2-package-npm-"));
    const npmExecPath = join(directory, "npm-cli.js");
    try {
      expect(() => {
        getNpmDeprecationInvocation(npmExecPath);
      }).toThrow("Invalid npm_execpath");
      writeFileSync(npmExecPath, "");
      expect(getNpmDeprecationInvocation(npmExecPath)).toEqual({
        args: [
          npmExecPath,
          "deprecate",
          `${STANDALONE_PACKAGE_NAME}@<=${FROZEN_VERSION}`,
          DEPRECATION_MESSAGE,
          "--dry-run=false",
          `--registry=${DEFAULT_REGISTRY}`,
          `--@jerome-benoit:registry=${DEFAULT_REGISTRY}`,
        ],
        command: process.execPath,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("registry reader", () => {
  it("requests the abbreviated document through the shared bounded reader", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn((input: Request | string | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(registryAnswer(frozenDocument()));
    });
    const document = await fetchPackageDocument(fetchImpl);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(DOCUMENT_URL);
    expect(requests[0]?.headers.get("accept")).toBe("application/vnd.npm.install-v1+json");
    expect(requests[0]?.redirect).toBe("error");
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(document.versions)).toEqual(["5.1.2"]);
  });

  it("tolerates dist-tags other than latest", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        registryAnswer(
          frozenDocument({ "dist-tags": { latest: FROZEN_VERSION, next: "4.4.12-rc.0" } }),
        ),
      ),
    );
    await expect(fetchPackageDocument(fetchImpl)).resolves.toHaveProperty("versions");
  });

  it("fails closed on a registry error answer", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(registryAnswer("gone", { ok: false, status: 404 })),
    );
    await expect(fetchPackageDocument(fetchImpl)).rejects.toThrow("returned HTTP 404");
  });

  it("fails closed on a document that is not the standalone package", async () => {
    const foreign = vi.fn(() =>
      Promise.resolve(registryAnswer({ ...frozenDocument(), name: "some-other-package" })),
    );
    await expect(fetchPackageDocument(foreign)).rejects.toThrow(
      `Expected the registry document of ${STANDALONE_PACKAGE_NAME}`,
    );
    const notAnObject = vi.fn(() => Promise.resolve(registryAnswer(null)));
    await expect(fetchPackageDocument(notAnObject)).rejects.toThrow("did not return a JSON object");
  });

  it("fails closed on a missing or empty versions table", async () => {
    const missing = vi.fn(() =>
      Promise.resolve(
        registryAnswer({ "dist-tags": { latest: FROZEN_VERSION }, name: STANDALONE_PACKAGE_NAME }),
      ),
    );
    await expect(fetchPackageDocument(missing)).rejects.toThrow("has no versions table");
    const empty = vi.fn(() => Promise.resolve(registryAnswer(frozenDocument({ versions: {} }))));
    await expect(fetchPackageDocument(empty)).rejects.toThrow("lists no version");
  });

  it("lists every version key it cannot order", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        registryAnswer(
          frozenDocument({
            versions: { "5.1.2": {}, "5.1.3+build.1": {}, "not-a-version": {} },
          }),
        ),
      ),
    );
    await expect(fetchPackageDocument(fetchImpl)).rejects.toThrow(
      `cannot order: "5.1.3+build.1", "not-a-version"`,
    );
  });

  it("fails closed when the latest dist-tag moved away from the freeze", async () => {
    const moved = vi.fn(() =>
      Promise.resolve(
        registryAnswer(
          frozenDocument({ "dist-tags": { latest: "5.2.0" }, versions: { "5.1.2": {} } }),
        ),
      ),
    );
    await expect(fetchPackageDocument(moved)).rejects.toThrow(
      `Registry dist-tag latest is "5.2.0", not the frozen 5.1.2`,
    );
    const absent = vi.fn(() =>
      Promise.resolve(
        registryAnswer(
          frozenDocument({ "dist-tags": { next: "4.4.12-rc.0" }, versions: { "5.1.2": {} } }),
        ),
      ),
    );
    await expect(fetchPackageDocument(absent)).rejects.toThrow("no latest dist-tag");
    const unlisted = vi.fn(() =>
      Promise.resolve(registryAnswer(frozenDocument({ versions: { "5.1.1": {} } }))),
    );
    await expect(fetchPackageDocument(unlisted)).rejects.toThrow("does not list");
  });

  it("fails closed on an unreadable version record", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        registryAnswer(
          frozenDocument({ versions: { "5.1.2": { deprecated: ["not", "a", "string"] } } }),
        ),
      ),
    );
    await expect(fetchPackageDocument(fetchImpl)).rejects.toThrow("is not readable");
  });
});

const CLI_ENTRY = fileURLToPath(new URL("./v2-package-deprecation-cli.ts", import.meta.url));

/**
 * Child process result of one gate run.
 */
interface CompletedRun {
  reads: number;
  status: null | number;
  stderr: string;
  stdout: string;
}

/**
 * Preload that replaces the registry transport and counts the reads it served.
 */
const REGISTRY_PRELOAD = `
import { appendFileSync } from "node:fs";

const document = __DOCUMENT__;

globalThis.fetch = async () => {
  appendFileSync(__MARKER__, "read\\n");
  return {
    body: new Blob([JSON.stringify(document)]).stream(),
    headers: new Headers({ "content-type": "application/json" }),
    ok: true,
    status: 200,
    url: __URL__,
  };
};
`;

/**
 * Describe a finished child process inside an assertion message.
 * @param run - Completed child process
 * @returns Exit status and both output streams
 */
function describeRun(run: CompletedRun): string {
  return `status=${String(run.status)} out=${run.stdout.trim()} err=${run.stderr.trim()}`;
}

/**
 * Copy an environment without inherited npm context, Node options, or tsx loader options.
 *
 * Windows environment names are case-insensitive, so filtering one spelling can leave another in
 * the block a child receives: an `npm_` spelling would hand the child a real npm to write with, and
 * a `TSX_` spelling would fail the child on a loader configuration unrelated to the gate.
 * @param source - Environment to copy
 * @returns Copy with every `npm_` and `tsx_` spelling and `NODE_OPTIONS` removed
 */
function gateEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => {
      const name = key.toLowerCase();
      return !name.startsWith("npm_") && !name.startsWith("tsx_") && name !== "node_options";
    }),
  );
}

/**
 * Run the gate as a command against a stubbed registry.
 *
 * The child gets no npm context, so no case can reach the npm write.
 * @param document - Registry document the stubbed transport serves
 * @param args - Gate arguments
 * @returns Exit status, served read count, and both output streams
 */
function runGate(document: unknown, args: readonly string[]): CompletedRun {
  const directory = mkdtempSync(join(tmpdir(), "v2-package-deprecation-"));
  const marker = join(directory, "registry-reads");
  const preload = join(directory, "registry.mjs");
  writeFileSync(
    preload,
    REGISTRY_PRELOAD.replace(/__DOCUMENT__|__MARKER__|__URL__/gu, (token) =>
      token === "__DOCUMENT__"
        ? JSON.stringify(document)
        : token === "__MARKER__"
          ? JSON.stringify(marker)
          : JSON.stringify(DOCUMENT_URL),
    ),
  );
  try {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "--import", pathToFileURL(preload).href, CLI_ENTRY, ...args],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: gateEnvironment(process.env),
      },
    );
    return {
      reads: existsSync(marker)
        ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length
        : 0,
      status: run.status,
      stderr: run.stderr,
      stdout: run.stdout,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe("gate command", () => {
  it("ignores an inherited tsx configuration before reading the registry", () => {
    vi.stubEnv("TSX_TSCONFIG_PATH", "./examples/nonexistent.json");
    const run = runGate(frozenDocument(), ["check"]);
    expect(run.status, describeRun(run)).toBe(0);
    expect(run.reads).toBe(1);
  });

  it("reports the freeze and the exact coverage without writing", () => {
    const run = runGate(frozenDocument(), ["check"]);
    expect(run.status, describeRun(run)).toBe(0);
    expect(run.reads).toBe(1);
    expect(run.stdout).toContain(
      `Freeze holds: 1 published versions, none above ${FROZEN_VERSION}.`,
    );
    expect(run.stdout).toContain(
      "0 carry the canonical deprecation message; 1 miss it or carry a different one.",
    );
    expect(run.stdout).toContain("Run npm run deprecate-v2-package -- --apply");
  });

  it("stops on a moved latest tag even when no version sorts above the ceiling", () => {
    const run = runGate(
      frozenDocument({ "dist-tags": { latest: "5.2.0" }, versions: { "5.1.2": {} } }),
      ["check"],
    );
    expect(run.status, describeRun(run)).toBe(1);
    expect(run.stderr).toContain(`Registry dist-tag latest is "5.2.0"`);
    expect(run.stdout).not.toContain("Freeze holds");
  });

  it("stops on an empty versions table instead of reporting a held freeze", () => {
    const run = runGate(frozenDocument({ versions: {} }), ["verify"]);
    expect(run.status, describeRun(run)).toBe(1);
    expect(run.stderr).toContain("lists no version");
  });

  it("rejects a flag it would otherwise ignore without reading the registry", () => {
    const run = runGate(frozenDocument(), ["check", "--apply"]);
    expect(run.status, describeRun(run)).toBe(2);
    expect(run.stderr).toContain("Unexpected arguments for check: --apply");
    expect(run.reads).toBe(0);
  });

  it("confirms coverage once every version carries the canonical message", () => {
    const run = runGate(
      frozenDocument({ versions: { "5.1.2": { deprecated: DEPRECATION_MESSAGE } } }),
      ["verify"],
    );
    expect(run.status, describeRun(run)).toBe(0);
    expect(run.stdout).toContain("carries the canonical deprecation message");
  });

  it("refuses to write outside its own npm lifecycle script", () => {
    const run = runGate(frozenDocument(), ["deprecate", "--apply"]);
    expect(run.status, describeRun(run)).toBe(1);
    expect(run.reads).toBe(1);
    expect(run.stderr).toContain("Run npm run deprecate-v2-package -- --apply to write");
  });

  it("previews the npm write scope separately from the observed gaps", () => {
    const run = runGate(
      frozenDocument({
        versions: { "4.1.2-rc.1": {}, "5.1.2": { deprecated: DEPRECATION_MESSAGE } },
      }),
      ["deprecate"],
    );
    expect(run.status, describeRun(run)).toBe(0);
    expect(run.reads).toBe(1);
    expect(run.stdout).toContain(
      `Dry run: npm deprecate targets every version matching ${STANDALONE_PACKAGE_NAME}@<=${FROZEN_VERSION}.`,
    );
    expect(run.stdout).toContain(
      "Registry snapshot: 1 of 2 published versions lack the canonical deprecation message.",
    );
    expect(run.stdout).toContain(DEPRECATION_MESSAGE);
  });
});
