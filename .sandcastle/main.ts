import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

import type { TaskSpec } from "./types.js";

import { ConcurrencyPool } from "./concurrency-pool.js";
import {
  BRANCH_PREFIX,
  DOCKER_IMAGE,
  DOCKER_MOUNTS,
  GRACE_TIMEOUT_MS,
  ISSUE_LABEL,
  ITERATION_BUDGET_PER_ROUND,
  MAX_CRITIC_ROUNDS,
  MAX_PARALLEL,
  TASK_TIMEOUT_MS,
} from "./constants.js";
import { runRefinementLoop } from "./refinement-loop.js";
import { implementStrategy } from "./strategies/implement/strategy.js";
import { GithubIssueSource } from "./task-source.js";

/**
 * Races a promise against a timeout, rejecting with a descriptive error if the timeout fires first.
 * @param promise - The promise to race against the timeout.
 * @param ms - Timeout duration in milliseconds.
 * @param label - Human-readable label used in the timeout error message.
 * @returns The resolved value of the promise if it completes before the timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(ms)}ms`));
    }, ms);
    timer.unref();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

const source = new GithubIssueSource({
  branchPrefix: BRANCH_PREFIX,
  dockerImage: DOCKER_IMAGE,
  label: ISSUE_LABEL,
});

let tasks: TaskSpec[];
try {
  tasks = await source.discover();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
  process.exit();
}

if (tasks.length === 0) {
  console.log("No tasks to process.");
} else {
  const pool = new ConcurrencyPool(MAX_PARALLEL);
  const inFlightTasks: Promise<unknown>[] = [];

  const settled = await Promise.allSettled(
    tasks.map((spec) =>
      pool.run(() => {
        const innerTask = (async () => {
          await using sandbox = await sandcastle.createSandbox({
            branch: spec.branch,
            copyToWorktree: ["node_modules"],
            hooks: {
              sandbox: { onSandboxReady: [{ command: "npm install && npm run build" }] },
            },
            sandbox: docker({ imageName: DOCKER_IMAGE, mounts: [...DOCKER_MOUNTS] }),
          });

          const loopResult = await runRefinementLoop(spec, sandbox, implementStrategy, {
            iterationBudget: ITERATION_BUDGET_PER_ROUND,
            maxRounds: MAX_CRITIC_ROUNDS,
            postLoopValidationRetry: true,
          });

          let workSuccess = false;
          if (loopResult.totalCommits > 0) {
            const finalizeResult = await implementStrategy.finalize(spec, loopResult, sandbox);
            workSuccess = implementStrategy.isWorkComplete(finalizeResult);
          }

          return { spec, success: workSuccess };
        })();
        inFlightTasks.push(innerTask);
        return withTimeout(innerTask, TASK_TIMEOUT_MS, `Task #${spec.id}`);
      }),
    ),
  );

  // Grace period: wait for timed-out tasks to clean up their sandboxes
  await Promise.race([
    Promise.allSettled(inFlightTasks),
    new Promise((resolve) => setTimeout(resolve, GRACE_TIMEOUT_MS).unref()),
  ]);

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
