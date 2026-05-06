import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Idle timeout in seconds for agent runs — prevents stalled agents from consuming task budget. */
export const AGENT_IDLE_TIMEOUT_S = 300;

/** Model identifier used for implementation and critic agents. */
export const AGENT_MODEL = "github-copilot/claude-sonnet-4.6";

/** Git branch prefix for issue branches. */
export const BRANCH_PREFIX = "agent/issue";

/** Substring that signals an agent has completed its work — stops iteration early. */
export const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

/** Number of context lines around a diff hunk used for hash computation. */
export const CONTEXT_HASH_RADIUS = 3;

/** Docker image name for the sandbox. */
export const DOCKER_IMAGE = "sandcastle-sandbox";

/** Docker bind-mounts shared across all sandboxes (warm package cache for faster installs). */
export const DOCKER_MOUNTS: readonly {
  hostPath: string;
  readonly: boolean;
  sandboxPath: string;
}[] = resolveDockerMounts();

/**
 * @returns Mount entries for npm cache, or empty if cache path is unavailable.
 * @internal
 */
function resolveDockerMounts(): { hostPath: string; readonly: boolean; sandboxPath: string }[] {
  const npmCache = resolveNpmCachePath();
  if (npmCache && existsSync(npmCache)) {
    return [{ hostPath: npmCache, readonly: true, sandboxPath: "/home/agent/.npm" }];
  }
  return [];
}

/**
 * @returns The npm cache directory path, or undefined if npm is unavailable.
 * @internal
 */
function resolveNpmCachePath(): string | undefined {
  try {
    return execFileSync("npm", ["config", "get", "cache"], { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

/** Timeout in milliseconds for git operations. */
export const GIT_TIMEOUT_MS = 30_000;

/** Number of characters to retain from a SHA for display purposes. */
export const HASH_PREFIX_LENGTH = 16;

/**
 * Flat iteration budget per round (intentionally constant, not decreasing).
 * Evidence: ARCS (arXiv:2504.20434), SWE-Agent, AutoCodeRover all use flat budgets.
 * Decreasing schedules penalize harder residual problems in later rounds.
 */
export const ITERATION_BUDGET_PER_ROUND = 50;

/** GitHub issue label used to identify sandcastle tasks. */
export const ISSUE_LABEL = "sandcastle";

/** Maximum number of issues to fetch from GitHub. */
export const MAX_ISSUES_FETCH = 50;

/** Maximum number of PRs to fetch when checking for existing work. */
export const MAX_PRS_FETCH = 200;

/** Maximum number of concurrent sandcastle tasks. */
export const MAX_PARALLEL = 3;

/** Maximum number of characters captured from stderr before truncation. */
export const MAX_STDERR_CHARS = 500;

/** Maximum implement↔critic rounds before giving up. */
export const MAX_CRITIC_ROUNDS = 5;

/** Maximum number of characters allowed in a PR or commit title. */
export const MAX_TITLE_LENGTH = 200;

/** Model identifier used for planning and orchestration agents. */
export const PLANNER_MODEL = "github-copilot/claude-opus-4.6";

/** Timeout in milliseconds for git push operations. */
export const PUSH_TIMEOUT_MS = 60_000;

/** Timeout in milliseconds for a single sandcastle task execution. */
export const TASK_TIMEOUT_MS = 50 * 60 * 1000;

/** Full validation command run after each implementation round. */
export const VALIDATION_COMMAND =
  "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2";

/** Timeout in milliseconds for the validation command. */
export const VALIDATION_TIMEOUT_MS = 300_000;
