/** Validates npm audit output against narrowly scoped, expiring exceptions. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Contract for one temporary dependency advisory exception. */
export interface AllowedAdvisory {
  dependencyPath: readonly string[];
  direct: boolean;
  expires: string;
  packageName: string;
  reason: string;
  scope: DependencyScope;
  severity: string;
}

/** Minimal child-process result consumed by the audit checker. */
export interface AuditProcessResult {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: null | number;
  stderr: string;
  stdout: string;
}

/** Runtime or development dependency scope attested by the lockfile. */
export type DependencyScope = "development" | "runtime";

/** A validated advisory occurrence and its approved policy. */
export interface ValidatedAdvisory {
  id: string;
  policy: AllowedAdvisory;
}

const auditAdvisorySchema = z.object({
  dependency: z.string().optional(),
  name: z.string().optional(),
  severity: z.string(),
  url: z.string(),
});
const auditVulnerabilitySchema = z.object({
  effects: z.array(z.string()).optional(),
  isDirect: z.boolean(),
  name: z.string().optional(),
  nodes: z.array(z.string()),
  severity: z.string(),
  via: z.array(z.union([z.string(), auditAdvisorySchema])),
});
const auditReportSchema = z.object({
  error: z.never().optional(),
  vulnerabilities: z.record(z.string(), auditVulnerabilitySchema),
});
const dependencyMapSchema = z.record(z.string(), z.string()).optional();
const lockPackageSchema = z.object({
  dependencies: dependencyMapSchema,
  dev: z.boolean().optional(),
  devDependencies: dependencyMapSchema,
  name: z.string().optional(),
  optionalDependencies: dependencyMapSchema,
  peerDependencies: dependencyMapSchema,
});
const packageLockSchema = z.object({
  packages: z.record(z.string(), lockPackageSchema),
});

type AuditAdvisory = z.infer<typeof auditAdvisorySchema>;
type AuditReport = z.infer<typeof auditReportSchema>;
type PackageLock = z.infer<typeof packageLockSchema>;

const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";

/** Temporary exceptions keyed by their exact GitHub Security Advisory ID. */
export const allowedAdvisories: Readonly<Record<string, AllowedAdvisory>> = {
  "GHSA-86w9-cpqp-85rv": {
    dependencyPath: ["@sap-cloud-sdk/connectivity", "jks-js", "node-forge"],
    direct: false,
    expires: "2026-11-08",
    packageName: "node-forge",
    reason: "No patched node-forge release; transitive through SAP Cloud SDK JKS support.",
    scope: "runtime",
    severity: "high",
  },
  "GHSA-vfj7-8cjw-p6xm": {
    dependencyPath: ["micromatch", "braces"],
    direct: false,
    expires: "2026-11-08",
    packageName: "braces",
    reason: "No patched braces release; development-only fixed Markdownlint glob patterns.",
    scope: "development",
    severity: "high",
  },
};

/**
 * Validate a completed npm audit process and its report against the package lock.
 * @param audit - Completed npm process result
 * @param lockValue - Parsed package-lock.json value
 * @param today - Current date in YYYY-MM-DD form
 * @returns Every allowed advisory occurrence after full context validation
 */
export function checkAuditProcessResult(
  audit: AuditProcessResult,
  lockValue: unknown,
  today = new Date().toISOString().slice(0, 10),
): ValidatedAdvisory[] {
  if (audit.error) throw new Error(`Unable to run npm audit: ${audit.error.message}`);
  if (audit.signal !== null) throw new Error(`npm audit terminated by signal ${audit.signal}`);
  if (audit.status !== 0) {
    const diagnostic = audit.stderr.trim();
    throw new Error(
      `npm audit exited with status ${String(audit.status ?? "unknown")}${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }

  let reportValue: unknown;
  try {
    reportValue = JSON.parse(audit.stdout) as unknown;
  } catch {
    const diagnostic = audit.stderr.trim();
    throw new Error(`npm audit did not return valid JSON${diagnostic ? `: ${diagnostic}` : ""}`);
  }

  return validateDependencyAudit(reportValue, lockValue, today);
}

/**
 * Return the npm CLI invocation and invariant audit arguments.
 * @param npmExecPath - npm CLI entry point supplied by the parent npm process
 * @param nodeExecPath - Node.js executable used to run the npm CLI
 * @returns npm audit invocation with an exit code independent of vulnerability severity
 */
export function getNpmAuditInvocation(
  npmExecPath = process.env.npm_execpath,
  nodeExecPath = process.execPath,
): { args: string[]; command: string } {
  if (!npmExecPath) {
    throw new Error(
      "Missing npm_execpath; run this checker through npm run check-dependency-audit",
    );
  }
  return {
    args: [
      npmExecPath,
      "audit",
      "--json",
      "--audit-level=none",
      `--registry=${PUBLIC_NPM_REGISTRY}`,
    ],
    command: nodeExecPath,
  };
}

/**
 * Validate parsed npm audit and lockfile values against the exception policy.
 * @param reportValue - Parsed npm audit JSON
 * @param lockValue - Parsed package-lock.json
 * @param today - Current date in YYYY-MM-DD form
 * @returns Every allowed advisory occurrence after full context validation
 */
export function validateDependencyAudit(
  reportValue: unknown,
  lockValue: unknown,
  today: string,
): ValidatedAdvisory[] {
  const reportResult = auditReportSchema.safeParse(reportValue);
  if (!reportResult.success) {
    throw new Error("npm audit did not return a valid vulnerability report");
  }
  const lockResult = packageLockSchema.safeParse(lockValue);
  if (!lockResult.success) {
    throw new Error("package-lock.json does not contain a valid packages map");
  }

  const report = reportResult.data;
  const lock = lockResult.data;
  const foundIds = new Set<string>();
  const validated: ValidatedAdvisory[] = [];

  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via) {
      if (typeof via === "string") continue;
      const id = parseAdvisoryId(via.url);
      const policy = getAllowedAdvisory(id);
      validateAdvisoryOccurrence(id, via, report, lock, policy);
      foundIds.add(id);
      validated.push({ id, policy });
    }
  }

  const resolved = Object.keys(allowedAdvisories).filter((id) => !foundIds.has(id));
  if (resolved.length > 0) {
    throw new Error(
      `Resolved dependency advisory exceptions must be removed: ${resolved.join(", ")}`,
    );
  }

  const expired = [...foundIds].filter((id) => getAllowedAdvisory(id).expires < today);
  if (expired.length > 0) {
    throw new Error(`Expired dependency advisory exceptions: ${expired.join(", ")}`);
  }

  return validated;
}

/**
 * Check whether one dependency map declares or aliases a package.
 * @param dependencies - Optional dependency map
 * @param packageName - Real vulnerable package name
 * @returns Whether the package is referenced directly or by npm alias
 */
function dependencyMapReferencesPackage(
  dependencies: Record<string, string> | undefined,
  packageName: string,
): boolean {
  return Object.entries(dependencies ?? {}).some(
    ([declaredName, specification]) =>
      declaredName === packageName || specification.startsWith(`npm:${packageName}@`),
  );
}

/**
 * Resolve the unique audit vulnerability for a package when npm reports one.
 * @param report - Validated npm audit report
 * @param packageName - Dependency package name
 * @returns Matching vulnerability, when present
 */
function findAuditVulnerability(
  report: AuditReport,
  packageName: string,
): AuditReport["vulnerabilities"][string] | undefined {
  const matches = Object.entries(report.vulnerabilities).filter(
    ([name, vulnerability]) => name === packageName || vulnerability.name === packageName,
  );
  if (matches.length > 1) {
    throw new Error(`npm audit has multiple vulnerability records for ${packageName}`);
  }
  return matches[0]?.[1];
}

/**
 * Return every lockfile package that declares a child dependency.
 * @param lock - Validated package lock
 * @param packageName - Declared child package name
 * @returns Declaring package names
 */
function findDeclaringPackages(lock: PackageLock, packageName: string): Set<string> {
  return new Set(
    Object.entries(lock.packages)
      .filter(([, entry]) =>
        [
          entry.dependencies,
          entry.devDependencies,
          entry.optionalDependencies,
          entry.peerDependencies,
        ].some((dependencies) => dependencyMapReferencesPackage(dependencies, packageName)),
      )
      .map(([path, entry]) => inferLockPackageName(path, entry) ?? "<root>"),
  );
}

/**
 * Resolve one advisory policy without weakening indexed-access checks.
 * @param id - GitHub Security Advisory ID
 * @returns Structured temporary exception
 */
function getAllowedAdvisory(id: string): AllowedAdvisory {
  const policy = allowedAdvisories[id];
  if (!policy) throw new Error(`Unexpected dependency advisory: ${id}`);
  return policy;
}

/**
 * Infer a lockfile package name from explicit metadata or its node_modules path.
 * @param path - Lockfile package path
 * @param entry - Validated lockfile package entry
 * @returns Real package name when identifiable
 */
function inferLockPackageName(
  path: string,
  entry: PackageLock["packages"][string],
): string | undefined {
  if (entry.name) return entry.name;
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const suffix = path.slice(markerIndex + marker.length);
  const segments = suffix.split("/");
  return suffix.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/** Run the dependency audit command-line checker. */
function main(): void {
  const invocation = getNpmAuditInvocation();
  const audit = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: process.env,
  });
  const lockValue = JSON.parse(readFileSync("package-lock.json", "utf8")) as unknown;
  const validated = checkAuditProcessResult(
    {
      error: audit.error,
      signal: audit.signal,
      status: audit.status,
      stderr: audit.stderr,
      stdout: audit.stdout,
    },
    lockValue,
  );
  for (const { id, policy } of validated) {
    console.log(`Allowed until ${policy.expires}: ${id} (${policy.severity}) - ${policy.reason}`);
  }
}

/**
 * Parse an exact GitHub advisory URL.
 * @param url - Advisory URL from npm
 * @returns GitHub Security Advisory ID
 */
function parseAdvisoryId(url: string): string {
  const match =
    /^https:\/\/github\.com\/advisories\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/.exec(url);
  const id = match?.[1];
  if (!id) throw new Error(`Invalid GitHub advisory URL: ${url}`);
  return id;
}

/**
 * Validate one advisory occurrence against its report and lockfile context.
 * @param id - GitHub Security Advisory ID
 * @param advisory - Advisory occurrence
 * @param report - Validated npm audit report
 * @param lock - Validated package lock
 * @param policy - Temporary exception contract
 */
function validateAdvisoryOccurrence(
  id: string,
  advisory: AuditAdvisory,
  report: AuditReport,
  lock: PackageLock,
  policy: AllowedAdvisory,
): void {
  const advisoryNames = [advisory.name, advisory.dependency].filter(
    (name): name is string => name !== undefined,
  );
  if (advisoryNames.length === 0 || advisoryNames.some((name) => name !== policy.packageName)) {
    throw new Error(`${id} package does not match ${policy.packageName}`);
  }
  if (advisory.severity !== policy.severity) {
    throw new Error(`${id} severity ${advisory.severity} does not match ${policy.severity}`);
  }

  const matchingVulnerabilities = Object.entries(report.vulnerabilities).filter(
    ([packageName, vulnerability]) =>
      packageName === policy.packageName || vulnerability.name === policy.packageName,
  );
  const matchingVulnerability = matchingVulnerabilities[0];
  if (matchingVulnerabilities.length !== 1 || !matchingVulnerability) {
    throw new Error(`${id} has no unique root vulnerability for ${policy.packageName}`);
  }
  const [, vulnerability] = matchingVulnerability;
  if (vulnerability.severity !== policy.severity) {
    throw new Error(
      `${id} root severity ${vulnerability.severity} does not match ${policy.severity}`,
    );
  }
  if (vulnerability.isDirect !== policy.direct) {
    throw new Error(`${id} directness does not match the exception policy`);
  }

  const root = lock.packages[""];
  if (!root) throw new Error("package-lock.json is missing its root package entry");
  const declaredDirectly = [
    root.dependencies,
    root.devDependencies,
    root.optionalDependencies,
    root.peerDependencies,
  ].some((dependencies) => dependencyMapReferencesPackage(dependencies, policy.packageName));
  if (!vulnerability.isDirect && declaredDirectly) {
    throw new Error(
      `${id} is reported as transitive but ${policy.packageName} is declared directly`,
    );
  }

  validateDependencyPath(id, report, lock, policy);

  if (vulnerability.nodes.length === 0) {
    throw new Error(`${id} has no lockfile nodes`);
  }
  const entries = vulnerability.nodes.map((node) => {
    const entry = lock.packages[node];
    if (!entry) throw new Error(`${id} references missing lockfile node ${node}`);
    const actualName = inferLockPackageName(node, entry);
    if (actualName !== policy.packageName) {
      throw new Error(`${id} lockfile node ${node} is ${actualName ?? "unidentifiable"}`);
    }
    return entry;
  });
  const scope: DependencyScope = entries.every((entry) => entry.dev === true)
    ? "development"
    : "runtime";
  if (scope !== policy.scope) {
    throw new Error(`${id} scope ${scope} does not match ${policy.scope}`);
  }
}

/**
 * Validate every edge of an approved dependency path against lockfile declarations
 * and any corresponding npm audit meta-vulnerability links.
 * @param id - GitHub Security Advisory ID
 * @param report - Validated npm audit report
 * @param lock - Validated package lock
 * @param policy - Temporary exception contract
 */
function validateDependencyPath(
  id: string,
  report: AuditReport,
  lock: PackageLock,
  policy: AllowedAdvisory,
): void {
  const vulnerablePackage = policy.dependencyPath.at(-1);
  if (vulnerablePackage !== policy.packageName || policy.dependencyPath.length < 2) {
    throw new Error(`${id} has an invalid dependency path policy`);
  }

  for (let index = 0; index < policy.dependencyPath.length - 1; index += 1) {
    const parentPackageName = policy.dependencyPath[index];
    const childPackageName = policy.dependencyPath[index + 1];
    if (!parentPackageName || !childPackageName) {
      throw new Error(`${id} has an invalid dependency path policy`);
    }

    const declaringPackages = findDeclaringPackages(lock, childPackageName);
    if (declaringPackages.size !== 1 || !declaringPackages.has(parentPackageName)) {
      const parentDiagnostic =
        declaringPackages.size === 0 ? "none" : [...declaringPackages].join(", ");
      throw new Error(
        `${id} parent packages for ${childPackageName} do not match ${parentPackageName}: ${parentDiagnostic}`,
      );
    }

    const childVulnerability = findAuditVulnerability(report, childPackageName);
    if (
      childVulnerability?.effects !== undefined &&
      !childVulnerability.effects.includes(parentPackageName)
    ) {
      throw new Error(
        `${id} audit effects for ${childPackageName} do not include ${parentPackageName}`,
      );
    }
    const parentVulnerability = findAuditVulnerability(report, parentPackageName);
    if (
      parentVulnerability !== undefined &&
      !parentVulnerability.via.some((via) => typeof via === "string" && via === childPackageName)
    ) {
      throw new Error(
        `${id} audit via for ${parentPackageName} does not include ${childPackageName}`,
      );
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
