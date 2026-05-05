import * as sandcastle from "@ai-hero/sandcastle";
import crypto from "node:crypto";

import type { Finding, LoopResult, LoopStatus, SandboxInstance, TaskSpec } from "./types.js";

import { FindingsSchema, ITERATION_BUDGET, MAX_CRITIC_ROUNDS } from "./types.js";

/** Options for configuring the refinement loop. */
export interface RefinementLoopOptions {
  /** Budget of iterations per round (array indexed by round - 1). */
  iterationBudget?: readonly number[];
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
  const iterationBudget = opts?.iterationBudget ?? ITERATION_BUDGET;

  const seenKeys = new Set<string>();
  let lastFindings: Finding[] = [];
  let status: LoopStatus = "exhausted";
  let totalCommits = 0;
  let roundsCompleted = 0;

  for (let round = 1; round <= maxRounds; round++) {
    roundsCompleted = round;
    const budget = iterationBudget[round - 1] ?? 10;
    const findingsArg = lastFindings.length > 0 ? JSON.stringify(lastFindings, null, 2) : "";

    console.log(
      `  #${spec.id} round ${String(round)}/${String(maxRounds)} (budget: ${String(budget)})`,
    );

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

    totalCommits += impl.commits.length;

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

    // Dedup
    const newFindings = findings.filter(
      (f) => f.confidence !== "LOW" && !seenKeys.has(findingKey(f)),
    );
    for (const f of newFindings) {
      seenKeys.add(findingKey(f));
    }

    console.log(
      `  #${spec.id}: ${String(findings.length)} findings, ${String(newFindings.length)} new`,
    );

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
 * Computes a deduplication key for a finding.
 * @param f - Finding to compute a key for.
 * @returns Composite dedup key.
 */
function findingKey(f: Finding): string {
  const normalizedTitle = f.title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${f.file}::${f.category}::${normalizedTitle}`;
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
