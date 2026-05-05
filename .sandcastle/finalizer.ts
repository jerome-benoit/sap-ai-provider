import * as sandcastle from "@ai-hero/sandcastle";
import crypto from "node:crypto";

import type { FinalizeResult, LoopResult, SandboxInstance, TaskSpec } from "./types.js";

import {
  AGENT_IDLE_TIMEOUT_S,
  AGENT_MODEL,
  COMPLETION_SIGNAL,
  GIT_TIMEOUT_MS,
  MAX_STDERR_CHARS,
  PUSH_TIMEOUT_MS,
  VALIDATION_COMMAND,
  VALIDATION_TIMEOUT_MS,
} from "./constants.js";
import { ITERATION_BUDGET_PER_ROUND, MAX_CRITIC_ROUNDS } from "./types.js";
import { execFileAsync, toErrorMessage } from "./utils.js";

/**
 * Finalizes a task after the refinement loop: validates, retries if needed, rebases, pushes, and creates a PR.
 * @param spec - The task specification.
 * @param loopResult - The result from the refinement loop.
 * @param sandbox - The sandcastle sandbox instance.
 * @param cwd - Working directory (worktree path).
 * @returns Finalization result with PR and validation status.
 */
export async function finalizeTask(
  spec: TaskSpec,
  loopResult: LoopResult,
  sandbox: SandboxInstance,
  cwd: string,
): Promise<FinalizeResult> {
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

  return { isDraft, prCreated, validationPassed };
}

/**
 * Fetches origin/main and rebases the current branch onto it.
 * On failure, aborts the rebase cleanly.
 * @param cwd - Working directory (worktree path).
 * @returns `true` if rebase succeeded, `false` otherwise.
 */
async function attemptRebase(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["fetch", "origin", "main"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
    });
    await execFileAsync("git", ["rebase", "origin/main"], { cwd, timeout: GIT_TIMEOUT_MS });
    return true;
  } catch {
    try {
      await execFileAsync("git", ["rebase", "--abort"], { cwd });
    } catch {
      /* empty */
    }
    return false;
  }
}

/**
 * Builds the PR title, body, and `gh pr create` argument list.
 * @param spec - The task specification.
 * @param loopResult - The result from the refinement loop.
 * @param validationPassed - Whether the validation suite passed.
 * @param rebaseSucceeded - Whether the rebase onto main succeeded.
 * @returns Object with `isDraft` flag and `prArgs` string array.
 */
function buildPrArgs(
  spec: TaskSpec,
  loopResult: LoopResult,
  validationPassed: boolean,
  rebaseSucceeded: boolean,
): { isDraft: boolean; prArgs: string[] } {
  const converged = loopResult.status === "converged";
  const isDraft = !converged || !validationPassed;
  const outstandingNote =
    loopResult.lastFindings.length > 0
      ? `\n\n${converged ? "ℹ️ Known findings (not addressed):" : "⚠️ Outstanding findings:"}\n${loopResult.lastFindings.map((f) => `- [${f.severity}] ${f.file}: ${f.title}`).join("\n")}`
      : "";
  const validationNote = !validationPassed
    ? "\n\n⚠️ Validation did not pass. Manual review required."
    : "";
  const rebaseNote = !rebaseSucceeded
    ? "\n\n⚠️ Rebase failed. Branch is not rebased onto main."
    : "";

  const validationCheck = validationPassed ? "- [x]" : "- [ ]";
  const commitPrefix = spec.labels.includes("feature request")
    ? "feat"
    : spec.labels.includes("bug")
      ? "fix"
      : "chore";
  const prTitle = `${commitPrefix}: resolve #${spec.id} \u2014 ${spec.title}`;
  const typeOfChange =
    commitPrefix === "feat"
      ? "New feature (non-breaking change that adds functionality)"
      : commitPrefix === "fix"
        ? "Bug fix (non-breaking change that fixes an issue)"
        : "Refactoring (no functional changes)";
  const prBody = `## Description\n\nAutomated ${commitPrefix} for #${spec.id}: ${spec.title}\n\n## Type of Change\n\n- [x] ${typeOfChange}\n\n## Checklist\n\n${validationCheck} I have run validation suite\n- [x] My changes follow the existing code style\n\n## Related Issues\n\nFixes #${spec.id}${outstandingNote}${validationNote}${rebaseNote}`;

  const prArgs = [
    "pr",
    "create",
    ...(isDraft ? ["--draft"] : []),
    "--head",
    spec.branch,
    "--base",
    "main",
    "--title",
    prTitle,
    "--body",
    prBody,
  ];

  return { isDraft, prArgs };
}

/**
 * Extracts stderr from a caught error, truncated to 500 chars.
 * @param err - The caught error value.
 * @returns Stderr string or empty string if unavailable.
 */
function extractStderr(err: unknown): string {
  return err instanceof Error && "stderr" in err
    ? String((err as { stderr: unknown }).stderr).slice(0, MAX_STDERR_CHARS)
    : "";
}

/**
 * Pushes the branch to origin. When rebase succeeded, uses force-with-lease
 * with a rescue-branch fallback. When rebase was aborted, does a plain push.
 * @param cwd - Working directory (worktree path).
 * @param spec - The task specification.
 * @param rebaseSucceeded - Whether the preceding rebase completed successfully.
 * @returns `true` if the primary push succeeded, `false` otherwise.
 */
async function pushBranch(cwd: string, spec: TaskSpec, rebaseSucceeded: boolean): Promise<boolean> {
  if (rebaseSucceeded) {
    try {
      await execFileAsync("git", ["push", "--force-with-lease"], {
        cwd,
        timeout: PUSH_TIMEOUT_MS,
      });
      return true;
    } catch (pushErr: unknown) {
      const pushMsg = toErrorMessage(pushErr);
      try {
        const suffix = crypto.randomBytes(4).toString("hex");
        await execFileAsync(
          "git",
          ["push", "origin", `HEAD:refs/heads/rescue/${spec.branch}-${suffix}`],
          {
            cwd,
            timeout: PUSH_TIMEOUT_MS,
          },
        );
        console.warn(
          `  #${spec.id}: Push failed. Commits preserved at rescue/${spec.branch}-${suffix}`,
        );
      } catch {
        console.error(
          `  #${spec.id}: Push failed and rescue failed. Commits will be lost on sandbox disposal: ${pushMsg}`,
        );
      }
      return false;
    }
  } else {
    try {
      await execFileAsync("git", ["push"], { cwd, timeout: PUSH_TIMEOUT_MS });
      return true;
    } catch (pushErr: unknown) {
      const pushMsg = toErrorMessage(pushErr);
      console.warn(`  #${spec.id}: git push failed after rebase abort: ${pushMsg}`);
      return false;
    }
  }
}

/**
 * Runs the full validation suite.
 * @param cwd - Working directory (worktree path).
 * @param spec - The task specification (used for logging).
 * @returns `true` if validation passed, `false` otherwise.
 */
async function runValidation(cwd: string, spec: TaskSpec): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", VALIDATION_COMMAND], {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: VALIDATION_TIMEOUT_MS,
    });
    return true;
  } catch (err: unknown) {
    const stderr = extractStderr(err);
    console.warn(`  #${spec.id}: Validation failed.${stderr ? `\n${stderr}` : ""}`);
    return false;
  }
}
