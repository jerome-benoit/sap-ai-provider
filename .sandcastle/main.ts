import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

import { ConcurrencyPool } from "./concurrency-pool.js";
import { finalizeTask } from "./finalizer.js";
import { runRefinementLoop } from "./refinement-loop.js";
import { GithubIssueSource } from "./task-source.js";

const BRANCH_PREFIX = "agent/issue";
const ISSUE_LABEL = "sandcastle";
const MAX_PARALLEL = 3;
const DOCKER_IMAGE = "sandcastle-sap-ai";
const ITERATION_BUDGET = [100, 50, 25, 10, 10];
const MAX_CRITIC_ROUNDS = 5;

const source = new GithubIssueSource({
  branchPrefix: BRANCH_PREFIX,
  dockerImage: DOCKER_IMAGE,
  label: ISSUE_LABEL,
});

const tasks = await source.discover();

if (tasks.length === 0) {
  process.exit(0);
}

const pool = new ConcurrencyPool(MAX_PARALLEL);

const settled = await Promise.allSettled(
  tasks.map((spec) =>
    pool.run(async () => {
      await using sandbox = await sandcastle.createSandbox({
        branch: spec.branch,
        copyToWorktree: ["node_modules"],
        hooks: {
          sandbox: { onSandboxReady: [{ command: "npm install && npm run build" }] },
        },
        sandbox: docker({ imageName: DOCKER_IMAGE }),
      });

      const loopResult = await runRefinementLoop(spec, sandbox, {
        iterationBudget: ITERATION_BUDGET,
        maxRounds: MAX_CRITIC_ROUNDS,
      });

      let prCreated = false;
      if (loopResult.totalCommits > 0) {
        const cwd = sandbox.worktreePath;
        const result = await finalizeTask(spec, loopResult, sandbox, cwd);
        prCreated = result.prCreated;
      }

      return { prCreated, spec };
    }),
  ),
);

const workCompleted = settled.some(
  (outcome) => outcome.status === "fulfilled" && outcome.value.prCreated,
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
