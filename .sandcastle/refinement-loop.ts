import * as sandcastle from "@ai-hero/sandcastle";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Finding, LoopResult, LoopStatus, SandboxInstance, TaskSpec } from "./types.js";

import { FindingsSchema, ITERATION_BUDGET_PER_ROUND, MAX_CRITIC_ROUNDS } from "./types.js";

/** Options for configuring the refinement loop. */
export interface RefinementLoopOptions {
  /** Budget of iterations per round (flat constant applied to every round). */
  iterationBudget?: number;
  /** Maximum number of implement↔critic rounds. */
  maxRounds?: number;
  /** Optional callback invoked after each round completes. */
  onRoundComplete?: (round: number, findings: Finding[]) => void;
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

  for (let round = 1; round <= maxRounds; round++) {
    roundsCompleted = round;
    const findingsArg = lastFindings.length > 0 ? JSON.stringify(lastFindings, null, 2) : "";

    console.log(
      `  #${spec.id} round ${String(round)}/${String(maxRounds)} (budget: ${String(budget)})`,
    );

    // Capture SHA before implementer runs (for quality ratchet rollback)
    let beforeRoundSha = "";
    try {
      beforeRoundSha = execSync("git rev-parse HEAD", {
        cwd: sandbox.worktreePath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      /* empty */
    }

    // Implementer
    const impl = await sandbox.run({
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

    if (round === 1 && impl.commits.length === 0) {
      console.warn(`  #${spec.id}: 0 commits on round 1. Skipping.`);
      status = "skipped";
      break;
    }

    if (round > 1 && impl.commits.length === 0) {
      status = "exhausted";
      break;
    }

    // Critic
    const nonce = crypto.randomBytes(4).toString("hex");
    const findings = await runCritic(sandbox, spec, round, nonce);

    if (findings === null) {
      console.warn(`  #${spec.id}: Critic failed twice. Breaking (non-converged).`);
      status = "failed";
      break;
    }

    // Dedup via context hash
    const cwd = sandbox.worktreePath;
    const newFindings = findings.filter(
      (f) => f.confidence !== "LOW" && !seenKeys.has(findingKey(f, cwd)),
    );
    for (const f of newFindings) {
      seenKeys.add(findingKey(f, cwd));
    }

    console.log(
      `  #${spec.id}: ${String(findings.length)} findings, ${String(newFindings.length)} new`,
    );

    // Quality ratchet: rollback if findings increased (regression)
    const nonLowFindings = findings.filter((f) => f.confidence !== "LOW");
    if (round > 1 && nonLowFindings.length > previousFindingsCount) {
      try {
        execSync(`git reset --hard ${beforeRoundSha}`, {
          cwd: sandbox.worktreePath,
          stdio: "pipe",
        });
        console.warn(
          `  #${spec.id} R${String(round)}: Regression detected (${String(previousFindingsCount)} → ${String(findings.length)}). Rolled back.`,
        );
      } catch {
        /* empty */
      }
      status = "exhausted";
      break;
    }
    totalCommits += impl.commits.length;
    previousFindingsCount = nonLowFindings.length;

    opts?.onRoundComplete?.(round, findings);

    if (newFindings.length === 0) {
      const nonLowFindings = findings.filter((f) => f.confidence !== "LOW");
      if (nonLowFindings.length > 0) {
        lastFindings = nonLowFindings;
        status = "exhausted";
      } else {
        status = "converged";
      }
      break;
    }

    lastFindings = newFindings;
  }

  return { lastFindings, roundsCompleted, status, totalCommits };
}

/**
 * Computes a deduplication key for a finding using a context hash of surrounding lines.
 * @param f - Finding to compute a key for.
 * @param cwd - Working directory (worktree path) for reading file context.
 * @returns Composite dedup key.
 */
function findingKey(f: Finding, cwd: string): string {
  if (!f.file || f.line == null) {
    const normalizedTitle = f.title
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const titleHash = crypto.createHash("sha256").update(normalizedTitle).digest("hex").slice(0, 16);
    return `${f.file || "global"}::${f.category}::${titleHash}`;
  }
  const contextHash = hashContextLines(cwd, f.file, f.line, 3);
  return `${f.file}::${f.category}::${contextHash}`;
}

/**
 * Hashes the target line content for dedup stability.
 * @param cwd - Working directory.
 * @param file - Relative file path.
 * @param line - Line number of the finding.
 * @param _radius - Unused; kept for call-site compatibility.
 * @returns Truncated SHA-256 hex digest.
 */
function hashContextLines(cwd: string, file: string, line: number, _radius: number): string {
  try {
    const fullPath = join(cwd, file);
    if (!fullPath.startsWith(cwd)) {
      throw new Error("Path traversal");
    }
    const raw = readFileSync(fullPath, "utf-8");
    const lines = raw.split("\n");
    const targetLine = lines[Math.max(0, line - 1)] ?? "";
    const normalized = targetLine.replace(/\s+/g, " ").trim();
    // Include file path as salt to prevent cross-file hash collisions
    return crypto.createHash("sha256").update(`${file}:${normalized}`).digest("hex").slice(0, 16);
  } catch {
    const truncTitle = file.slice(0, 30) + String(line);
    return crypto.createHash("sha256").update(truncTitle).digest("hex").slice(0, 16);
  }
}

/**
 * Parses findings from agent stdout using nonce-tagged delimiters.
 * @param stdout - Agent stdout to parse findings from.
 * @param nonce - Unique tag identifier for this run.
 * @returns Parsed findings array or null on parse failure.
 */
function parseFindings(stdout: string, nonce: string): Finding[] | null {
  const tagPattern = new RegExp(`<findings-${nonce}>([\\s\\S]*?)<\\/findings-${nonce}>`, "g");
  const matches = [...stdout.matchAll(tagPattern)];
  if (matches.length === 0) {
    return null;
  }
  const raw = matches.at(-1)?.[1]?.trim() ?? "[]";
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/g, "").replace(/\n?```\s*$/g, "");
  try {
    return FindingsSchema.parse(JSON.parse(cleaned));
  } catch {
    return null;
  }
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
