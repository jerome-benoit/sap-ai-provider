import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import { z } from "zod";

const BRANCH_PREFIX = "agent/issue";
const ESCAPED_PREFIX = BRANCH_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BRANCH_PATTERN = new RegExp(`^${ESCAPED_PREFIX}-\\d+-[\\w-]+$`);
const ISSUE_LABEL = "sandcastle";
const MAX_PLANNER_RETRIES = 5;
const MAX_CRITIC_ROUNDS = 5;
const ITERATION_BUDGET = [100, 50, 25, 10, 10];
const MAX_PARALLEL = 3;
const DOCKER_IMAGE = "sandcastle-sap-ai";

const FindingSchema = z.object({
  category: z.enum(["security", "logic", "performance", "architecture", "style"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  description: z.string(),
  file: z.string(),
  line: z.number().optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  suggestion: z.string().optional(),
  title: z.string(),
});
const FindingsSchema = z.array(FindingSchema);
type Finding = z.infer<typeof FindingSchema>;

// --- Zod schema for GitHub issue list response (fix #6) ---

const RawIssueSchema = z.object({
  body: z
    .string()
    .nullable()
    .transform((b) => b ?? ""),
  labels: z.array(z.object({ name: z.string() })),
  number: z.number(),
  title: z.string(),
});
const RawIssuesSchema = z.array(RawIssueSchema);

// --- Type alias for sandbox instance ---

type SandboxInstance = Awaited<ReturnType<typeof sandcastle.createSandbox>>;

/**
 * @param sandbox - The sandcastle sandbox instance.
 * @param cwd - Working directory (worktree path).
 * @param issue - Issue metadata.
 * @param issue.body
 * @param issue.branch
 * @param issue.id
 * @param issue.title
 * @param converged - Whether the critic loop converged.
 * @param lastFindings - Outstanding findings from the last round.
 * @param round - The round at which the critic loop ended.
 * @returns Whether work was completed (PR created).
 */
async function finalizeIssue(
  sandbox: SandboxInstance,
  cwd: string,
  issue: { body: string; branch: string; id: string; title: string },
  converged: boolean,
  lastFindings: Finding[],
  round: number,
): Promise<boolean> {
  let validationPassed = false;

  try {
    execSync(
      "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2",
      { cwd, stdio: "pipe" },
    );
    validationPassed = true;
  } catch {
    console.warn(`  #${issue.id}: Validation failed.`);
  }

  // --- Validation retry round (fix #7) ---
  if (!validationPassed && round < MAX_CRITIC_ROUNDS) {
    const retryBudget = ITERATION_BUDGET[MAX_CRITIC_ROUNDS - 1] ?? 10;
    console.log(
      `  #${issue.id}: Retrying one more implement→critic round (budget: ${String(retryBudget)})`,
    );

    try {
      await sandbox.run({
        agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
        maxIterations: retryBudget,
        name: `Implementer #${issue.id} retry`,
        promptArgs: {
          BRANCH: issue.branch,
          FINDINGS: lastFindings.length > 0 ? JSON.stringify(lastFindings, null, 2) : "",
          ISSUE_BODY: issue.body,
          ISSUE_TITLE: issue.title,
          TASK_ID: issue.id,
        },
        promptFile: "./.sandcastle/implement-prompt.md",
      });
    } catch (retryErr: unknown) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.warn(
        `  #${issue.id}: Implementer retry threw: ${retryMsg}. Falling through to PR creation.`,
      );
    }

    // Re-validate after retry
    try {
      execSync(
        "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2",
        { cwd, stdio: "pipe" },
      );
      validationPassed = true;
      console.log(`  #${issue.id}: Validation passed after retry round.`);
    } catch {
      console.warn(`  #${issue.id}: Validation still fails after retry. Will create draft PR.`);
    }
  }

  // Rebase on latest main
  let rebaseSucceeded = false;
  try {
    execSync("git fetch origin main && git rebase origin/main", {
      cwd,
      stdio: "pipe",
    });
    rebaseSucceeded = true;
    if (validationPassed) {
      // Post-rebase smoke test
      try {
        execSync("npm run type-check && npm run test", {
          cwd,
          stdio: "pipe",
        });
      } catch {
        validationPassed = false;
      }
    }
  } catch {
    // Rebase failed — abort and push un-rebased
    try {
      execSync("git rebase --abort", { cwd, stdio: "pipe" });
    } catch {
      /* empty */
    }
    try {
      execSync("git push", { cwd, stdio: "pipe" });
    } catch (pushErr: unknown) {
      const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      console.warn(`  #${issue.id}: git push failed after rebase abort: ${pushMsg}`);
    }
  }

  if (rebaseSucceeded) {
    try {
      execSync("git push --force-with-lease", { cwd, stdio: "pipe" });
    } catch (pushErr: unknown) {
      const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      console.warn(
        `  #${issue.id}: git push --force-with-lease failed (branch un-pushed, PR creation will fail gracefully): ${pushMsg}`,
      );
    }
  }

  // Create PR (fix #1: use execFileSync to avoid shell injection)
  const isDraft = !converged || !validationPassed;
  const outstandingNote =
    !converged && lastFindings.length > 0
      ? `\n\n⚠️ Outstanding findings:\n${lastFindings.map((f) => `- [${f.severity}] ${f.file}: ${f.title}`).join("\n")}`
      : "";
  const validationNote = !validationPassed
    ? "\n\n⚠️ Validation did not pass. Manual review required."
    : "";

  const prTitle = `fix: resolve #${issue.id} — ${issue.title}`;
  const prBody = `## Description\n\nAutomated fix for #${issue.id}: ${issue.title}\n\n## Type of Change\n\n- [x] Bug fix (non-breaking change that fixes an issue)\n\n## Checklist\n\n- [x] I have run validation suite\n- [x] My changes follow the existing code style\n\n## Related Issues\n\nFixes #${issue.id}${outstandingNote}${validationNote}`;

  const prArgs = [
    "pr",
    "create",
    ...(isDraft ? ["--draft"] : []),
    "--head",
    issue.branch,
    "--base",
    "main",
    "--title",
    prTitle,
    "--body",
    prBody,
  ];

  try {
    execFileSync("gh", prArgs, { cwd, encoding: "utf-8", stdio: "pipe" });
    console.log(`  #${issue.id}: PR created${isDraft ? " (draft)" : ""}.`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  #${issue.id}: PR creation failed: ${msg}`);
    return false;
  }
}

/**
 * @param f - Finding to compute dedup key for.
 * @returns Composite key for deterministic deduplication.
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
 * @param text - Raw text to strip injection-prone tags from.
 * @returns Sanitized text safe for prompt injection.
 */
function sanitizeForPrompt(text: string): string {
  return text.replace(/<\/?(?:plan|findings[\w-]*|promise)[^>]*>/gi, "");
}

// --- Phase 1: Fetch and sanitize issues ---

let rawIssuesJson: string;
try {
  rawIssuesJson = execSync(
    `gh issue list --state open --json number,title,labels,body --limit 50 --label "${ISSUE_LABEL}"`,
    { encoding: "utf-8" },
  );
} catch {
  console.error("Failed to fetch issues. Ensure gh is installed and authenticated.");
  process.exit(1);
}

let rawIssues: z.infer<typeof RawIssuesSchema>;
try {
  rawIssues = RawIssuesSchema.parse(JSON.parse(rawIssuesJson));
} catch {
  console.error("Failed to parse issues JSON. Unexpected format from gh CLI.");
  process.exit(1);
}

const issuesJson = rawIssues.map((i) => ({
  body: sanitizeForPrompt(i.body),
  labels: i.labels.map((l) => l.name),
  number: i.number,
  title: i.title,
}));

if (issuesJson.length === 0) {
  console.log("No issues with label '%s'. Exiting.", ISSUE_LABEL);
  process.exit(0);
}

// --- Phase 2: Plan ---

let workCompleted = false;

for (let attempt = 1; attempt <= MAX_PLANNER_RETRIES; attempt++) {
  console.log(`\n=== Planner attempt ${String(attempt)}/${String(MAX_PLANNER_RETRIES)} ===\n`);

  const plan = await sandcastle.run({
    agent: sandcastle.opencode("github-copilot/claude-opus-4.6"),
    maxIterations: 1,
    name: "Planner",
    promptArgs: {
      BRANCH_PREFIX,
      ISSUES_JSON: JSON.stringify(issuesJson, null, 2),
    },
    promptFile: "./.sandcastle/plan-prompt.md",
    sandbox: docker({ imageName: DOCKER_IMAGE }),
  });

  const planMatches = [...plan.stdout.matchAll(/<plan>([\s\S]*?)<\/plan>/g)];
  const planMatch = planMatches.at(-1);
  if (!planMatch) {
    console.error("Planner did not produce a <plan> tag. Retrying.");
    continue;
  }

  const planContent = planMatch[1] ?? "";
  let issues: { body: string; branch: string; id: string; title: string }[];
  try {
    const parsed = JSON.parse(planContent) as { issues: unknown[] };
    if (!Array.isArray(parsed.issues)) {
      console.error("Planner output missing issues array. Retrying.");
      continue;
    }
    const validated = parsed.issues.filter(
      (entry): entry is { body: string; branch: string; id: string; title: string } => {
        if (typeof entry !== "object" || entry === null) return false;
        const item = entry as Record<string, unknown>;
        if (typeof item.id !== "string" || !/^\d+$/.test(item.id)) return false;
        if (typeof item.branch !== "string" || !BRANCH_PATTERN.test(item.branch)) return false;
        if (typeof item.title !== "string") return false;
        return true;
      },
    );
    // Attach sanitized body from our fetched data
    issues = validated.map((v) => ({
      ...v,
      body: issuesJson.find((i) => String(i.number) === v.id)?.body ?? "",
    }));
  } catch {
    console.error("Planner produced invalid JSON. Retrying.");
    continue;
  }

  if (issues.length === 0) {
    console.log("No actionable issues. Exiting.");
    workCompleted = true;
    break;
  }

  console.log(`Plan: ${String(issues.length)} issue(s) to work on:`);
  for (const issue of issues) {
    console.log(`  #${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // --- Phase 3: Implement ↔ Critic loop (parallel, max 3) ---

  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    running < MAX_PARALLEL
      ? (running++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(resolve));
  const release = () => {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  };

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      await acquire();
      try {
        await using sandbox = await sandcastle.createSandbox({
          branch: issue.branch,
          copyToWorktree: ["node_modules"],
          hooks: {
            sandbox: { onSandboxReady: [{ command: "npm install && npm run build" }] },
          },
          sandbox: docker({ imageName: DOCKER_IMAGE }),
        });

        const seenKeys = new Set<string>();
        let lastFindings: Finding[] = [];
        let converged = false;
        let totalCommits = 0;
        let lastRound = 0;

        for (let round = 1; round <= MAX_CRITIC_ROUNDS; round++) {
          lastRound = round;
          const budget = ITERATION_BUDGET[round - 1] ?? 10;
          const findingsArg = lastFindings.length > 0 ? JSON.stringify(lastFindings, null, 2) : "";

          console.log(
            `  #${issue.id} round ${String(round)}/${String(MAX_CRITIC_ROUNDS)} (budget: ${String(budget)})`,
          );

          // Implementer
          const impl = await sandbox.run({
            agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
            maxIterations: budget,
            name: `Implementer #${issue.id} R${String(round)}`,
            promptArgs: {
              BRANCH: issue.branch,
              FINDINGS: findingsArg,
              ISSUE_BODY: issue.body,
              ISSUE_TITLE: issue.title,
              TASK_ID: issue.id,
            },
            promptFile: "./.sandcastle/implement-prompt.md",
          });

          totalCommits += impl.commits.length;

          if (round === 1 && impl.commits.length === 0) {
            console.warn(`  #${issue.id}: 0 commits on round 1. Skipping.`);
            break;
          }

          // Critic
          const nonce = crypto.randomBytes(4).toString("hex");

          let critic = await sandbox.run({
            agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
            maxIterations: 1,
            name: `Critic #${issue.id} R${String(round)}`,
            promptArgs: {
              BRANCH: issue.branch,
              NONCE: nonce,
            },
            promptFile: "./.sandcastle/critic-prompt.md",
          });

          let findings = parseFindings(critic.stdout, nonce);

          // Retry once on parse failure
          if (findings === null) {
            console.warn(`  #${issue.id}: Critic parse failed. Retrying.`);
            critic = await sandbox.run({
              agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
              maxIterations: 1,
              name: `Critic #${issue.id} R${String(round)} retry`,
              promptArgs: {
                BRANCH: issue.branch,
                NONCE: nonce,
              },
              promptFile: "./.sandcastle/critic-prompt.md",
            });
            findings = parseFindings(critic.stdout, nonce);
          }

          if (findings === null) {
            console.warn(`  #${issue.id}: Critic failed twice. Breaking (non-converged).`);
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
            `  #${issue.id}: ${String(findings.length)} findings, ${String(newFindings.length)} new`,
          );

          if (newFindings.length === 0) {
            const nonLowFindings = findings.filter((f) => f.confidence !== "LOW");
            if (nonLowFindings.length > 0) {
              lastFindings = nonLowFindings;
              converged = false;
            } else {
              converged = true;
            }
            break;
          }

          lastFindings = newFindings;
        }

        // --- Final validation, rebase, and PR creation ---
        if (totalCommits > 0) {
          const cwd = sandbox.worktreePath;
          const prCreated = await finalizeIssue(
            sandbox,
            cwd,
            issue,
            converged,
            lastFindings,
            lastRound,
          );
          if (prCreated) {
            workCompleted = true;
          }
        }

        return { converged, issue, totalCommits };
      } finally {
        release();
      }
    }),
  );

  // Log failures
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const issue = issues[i];
      const reason: unknown = outcome.reason;
      const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
      console.error(`  ✗ #${issue?.id ?? String(i)} failed: ${msg}`);
    }
  }

  break; // Plan executed — exit planner retry loop
}

console.log("\nAll done.");

if (!workCompleted) {
  process.exitCode = 1;
}
