import { spawnSync } from "node:child_process";

interface AllowedAdvisory {
  expires: string;
  reason: string;
}

interface AuditAdvisory {
  severity?: string;
  title?: string;
  url?: string;
}

interface AuditReport {
  vulnerabilities?: Record<string, { via: (AuditAdvisory | string)[] }>;
}

const allowedAdvisories: Record<string, AllowedAdvisory> = {
  "GHSA-86w9-cpqp-85rv": {
    expires: "2026-11-08",
    reason: "No patched node-forge release; transitive through SAP Cloud SDK JKS support.",
  },
  "GHSA-vfj7-8cjw-p6xm": {
    expires: "2026-11-08",
    reason: "No patched braces release; development-only fixed Markdownlint glob patterns.",
  },
};

const npmInvocation =
  process.platform === "win32"
    ? {
        args: ["/d", "/s", "/c", "npm.cmd audit --json"],
        command: process.env.ComSpec ?? "cmd.exe",
      }
    : { args: ["audit", "--json"], command: "npm" };
const audit = spawnSync(npmInvocation.command, npmInvocation.args, {
  encoding: "utf8",
  env: process.env,
});

if (audit.error) {
  console.error(`Unable to run npm audit: ${audit.error.message}`);
  process.exit(1);
}

let report: AuditReport;
try {
  report = JSON.parse(audit.stdout) as AuditReport;
} catch {
  console.error("npm audit did not return valid JSON");
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

if (!report.vulnerabilities) {
  console.error("npm audit did not return a vulnerability report");
  process.exit(1);
}

const advisories = new Map<string, AuditAdvisory>();
for (const vulnerability of Object.values(report.vulnerabilities)) {
  for (const via of vulnerability.via) {
    if (typeof via === "string" || !via.url) continue;
    const id = via.url.split("/").at(-1);
    if (id) advisories.set(id, via);
  }
}

const today = new Date().toISOString().slice(0, 10);
const unexpected = [...advisories.keys()].filter((id) => !Object.hasOwn(allowedAdvisories, id));
const expired = Object.entries(allowedAdvisories)
  .filter(([id, allowed]) => advisories.has(id) && allowed.expires < today)
  .map(([id]) => id);
const resolved = Object.keys(allowedAdvisories).filter((id) => !advisories.has(id));

if (unexpected.length > 0) {
  console.error(`Unexpected dependency advisories: ${unexpected.join(", ")}`);
}
if (expired.length > 0) {
  console.error(`Expired dependency advisory exceptions: ${expired.join(", ")}`);
}
if (resolved.length > 0) {
  console.error(`Resolved dependency advisory exceptions must be removed: ${resolved.join(", ")}`);
}
if (unexpected.length > 0 || expired.length > 0 || resolved.length > 0) process.exit(1);

if (advisories.size === 0) {
  console.log("npm audit found no known vulnerabilities");
  process.exit(0);
}

for (const [id, advisory] of advisories) {
  const allowed = allowedAdvisories[id];
  if (!allowed) throw new Error(`Missing allowed advisory metadata for ${id}`);
  console.log(
    `Allowed until ${allowed.expires}: ${id} (${advisory.severity ?? "unknown"}) - ${allowed.reason}`,
  );
}
