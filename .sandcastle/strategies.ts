import * as sandcastle from "@ai-hero/sandcastle";

import type { StrategyConfig } from "./types.js";

import {
  AGENT_IDLE_TIMEOUT_S,
  AGENT_MODEL,
  COMPLETION_SIGNAL,
  ITERATION_BUDGET_PER_ROUND,
  MAX_CRITIC_ROUNDS,
  VALIDATION_COMMAND,
  VALIDATION_TIMEOUT_MS,
} from "./constants.js";
import {
  attemptRebase,
  buildPrArgs,
  extractStderr,
  pushBranch,
  runValidation,
} from "./finalizer.js";
import { execFileAsync, toErrorMessage } from "./utils.js";

export const implementStrategy: StrategyConfig = {
  actorPromptFile: "./.sandcastle/implement-prompt.md",

  buildActorArgs: (spec, findings) => ({
    BRANCH: spec.branch,
    FINDINGS: findings.length > 0 ? JSON.stringify(findings, null, 2) : "",
    ISSUE_BODY: spec.body,
    ISSUE_TITLE: spec.title,
    TASK_ID: spec.id,
  }),

  buildCriticArgs: (spec, nonce) => ({
    BRANCH: spec.branch,
    NONCE: nonce,
  }),

  criticPromptFile: "./.sandcastle/critic-prompt.md",

  finalize: async (spec, loopResult, sandbox, cwd) => {
    let validationPassed = await runValidation(cwd, spec);

    // Retry one more round if validation failed and budget remains
    if (!validationPassed && loopResult.roundsCompleted < MAX_CRITIC_ROUNDS) {
      const retryBudget = ITERATION_BUDGET_PER_ROUND;
      console.log(
        `  #${spec.id}: Retrying one more implement round (budget: ${String(retryBudget)})`,
      );

      try {
        await sandbox.run({
          agent: sandcastle.opencode(AGENT_MODEL),
          completionSignal: COMPLETION_SIGNAL,
          idleTimeoutSeconds: AGENT_IDLE_TIMEOUT_S,
          maxIterations: retryBudget,
          name: `Implementer #${spec.id} retry`,
          promptArgs: {
            BRANCH: spec.branch,
            FINDINGS:
              loopResult.lastFindings.length > 0
                ? JSON.stringify(loopResult.lastFindings, null, 2)
                : "",
            ISSUE_BODY: spec.body,
            ISSUE_TITLE: spec.title,
            TASK_ID: spec.id,
          },
          promptFile: "./.sandcastle/implement-prompt.md",
        });
      } catch (retryErr: unknown) {
        const retryMsg = toErrorMessage(retryErr);
        console.warn(
          `  #${spec.id}: Implementer retry threw: ${retryMsg}. Falling through to PR creation.`,
        );
      }

      try {
        await execFileAsync("sh", ["-c", VALIDATION_COMMAND], {
          cwd,
          maxBuffer: 8 * 1024 * 1024,
          timeout: VALIDATION_TIMEOUT_MS,
        });
        validationPassed = true;
        console.log(`  #${spec.id}: Validation passed after retry round.`);
      } catch {
        console.warn(`  #${spec.id}: Validation still fails after retry. Will create draft PR.`);
      }
    }

    // Rebase on latest main
    const rebaseSucceeded = await attemptRebase(cwd);
    if (rebaseSucceeded && validationPassed) {
      try {
        await execFileAsync("sh", ["-c", VALIDATION_COMMAND], {
          cwd,
          maxBuffer: 8 * 1024 * 1024,
          timeout: VALIDATION_TIMEOUT_MS,
        });
      } catch (postRebaseErr: unknown) {
        const postRebaseStderr = extractStderr(postRebaseErr);
        console.warn(
          `  #${spec.id}: Post-rebase validation failed.${postRebaseStderr ? `\n${postRebaseStderr}` : ""}`,
        );
        validationPassed = false;
      }
    }

    // Push
    const pushSucceeded = await pushBranch(cwd, spec, rebaseSucceeded);
    if (!pushSucceeded) {
      console.warn(`  #${spec.id}: Push did not succeed; PR may reference unpushed commits.`);
    }

    // Build PR arguments and create PR
    const { isDraft, prArgs } = buildPrArgs(spec, loopResult, validationPassed, rebaseSucceeded);

    let prCreated = false;
    try {
      await execFileAsync("gh", prArgs, { cwd, maxBuffer: 8 * 1024 * 1024 });
      console.log(`  #${spec.id}: PR created${isDraft ? " (draft)" : ""}.`);
      prCreated = true;
    } catch (err: unknown) {
      const msg = toErrorMessage(err);
      console.error(`  #${spec.id}: PR creation failed: ${msg}`);
    }

    return { success: prCreated };
  },

  isWorkComplete: (result) => result.success,
};
