import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

import { ConcurrencyPool } from "./concurrency-pool.js";
import { DOCKER_MOUNTS, TASK_TIMEOUT_MS } from "./constants.js";
import { runRefinementLoop } from "./refinement-loop.js";
import { implementStrategy } from "./strategies.js";
import { GithubIssueSource } from "./task-source.js";
import { ITERATION_BUDGET_PER_ROUND, MAX_CRITIC_ROUNDS } from "./types.js";

const BRANCH_PREFIX = "agent/issue";
const ISSUE_LABEL = "sandcastle";
const MAX_PARALLEL = 3;
const DOCKER_IMAGE = "sandcastle-sap-ai";

/**
 * Races a promise against a timeout, rejecting with a descriptive error if the timeout fires first.
 * @param promise - The promise to race against the timeout.
 * @param ms - Timeout duration in milliseconds.
 * @param label - Human-readable label used in the timeout error message.
 * @returns The resolved value of the promise if it completes before the timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(ms)}ms`));
    }, ms).unref();
  });
  timeoutPromise.catch(() => {
    /* suppress unhandled rejection when task completes before timeout */
  });
  return Promise.race([promise, timeoutPromise]);
}

const source = new GithubIssueSource({
  branchPrefix: BRANCH_PREFIX,
  dockerImage: DOCKER_IMAGE,
  label: ISSUE_LABEL,
});

const tasks = await source.discover();

if (tasks.length === 0) {
  console.log("No tasks to process.");
} else {
  const pool = new ConcurrencyPool(MAX_PARALLEL);

  const settled = await Promise.allSettled(
    tasks.map((spec) =>
      pool.run(() =>
        withTimeout(
          (async () => {
            await using sandbox = await sandcastle.createSandbox({
              branch: spec.branch,
              copyToWorktree: ["node_modules"],
              hooks: {
                sandbox: { onSandboxReady: [{ command: "npm install && npm run build" }] },
              },
              sandbox: docker({ imageName: DOCKER_IMAGE, mounts: [...DOCKER_MOUNTS] }),
            });

            const loopResult = await runRefinementLoop(
              spec,
              sandbox,
              {
                iterationBudget: ITERATION_BUDGET_PER_ROUND,
                maxRounds: MAX_CRITIC_ROUNDS,
              },
              implementStrategy,
            );

            let workSuccess = false;
            if (loopResult.totalCommits > 0) {
              const cwd = sandbox.worktreePath;
              const finalizeResult = await implementStrategy.finalize(
                spec,
                loopResult,
                sandbox,
                cwd,
              );
              workSuccess = implementStrategy.isWorkComplete(finalizeResult);
            }

            return { spec, success: workSuccess };
          })(),
          TASK_TIMEOUT_MS,
          `Task #${spec.id}`,
        ),
      ),
    ),
  );

  const workCompleted = settled.some(
    (outcome) => outcome.status === "fulfilled" && outcome.value.success,
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const spec = tasks[i];
      const reason: unknown = outcome.reason;
      const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
      console.error(`  ✗ #${spec?.id ?? String(i)} failed: ${msg}`);
    }
  }

  console.log("\nAll done.");

  if (!workCompleted) {
    process.exitCode = 1;
  }
}

process.exit(process.exitCode ?? 0);
