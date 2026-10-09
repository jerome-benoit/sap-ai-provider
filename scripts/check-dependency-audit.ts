/** Validates npm audit output against narrowly scoped, expiring exceptions. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Contract for one temporary dependency advisory exception. */
export interface AllowedAdvisory {
  dependencyPaths: readonly (readonly string[])[];
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

const auditFixAvailableSchema = z.union([
  z.literal(false),
  z.literal(true),
  z
    .object({
      isSemVerMajor: z.boolean(),
      name: z.string().min(1),
      version: z.string().min(1),
    })
    .strict(),
]);
const auditAdvisorySchema = z.object({
  dependency: z.string().optional(),
  name: z.string().optional(),
  severity: z.string(),
  url: z.string(),
});
const auditVulnerabilitySchema = z.object({
  effects: z.array(z.string()).optional(),
  fixAvailable: auditFixAvailableSchema,
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
  peerDependenciesMeta: z
    .record(z.string(), z.object({ optional: z.boolean().optional() }))
    .optional(),
});
const packageLockSchema = z.object({
  lockfileVersion: z.literal(3),
  packages: z.record(z.string(), lockPackageSchema),
});

type AuditAdvisory = z.infer<typeof auditAdvisorySchema>;
type AuditReport = z.infer<typeof auditReportSchema>;

/** One resolved dependency edge between exact lockfile instances. */
interface DependencyEdge {
  coherent: boolean;
  declaredName: string;
  parentPath: string;
}

/** Exact lockfile instances and their reverse dependency edges. */
interface DependencyGraph {
  incoming: Map<string, DependencyEdge[]>;
  instances: Map<string, PackageInstance>;
}

type LockPackage = z.infer<typeof lockPackageSchema>;

/** One exact package instance from the lockfile packages map. */
interface PackageInstance {
  entry: LockPackage;
  name: string;
  path: string;
}

type PackageLock = z.infer<typeof packageLockSchema>;

/** One active position in an approved dependency route. */
interface PolicyState {
  index: number;
  route: readonly string[];
  routeIndex: number;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";

/** Temporary exceptions keyed by their exact GitHub Security Advisory ID. */
export const allowedAdvisories: Readonly<Record<string, AllowedAdvisory>> = {
  "GHSA-86w9-cpqp-85rv": {
    dependencyPaths: [["@sap-cloud-sdk/connectivity", "jks-js", "node-forge"]],
    direct: false,
    expires: "2026-11-08",
    packageName: "node-forge",
    reason: "No patched node-forge release; transitive through SAP Cloud SDK JKS support.",
    scope: "runtime",
    severity: "high",
  },
  "GHSA-vfj7-8cjw-p6xm": {
    dependencyPaths: [
      ["markdownlint-cli2", "micromatch", "braces"],
      ["markdownlint-cli2", "globby", "micromatch", "braces"],
      ["markdownlint-cli2", "globby", "fast-glob", "micromatch", "braces"],
    ],
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
  if (audit.error) {
    throw new Error(`Unable to run npm audit: ${audit.error.message}`);
  }
  if (audit.signal !== null) {
    throw new Error(`npm audit terminated by signal ${audit.signal}`);
  }
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
      "--include=prod",
      "--include=dev",
      "--include=optional",
      "--include=peer",
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
    throw new Error("package-lock.json is not a valid v3 packages map");
  }

  const report = reportResult.data;
  const graph = buildDependencyGraph(lockResult.data);
  const foundIds = new Set<string>();
  const validated: ValidatedAdvisory[] = [];

  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via) {
      if (typeof via === "string") continue;
      const id = parseAdvisoryId(via.url);
      const policy = getAllowedAdvisory(id);
      validateAdvisoryOccurrence(id, via, report, graph, policy);
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
 * Construct exact lockfile-v3 package instances and resolved Node dependency edges.
 * Effective optional dependencies and optional peer targets may be absent; any
 * required declaration for the same name still requires a resolved target.
 * @param lock - Validated package lock
 * @returns Exact instance graph
 */
function buildDependencyGraph(lock: PackageLock): DependencyGraph {
  const instances = new Map<string, PackageInstance>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const name = path === "" ? "<root>" : inferLockPackageName(path, entry);
    if (!name) {
      throw new Error(`Cannot identify lockfile package instance ${path}`);
    }
    instances.set(path, { entry, name, path });
  }
  if (!instances.has("")) {
    throw new Error("package-lock.json is missing its root package entry");
  }

  const incoming = new Map<string, DependencyEdge[]>();
  for (const parent of instances.values()) {
    const declarations = new Map<string, { expectedNames: Set<string>; required: boolean }>();
    const optionalDependencies = parent.entry.optionalDependencies ?? {};
    for (const field of DEPENDENCY_FIELDS) {
      for (const [declaredName, specification] of Object.entries(parent.entry[field] ?? {})) {
        if (field === "dependencies" && Object.hasOwn(optionalDependencies, declaredName)) continue;
        const expectedName = inferDeclaredPackageName(declaredName, specification);
        const declaration = declarations.get(declaredName) ?? {
          expectedNames: new Set<string>(),
          required: false,
        };
        declaration.expectedNames.add(expectedName);
        const optionalDeclaration =
          field === "optionalDependencies" ||
          (field === "peerDependencies" &&
            parent.entry.peerDependenciesMeta?.[declaredName]?.optional === true);
        declaration.required ||= !optionalDeclaration;
        declarations.set(declaredName, declaration);
      }
    }

    for (const [declaredName, declaration] of declarations) {
      const target = resolveDependencyInstance(parent.path, declaredName, instances);
      if (!target) {
        if (!declaration.required) continue;
        const parentPath = parent.path === "" ? undefined : parent.path;
        throw new Error(
          `Missing dependency target ${declaredName} declared by ${parentPath ?? "<root>"}`,
        );
      }
      const coherent =
        declaration.expectedNames.size === 1 && declaration.expectedNames.has(target.name);
      const edges = incoming.get(target.path) ?? [];
      edges.push({ coherent, declaredName, parentPath: parent.path });
      incoming.set(target.path, edges);
    }
  }
  return { incoming, instances };
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
 * Resolve an npm alias to its true package identity.
 * @param declaredName - Dependency-map key and installation location
 * @param specification - Dependency specification
 * @returns Expected package identity
 */
function inferDeclaredPackageName(declaredName: string, specification: string): string {
  if (!specification.startsWith("npm:")) return declaredName;
  const alias = specification.slice(4);
  const lastAt = alias.lastIndexOf("@");
  const scopeSeparator = alias.startsWith("@") ? alias.indexOf("/") : -1;
  const versionSeparator = alias.startsWith("@") ? (lastAt > scopeSeparator ? lastAt : -1) : lastAt;
  const targetName = versionSeparator > 0 ? alias.slice(0, versionSeparator) : alias;
  const suffix = versionSeparator > 0 ? alias.slice(versionSeparator + 1) : undefined;
  const validTarget = targetName.startsWith("@")
    ? /^@[^/]+\/[^/@]+$/.test(targetName)
    : /^[^/@]+$/.test(targetName);
  if (!validTarget || suffix === "") {
    throw new Error(`Invalid npm alias ${declaredName}: ${specification}`);
  }
  return targetName;
}

/**
 * Infer a package identity from explicit metadata or its exact node_modules path.
 * @param path - Exact lockfile package path
 * @param entry - Validated lockfile package entry
 * @returns Real package identity when one can be inferred
 */
function inferLockPackageName(path: string, entry: LockPackage): string | undefined {
  if (entry.name) return entry.name;
  const marker = "node_modules/";
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const suffix = path.slice(markerIndex + marker.length);
  const segments = suffix.split("/");
  const name = suffix.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  return name === "" ? undefined : name;
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
 * Return the containing package-instance path for one exact lockfile path.
 * @param path - Package instance path, or the root path
 * @returns Containing package path, or undefined above the root
 */
function parentInstancePath(path: string): string | undefined {
  if (path === "") return undefined;
  const markerIndex = path.lastIndexOf("node_modules/");
  if (markerIndex < 0) return undefined;
  return path.slice(0, markerIndex).replace(/\/$/, "");
}

/**
 * Parse an exact GitHub advisory URL.
 * @param url - Advisory URL from npm audit
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
 * Resolve one dependency-map key with Node's nearest-node_modules lookup semantics.
 * @param parentPath - Exact parent package instance path
 * @param declaredName - Dependency installation name
 * @param instances - Exact lockfile package instances
 * @returns Nearest installed target, if present
 */
function resolveDependencyInstance(
  parentPath: string,
  declaredName: string,
  instances: Map<string, PackageInstance>,
): PackageInstance | undefined {
  let prefix: string | undefined = parentPath;
  while (prefix !== undefined) {
    const candidate = prefix
      ? `${prefix}/node_modules/${declaredName}`
      : `node_modules/${declaredName}`;
    const instance = instances.get(candidate);
    if (instance) return instance;
    prefix = parentInstancePath(prefix);
  }
  return undefined;
}

/**
 * Validate one advisory occurrence against its report and exact lockfile instances.
 * @param id - GitHub Security Advisory ID
 * @param advisory - Advisory occurrence
 * @param report - Validated npm audit report
 * @param graph - Exact lockfile instance graph
 * @param policy - Temporary exception contract
 */
function validateAdvisoryOccurrence(
  id: string,
  advisory: AuditAdvisory,
  report: AuditReport,
  graph: DependencyGraph,
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
  if (vulnerability.fixAvailable === true) {
    throw new Error(`${id} has a non-forced npm audit fix available`);
  }
  if (vulnerability.nodes.length === 0) {
    throw new Error(`${id} has no lockfile nodes`);
  }

  validateDependencyPaths(id, report, graph, policy, vulnerability.nodes);

  const entries = vulnerability.nodes.map((node) => {
    const instance = graph.instances.get(node);
    if (!instance) {
      throw new Error(`${id} references missing lockfile node ${node}`);
    }
    if (instance.name !== policy.packageName) {
      throw new Error(`${id} lockfile node ${node} is ${instance.name}`);
    }
    return instance.entry;
  });
  const scope: DependencyScope = entries.every((entry) => entry.dev === true)
    ? "development"
    : "runtime";
  if (scope !== policy.scope) {
    throw new Error(`${id} scope ${scope} does not match ${policy.scope}`);
  }
}

/**
 * Preserve npm audit effects/via validation for an approved graph edge.
 * @param id - GitHub Security Advisory ID
 * @param report - Validated npm audit report
 * @param parentName - Approved parent package identity
 * @param childName - Approved child package identity
 */
function validateAuditMetaEdge(
  id: string,
  report: AuditReport,
  parentName: string,
  childName: string,
): void {
  const childVulnerability = findAuditVulnerability(report, childName);
  if (
    childVulnerability?.effects !== undefined &&
    !childVulnerability.effects.includes(parentName)
  ) {
    throw new Error(`${id} audit effects for ${childName} do not include ${parentName}`);
  }
  const parentVulnerability = findAuditVulnerability(report, parentName);
  if (
    parentVulnerability !== undefined &&
    !parentVulnerability.via.some((via) => typeof via === "string" && via === childName)
  ) {
    throw new Error(`${id} audit via for ${parentName} does not include ${childName}`);
  }
}

/**
 * Validate all incoming routes to every npm-audited instance.
 * @param id - GitHub Security Advisory ID
 * @param report - Validated npm audit report
 * @param graph - Exact lockfile instance graph
 * @param policy - Temporary exception contract
 * @param vulnerableNodes - Exact npm audit lockfile nodes
 */
function validateDependencyPaths(
  id: string,
  report: AuditReport,
  graph: DependencyGraph,
  policy: AllowedAdvisory,
  vulnerableNodes: readonly string[],
): void {
  const states: PolicyState[] = policy.dependencyPaths.map((route, routeIndex) => {
    if (route.length < 2 || route.at(-1) !== policy.packageName) {
      throw new Error(`${id} has an invalid dependency path policy`);
    }
    return { index: route.length - 1, route, routeIndex };
  });
  const memo = new Set<string>();
  const visiting = new Set<string>();
  for (const node of vulnerableNodes) {
    validateIncomingRoutes(id, graph, node, states, memo, visiting);
  }

  const checkedAuditEdges = new Set<string>();
  for (const route of policy.dependencyPaths) {
    for (let index = 0; index < route.length - 1; index += 1) {
      const parentName = route[index];
      const childName = route[index + 1];
      if (!parentName || !childName) {
        throw new Error(`${id} has an invalid dependency path policy`);
      }
      const edgeKey = `${parentName}\0${childName}`;
      if (checkedAuditEdges.has(edgeKey)) continue;
      checkedAuditEdges.add(edgeKey);
      validateAuditMetaEdge(id, report, parentName, childName);
    }
  }
}

/**
 * Validate every reverse edge from one instance and memoized policy-state set.
 * @param id - GitHub Security Advisory ID
 * @param graph - Exact lockfile instance graph
 * @param nodePath - Current exact package instance path
 * @param states - Matching approved-route positions
 * @param memo - Successfully validated instance/state pairs
 * @param visiting - Active instance/state pairs for cycle detection
 */
function validateIncomingRoutes(
  id: string,
  graph: DependencyGraph,
  nodePath: string,
  states: readonly PolicyState[],
  memo: Set<string>,
  visiting: Set<string>,
): void {
  const instance = graph.instances.get(nodePath);
  if (!instance) {
    throw new Error(`${id} references missing lockfile node ${nodePath}`);
  }
  const matchingStates = states.filter((state) => state.route[state.index] === instance.name);
  if (matchingStates.length === 0) {
    throw new Error(`${id} has an unapproved dependency route through ${instance.name}`);
  }
  const stateKey = matchingStates
    .map((state) => `${String(state.routeIndex)}:${String(state.index)}`)
    .sort()
    .join(",");
  const memoKey = `${nodePath}\0${stateKey}`;
  if (memo.has(memoKey)) return;
  if (visiting.has(memoKey)) {
    throw new Error(`${id} has an unresolved dependency cycle at ${nodePath}`);
  }
  visiting.add(memoKey);

  const incoming = graph.incoming.get(nodePath) ?? [];
  let hasCoherentRootEdge = false;
  for (const edge of incoming) {
    if (!edge.coherent) {
      throw new Error(`${id} has an incoherent or ambiguous alias edge for ${edge.declaredName}`);
    }
    hasCoherentRootEdge ||= edge.parentPath === "";
  }
  const isDirectAnchor = hasCoherentRootEdge && matchingStates.some((state) => state.index === 0);
  if (isDirectAnchor) {
    visiting.delete(memoKey);
    memo.add(memoKey);
    return;
  }
  if (incoming.length === 0) {
    visiting.delete(memoKey);
    throw new Error(
      `${id} dependency route for ${nodePath} does not reach a direct root declaration`,
    );
  }
  for (const edge of incoming) {
    if (edge.parentPath === "") {
      if (!matchingStates.some((state) => state.index === 0)) {
        throw new Error(`${id} has an unapproved direct root route to ${instance.name}`);
      }
      continue;
    }
    const parentStates = matchingStates
      .filter((state) => state.index > 0)
      .map((state) => ({ ...state, index: state.index - 1 }));
    if (parentStates.length === 0) {
      throw new Error(`${id} has an additional incoming route to ${instance.name}`);
    }
    validateIncomingRoutes(id, graph, edge.parentPath, parentStates, memo, visiting);
  }

  visiting.delete(memoKey);
  memo.add(memoKey);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
