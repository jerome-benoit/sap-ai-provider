import * as sandcastle from "@ai-hero/sandcastle";
import { execFileSync, execSync } from "node:child_process";

import type { FinalizeResult, LoopResult, SandboxInstance, TaskSpec } from "./types.js";

import { ITERATION_BUDGET, MAX_CRITIC_ROUNDS } from "./types.js";

const VALIDATION_COMMAND =
  "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2";

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
  let validationPassed = false;

  try {
    execSync(VALIDATION_COMMAND, { cwd, stdio: "pipe" });
    validationPassed = true;
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr: unknown }).stderr).slice(0, 500)
        : "";
    console.warn(`  #${spec.id}: Validation failed.${stderr ? `\n${stderr}` : ""}`);
  }

  if (!validationPassed && loopResult.roundsCompleted < MAX_CRITIC_ROUNDS) {
    const retryBudget = ITERATION_BUDGET[MAX_CRITIC_ROUNDS - 1] ?? 10;
    console.log(
      `  #${spec.id}: Retrying one more implement round (budget: ${String(retryBudget)})`,
    );

    try {
      await sandbox.run({
        agent: sandcastle.opencode("github-copilot/claude-sonnet-4.6"),
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
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.warn(
        `  #${spec.id}: Implementer retry threw: ${retryMsg}. Falling through to PR creation.`,
      );
    }

    try {
      execSync(VALIDATION_COMMAND, { cwd, stdio: "pipe" });
      validationPassed = true;
      console.log(`  #${spec.id}: Validation passed after retry round.`);
    } catch {
      console.warn(`  #${spec.id}: Validation still fails after retry. Will create draft PR.`);
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
      try {
        execSync(VALIDATION_COMMAND, {
          cwd,
          stdio: "pipe",
        });
      } catch {
        validationPassed = false;
      }
    }
  } catch {
    try {
      execSync("git rebase --abort", { cwd, stdio: "pipe" });
    } catch {
      /* empty */
    }
    try {
      execSync("git push", { cwd, stdio: "pipe" });
    } catch (pushErr: unknown) {
      const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      console.warn(`  #${spec.id}: git push failed after rebase abort: ${pushMsg}`);
    }
  }

  if (rebaseSucceeded) {
    try {
      execSync("git push --force-with-lease", { cwd, stdio: "pipe" });
    } catch (pushErr: unknown) {
      const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      console.warn(
        `  #${spec.id}: git push --force-with-lease failed (branch un-pushed, PR creation will fail gracefully): ${pushMsg}`,
      );
    }
  }

  const converged = loopResult.status === "converged";
  const isDraft = !converged || !validationPassed;
  const outstandingNote =
    !converged && loopResult.lastFindings.length > 0
      ? `\n\n⚠️ Outstanding findings:\n${loopResult.lastFindings.map((f) => `- [${f.severity}] ${f.file}: ${f.title}`).join("\n")}`
      : "";
  const validationNote = !validationPassed
    ? "\n\n⚠️ Validation did not pass. Manual review required."
    : "";

  const validationCheck = validationPassed ? "- [x]" : "- [ ]";
  const commitPrefix = spec.labels.includes("feature request")
    ? "feat"
    : spec.labels.includes("bug")
      ? "fix"
      : "chore";
  const prTitle = `${commitPrefix}: resolve #${spec.id} — ${spec.title}`;
  const typeOfChange =
    commitPrefix === "feat"
      ? "New feature (non-breaking change that adds functionality)"
      : commitPrefix === "fix"
        ? "Bug fix (non-breaking change that fixes an issue)"
        : "Refactoring (no functional changes)";
  const prBody = `## Description\n\nAutomated ${commitPrefix} for #${spec.id}: ${spec.title}\n\n## Type of Change\n\n- [x] ${typeOfChange}\n\n## Checklist\n\n${validationCheck} I have run validation suite\n- [x] My changes follow the existing code style\n\n## Related Issues\n\nFixes #${spec.id}${outstandingNote}${validationNote}`;

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

  let prCreated = false;
  try {
    execFileSync("gh", prArgs, { cwd, encoding: "utf-8", stdio: "pipe" });
    console.log(`  #${spec.id}: PR created${isDraft ? " (draft)" : ""}.`);
    prCreated = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  #${spec.id}: PR creation failed: ${msg}`);
  }

  return { isDraft, prCreated, validationPassed };
}
