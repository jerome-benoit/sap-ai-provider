import * as sandcastle from "@ai-hero/sandcastle";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

import type { Finding, LoopResult, LoopStatus, SandboxInstance, TaskSpec } from "./types.js";

import { ITERATION_BUDGET_PER_ROUND, MAX_CRITIC_ROUNDS, parseFindingsSafe } from "./types.js";

const VALIDATION_COMMAND =
  "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2";

/** Options for configuring the refinement loop. */
export interface RefinementLoopOptions {
  /** Budget of iterations per round (flat constant applied to every round). */
  iterationBudget?: number;
  /** Maximum number of implement↔critic rounds. */
  maxRounds?: number;
  /** Optional callback invoked after each round completes. */
  onRoundComplete?: (round: number, findings: Finding[]) => void;
}

/** Result of a single implement↔critic round. */
interface RoundResult {
  /** SHA of HEAD before the implementer ran. */
  beforeSha: string;
  /** Number of commits made by the implementer. */
  commits: number;
  /** Parsed findings from the critic, or null on critic failure. */
  findings: Finding[] | null;
}

/**
 * Runs the implement↔critic refinement loop for a given task.
 * @param spec - The task specification.
 * @param sandbox - The sandcastle sandbox instance.
 * @param opts - Optional configuration for rounds, budget, and callbacks.
 * @returns The loop result with status, commits, findings, and rounds completed.
 */
export async function runRefinementLoop(
  spec: TaskSpec,
  sandbox: SandboxInstance,
  opts?: RefinementLoopOptions,
): Promise<LoopResult> {
  const maxRounds = opts?.maxRounds ?? MAX_CRITIC_ROUNDS;
  const budget = opts?.iterationBudget ?? ITERATION_BUDGET_PER_ROUND;

  const seenKeys = new Set<string>();
  let lastFindings: Finding[] = [];
  let status: LoopStatus = "exhausted";
  let totalCommits = 0;
  let roundsCompleted = 0;
  let previousFindingsCount = Infinity;
  let bestSha = "";
  let bestFindingsCount = Infinity;

  for (let round = 1; round <= maxRounds; round++) {
    roundsCompleted = round;

    console.log(
      `  #${spec.id} round ${String(round)}/${String(maxRounds)} (budget: ${String(budget)})`,
    );

    const result = await executeRound(spec, sandbox, round, budget, lastFindings);

    if (round === 1 && result.commits === 0) {
      console.warn(`  #${spec.id}: 0 commits on round 1. Skipping.`);
      status = "skipped";
      break;
    }

    if (result.findings === null) {
      totalCommits += result.commits;
      console.warn(`  #${spec.id}: Critic failed twice. Breaking (non-converged).`);
      status = "failed";
      break;
    }

    if (round > 1 && result.commits === 0) {
      status = "exhausted";
      break;
    }

    // Fix 1: Validation in-loop (ARCS pattern) — deterministic convergence signal
    if (result.commits > 0) {
      try {
        execFileSync("sh", ["-c", VALIDATION_COMMAND], {
          cwd: sandbox.worktreePath,
          stdio: "pipe",
          timeout: 120_000,
        });
        // Validation passed mid-loop — deterministic convergence
        totalCommits += result.commits;
        status = "converged";
        break;
      } catch {
        // Validation failed — continue to critic for feedback
      }
    }

    // Dedup via context hash
    const cwd = sandbox.worktreePath;
    const newFindings = deduplicateFindings(result.findings, seenKeys, cwd);

    console.log(
      `  #${spec.id}: ${String(result.findings.length)} findings, ${String(newFindings.length)} new`,
    );

    // Quality ratchet: rollback if findings increased (regression)
    const nonLowFindings = result.findings.filter((f) => f.confidence !== "LOW");
    if (
      checkQualityRatchet(
        spec,
        round,
        nonLowFindings.length,
        previousFindingsCount,
        result.beforeSha,
        cwd,
      )
    ) {
      status = "exhausted";
      break;
    }

    // Best-state checkpoint (SWE-Agent pattern) — after ratchet passes
    if (newFindings.length < bestFindingsCount) {
      bestFindingsCount = newFindings.length;
      try {
        bestSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: sandbox.worktreePath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {
        /* empty */
      }
    }

    totalCommits += result.commits;
    previousFindingsCount = nonLowFindings.length;

    opts?.onRoundComplete?.(round, result.findings);

    if (newFindings.length === 0) {
      // Severity-weighted convergence (OpenHands pattern):
      // Don't converge if CRITICAL/HIGH findings persist, even if already seen
      const criticalPersistent = result.findings.filter(
        (f) => (f.severity === "CRITICAL" || f.severity === "HIGH") && f.confidence !== "LOW",
      );
      if (criticalPersistent.length > 0) {
        lastFindings = criticalPersistent;
        status = "exhausted";
        // Capture current HEAD so post-loop reset is a no-op (code matches findings)
        try {
          bestSha = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: sandbox.worktreePath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
        } catch {
          /* empty */
        }
        break;
      }
      if (nonLowFindings.length > 0) {
        lastFindings = nonLowFindings;
      }
      status = "converged";
      break;
    }

    lastFindings = newFindings;
  }

  // Best-state reset: if not converged, restore best intermediate state
  if (status !== "converged" && /^[0-9a-f]{40}$/.test(bestSha)) {
    try {
      execFileSync("git", ["reset", "--hard", bestSha], {
        cwd: sandbox.worktreePath,
        stdio: "pipe",
      });
      const commitCount = execFileSync("git", ["rev-list", "--count", "main..HEAD"], {
        cwd: sandbox.worktreePath,
        encoding: "utf-8",
      }).trim();
      totalCommits = parseInt(commitCount, 10) || 0;
    } catch {
      /* empty */
    }
  }

  return { lastFindings, roundsCompleted, status, totalCommits };
}

/**
 * Checks whether findings regressed compared to the previous round and rolls back if so.
 * @param spec - The task specification.
 * @param round - Current round number.
 * @param findingsCount - Number of non-LOW findings this round.
 * @param previousCount - Number of non-LOW findings from the previous round.
 * @param beforeSha - SHA to reset to on regression.
 * @param cwd - Working directory for git operations.
 * @returns True if a regression was detected and rollback performed.
 */
function checkQualityRatchet(
  spec: TaskSpec,
  round: number,
  findingsCount: number,
  previousCount: number,
  beforeSha: string,
  cwd: string,
): boolean {
  if (round <= 2 || findingsCount <= previousCount) {
    return false;
  }

  // Validate SHA format before passing to execFileSync
  if (!/^[0-9a-f]{40}$/.test(beforeSha)) {
    console.warn(`  #${spec.id}: Invalid SHA for rollback, skipping reset.`);
    return true;
  }

  try {
    execFileSync("git", ["reset", "--hard", beforeSha], {
      cwd,
      stdio: "pipe",
    });
    console.warn(
      `  #${spec.id} R${String(round)}: Regression detected (${String(previousCount)} → ${String(findingsCount)}). Rolled back.`,
    );
  } catch {
    console.warn(`  #${spec.id}: Failed to reset to ${beforeSha} after regression.`);
  }

  return true;
}

/**
 * Filters findings by confidence and deduplicates against previously seen keys.
 * @param findings - Raw findings from the critic.
 * @param seenKeys - Set of previously seen dedup keys (mutated: new keys are added).
 * @param cwd - Working directory for context hashing.
 * @returns Array of new, non-LOW-confidence findings.
 */
function deduplicateFindings(findings: Finding[], seenKeys: Set<string>, cwd: string): Finding[] {
  const fileCache = new Map<string, string>();
  const newFindings = findings.filter(
    (f) => f.confidence !== "LOW" && !seenKeys.has(findingKey(f, cwd, fileCache)),
  );
  for (const f of newFindings) {
    seenKeys.add(findingKey(f, cwd, fileCache));
  }
  return newFindings;
}

/**
 * Executes a single implement↔critic round.
 * @param spec - The task specification.
 * @param sandbox - The sandcastle sandbox instance.
 * @param round - Current round number (1-indexed).
 * @param budget - Iteration budget for the implementer.
 * @param lastFindings - Findings from the previous round to feed to the implementer.
 * @returns The round result containing commits, findings, and the pre-round SHA.
 */
async function executeRound(
  spec: TaskSpec,
  sandbox: SandboxInstance,
  round: number,
  budget: number,
  lastFindings: Finding[],
): Promise<RoundResult> {
  const findingsArg = lastFindings.length > 0 ? JSON.stringify(lastFindings, null, 2) : "";

  // Capture SHA before implementer runs (for quality ratchet rollback)
  let beforeSha = "";
  try {
    beforeSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sandbox.worktreePath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    console.warn(`  #${spec.id}: Failed to capture HEAD SHA before round ${String(round)}.`);
  }

  // Implementer
  let impl: Awaited<ReturnType<typeof sandbox.run>>;
  try {
    impl = await sandbox.run({
      agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
      maxIterations: budget,
      name: `Implementer #${spec.id} R${String(round)}`,
      promptArgs: {
        BRANCH: spec.branch,
        FINDINGS: findingsArg,
        ISSUE_BODY: spec.body,
        ISSUE_TITLE: spec.title,
        TASK_ID: spec.id,
      },
      promptFile: "./.sandcastle/implement-prompt.md",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`  #${spec.id} R${String(round)}: Implementer threw: ${msg}`);
    return { beforeSha, commits: 0, findings: null };
  }

  // Critic
  const nonce = crypto.randomBytes(4).toString("hex");
  let findings: Finding[] | null;
  try {
    findings = await runCritic(sandbox, spec, round, nonce);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  #${spec.id} R${String(round)}: Critic threw: ${msg}`);
    findings = null;
  }

  return { beforeSha, commits: impl.commits.length, findings };
}

/**
 * Computes a deduplication key for a finding using a context hash of surrounding lines.
 * @param f - Finding to compute a key for.
 * @param cwd - Working directory (worktree path) for reading file context.
 * @param fileCache - Optional cache of file contents keyed by resolved path.
 * @returns Composite dedup key.
 */
function findingKey(f: Finding, cwd: string, fileCache?: Map<string, string>): string {
  if (!f.file || f.line == null) {
    const normalizedTitle = f.title
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const titleHash = crypto
      .createHash("sha256")
      .update(normalizedTitle)
      .digest("hex")
      .slice(0, 16);
    return `${f.file || "global"}::${f.category}::${titleHash}`;
  }
  const contextHash = hashContextLines(cwd, f.file, f.line, 3, fileCache);
  return `${f.file}::${f.category}::${contextHash}`;
}

/**
 * Hashes a window of lines around the finding for dedup stability.
 * @param cwd - Working directory.
 * @param file - Relative file path.
 * @param line - Line number of the finding.
 * @param radius - Number of lines above/below to include in the context window.
 * @param fileCache - Optional cache of file contents keyed by resolved path.
 * @returns Truncated SHA-256 hex digest.
 */
function hashContextLines(
  cwd: string,
  file: string,
  line: number,
  radius: number,
  fileCache?: Map<string, string>,
): string {
  try {
    const fullPath = realpathSync(join(cwd, file));
    if (!fullPath.startsWith(realpathSync(cwd) + sep)) {
      throw new Error("Path traversal");
    }
    let raw: string;
    const cached = fileCache?.get(fullPath);
    if (cached !== undefined) {
      raw = cached;
    } else {
      raw = readFileSync(fullPath, "utf-8");
      if (fileCache) fileCache.set(fullPath, raw);
    }
    const lines = raw.split("\n");
    const idx = Math.min(Math.max(0, line - 1), lines.length - 1);
    const start = Math.max(0, idx - radius);
    const end = Math.min(lines.length - 1, idx + radius);
    const window = lines.slice(start, end + 1).join("\n");
    const normalized = window.replace(/\s+/g, " ").trim();
    return crypto
      .createHash("sha256")
      .update(`${file}:${String(line)}:${normalized}`)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return crypto
      .createHash("sha256")
      .update(`${file}:${String(line)}:fallback`)
      .digest("hex")
      .slice(0, 16);
  }
}

/**
 * Parses findings from agent stdout using nonce-tagged delimiters.
 * @param stdout - Agent stdout to parse findings from.
 * @param nonce - Unique tag identifier for this run.
 * @returns Parsed findings array or null on parse failure.
 */
function parseFindings(stdout: string, nonce: string): Finding[] | null {
  if (!/^[0-9a-f]+$/.test(nonce)) return null;
  const tagPattern = new RegExp(`<findings-${nonce}>([\\s\\S]*?)<\\/findings-${nonce}>`, "g");
  const matches = [...stdout.matchAll(tagPattern)];
  if (matches.length === 0) return null;
  // Find last non-trivial match
  for (let i = matches.length - 1; i >= 0; i--) {
    const raw = matches[i]?.[1]?.trim() ?? "";
    if (raw.length < 2) continue;
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/g, "").replace(/\n?```\s*$/g, "");
    try {
      return parseFindingsSafe(JSON.parse(cleaned));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Runs the critic agent, retrying once on parse failure.
 * @param sandbox - The sandcastle sandbox instance.
 * @param spec - The task specification.
 * @param round - Current round number.
 * @param nonce - Unique nonce for parsing.
 * @returns Parsed findings or null if both attempts failed.
 */
async function runCritic(
  sandbox: SandboxInstance,
  spec: TaskSpec,
  round: number,
  nonce: string,
): Promise<Finding[] | null> {
  let critic = await sandbox.run({
    agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
    maxIterations: 1,
    name: `Critic #${spec.id} R${String(round)}`,
    promptArgs: {
      BRANCH: spec.branch,
      NONCE: nonce,
    },
    promptFile: "./.sandcastle/critic-prompt.md",
  });

  let findings = parseFindings(critic.stdout, nonce);

  if (findings === null) {
    console.warn(`  #${spec.id}: Critic parse failed. Retrying.`);
    critic = await sandbox.run({
      agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
      maxIterations: 1,
      name: `Critic #${spec.id} R${String(round)} retry`,
      promptArgs: {
        BRANCH: spec.branch,
        NONCE: nonce,
      },
      promptFile: "./.sandcastle/critic-prompt.md",
    });
    findings = parseFindings(critic.stdout, nonce);
  }

  return findings;
}
