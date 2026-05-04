import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const BRANCH_PREFIX = "agent/issue";
const ESCAPED_PREFIX = BRANCH_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BRANCH_PATTERN = new RegExp(`^${ESCAPED_PREFIX}-\\d+-[\\w-]+$`);
const ISSUE_LABEL = "sandcastle";
const LABEL_FILTER = `--label "${ISSUE_LABEL}"`;
const MAX_PLANNER_RETRIES = 5;
const MAX_PARALLEL = 3;
const DOCKER_IMAGE = "sandcastle-sap-ai";

let workCompleted = false;

for (let iteration = 1; iteration <= MAX_PLANNER_RETRIES; iteration++) {
  console.log(`\n=== Iteration ${String(iteration)}/${String(MAX_PLANNER_RETRIES)} ===\n`);

  // Phase 1: Plan
  const plan = await sandcastle.run({
    agent: sandcastle.opencode("github-copilot/claude-opus-4.6"),
    maxIterations: 1,
    name: "Planner",
    promptArgs: {
      BRANCH_PREFIX,
      LABEL_FILTER,
    },
    promptFile: "./.sandcastle/plan-prompt.md",
    sandbox: docker({ imageName: DOCKER_IMAGE }),
  });

  const planMatches = [...plan.stdout.matchAll(/<plan>([\s\S]*?)<\/plan>/g)];
  const planMatch = planMatches.at(-1);
  if (!planMatch) {
    console.error("Planner did not produce a <plan> tag. Skipping iteration.");
    continue;
  }

  const planContent = planMatch[1] ?? "";
  let issues: { branch: string; id: string; title: string }[];
  try {
    const parsed = JSON.parse(planContent) as { issues: unknown[] };
    if (!Array.isArray(parsed.issues)) {
      console.error("Planner output missing issues array. Skipping iteration.");
      continue;
    }
    const validated = parsed.issues.filter(
      (entry): entry is { branch: string; id: string; title: string } => {
        if (typeof entry !== "object" || entry === null) {
          console.warn("  Skipping non-object issue entry");
          return false;
        }
        const item = entry as Record<string, unknown>;
        if (typeof item.id !== "string" || !/^\d+$/.test(item.id)) {
          console.warn(`  Skipping issue with invalid id: ${String(item.id)}`);
          return false;
        }
        if (typeof item.branch !== "string") {
          console.warn("  Skipping issue with missing branch");
          return false;
        }
        if (typeof item.title !== "string") {
          console.warn("  Skipping issue with missing title");
          return false;
        }
        if (!BRANCH_PATTERN.test(item.branch)) {
          console.warn(`  Skipping issue with invalid branch: ${item.branch}`);
          return false;
        }
        return true;
      },
    );
    issues = validated;
  } catch {
    console.error("Planner produced invalid JSON. Skipping iteration.");
    continue;
  }

  if (issues.length === 0) {
    console.log("No issues to work on. Exiting.");
    workCompleted = true;
    break;
  }

  console.log(`Planning complete. ${String(issues.length)} issue(s) to work in parallel:`);
  for (const issue of issues) {
    console.log(`  #${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // Phase 2: Execute + Review (semaphore for MAX_PARALLEL)
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

        const result = await sandbox.run({
          agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
          maxIterations: 100,
          name: "Implementer #" + issue.id,
          promptArgs: {
            BRANCH: issue.branch,
            ISSUE_TITLE: issue.title,
            TASK_ID: issue.id,
          },
          promptFile: "./.sandcastle/implement-prompt.md",
        });

        if (result.commits.length > 0) {
          try {
            await sandbox.run({
              agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
              maxIterations: 10,
              name: "Reviewer #" + issue.id,
              promptArgs: {
                BRANCH: issue.branch,
              },
              promptFile: "./.sandcastle/review-prompt.md",
            });
          } catch (reviewError: unknown) {
            const msg = reviewError instanceof Error ? reviewError.message : String(reviewError);
            console.warn(`  Reviewer for #${issue.id} failed, proceeding unreviewed: ${msg}`);
          }
        }

        return result;
      } finally {
        release();
      }
    }),
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const currentIssue = issues[i];
      const reason: unknown = outcome.reason;
      const errorMessage =
        reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
      console.error(
        `  ✗ #${currentIssue?.id ?? String(i)} (${currentIssue?.branch ?? "unknown"}) failed: ${errorMessage}`,
      );
    }
  }

  const completedIssues = settled
    .map((outcome, i) => ({ issue: issues[i], outcome }))
    .filter(
      (
        entry,
      ): entry is {
        issue: (typeof issues)[number];
        outcome: PromiseFulfilledResult<Awaited<ReturnType<typeof sandcastle.run>>>;
      } =>
        entry.issue !== undefined &&
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  if (completedBranches.length === 0) {
    console.log("No commits produced. Nothing to merge.");
    break;
  }

  // Phase 3: Merge
  try {
    await sandcastle.run({
      agent: sandcastle.opencode("github-copilot/claude-opus-4.6"),
      maxIterations: 10,
      name: "Merger",
      promptArgs: {
        BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
        ISSUES: completedIssues.map((i) => `- #${i.id}: ${i.title}`).join("\n"),
      },
      promptFile: "./.sandcastle/merge-prompt.md",
      sandbox: docker({ imageName: DOCKER_IMAGE }),
    });

    console.log("\nPR created.");
    workCompleted = true;
    break;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`Merge phase failed: ${errorMessage}`);
    console.error("Branches are pushed and available for manual merge.");
    break;
  }
}

console.log("\nAll done.");

if (!workCompleted) {
  process.exitCode = 1;
}
