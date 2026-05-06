import { homedir } from "node:os";
import { join } from "node:path";

/** Idle timeout in seconds for agent runs — prevents stalled agents from consuming task budget. */
export const AGENT_IDLE_TIMEOUT_S = 300;

/** Model identifier used for implementation and critic agents. */
export const AGENT_MODEL = "github-copilot/claude-sonnet-4.6";

/** Substring that signals an agent has completed its work — stops iteration early. */
export const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

/** Number of context lines around a diff hunk used for hash computation. */
export const CONTEXT_HASH_RADIUS = 3;

/** Docker bind-mounts shared across all sandboxes (warm npm cache for faster installs). */
export const DOCKER_MOUNTS: readonly {
  hostPath: string;
  readonly: boolean;
  sandboxPath: string;
}[] = [{ hostPath: join(homedir(), ".npm"), readonly: true, sandboxPath: "/home/agent/.npm" }];

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

/** Maximum number of issues to fetch from GitHub. */
export const MAX_ISSUES_FETCH = 50;

/** Maximum number of PRs to fetch when checking for existing work. */
export const MAX_PRS_FETCH = 200;

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
export const TASK_TIMEOUT_MS = 15 * 60 * 1000;

/** Full validation command run after each implementation round. */
export const VALIDATION_COMMAND =
  "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2";

/** Timeout in milliseconds for the validation command. */
export const VALIDATION_TIMEOUT_MS = 120_000;
