import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// ── Agent ────────────────────────────────────────────────────────────────────

export const AGENT_ACTOR_MODEL = "github-copilot/claude-sonnet-4.6";

export const AGENT_CRITIC_MODEL = "github-copilot/gpt-5.4";

export const AGENT_IDLE_TIMEOUT_S = 300;

export const AGENT_ITERATION_BUDGET = 50;

export const AGENT_MAX_CRITIC_ROUNDS = 5;

export const AGENT_PLANNER_MODEL = "github-copilot/claude-opus-4.6";

export const AGENT_TASK_TIMEOUT_MS = 50 * 60 * 1000;

export const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

export const MAX_PARALLEL = 3;

// ── Git ──────────────────────────────────────────────────────────────────────

export const GIT_BASE_BRANCH = "main";

export const GIT_BRANCH_PREFIX = "agent/issue";

export const GIT_PUSH_TIMEOUT_MS = 60_000;

export const GIT_TIMEOUT_MS = 30_000;

// ── Docker ───────────────────────────────────────────────────────────────────

export const DOCKER_IMAGE = "sandcastle-sandbox";

export const DOCKER_MOUNTS: readonly {
  hostPath: string;
  readonly: boolean;
  sandboxPath: string;
}[] = resolveDockerMounts();

function resolveDockerMounts(): { hostPath: string; readonly: boolean; sandboxPath: string }[] {
  const npmCache = resolveNpmCachePath();
  if (npmCache && existsSync(npmCache)) {
    return [{ hostPath: npmCache, readonly: true, sandboxPath: "/home/agent/.npm" }];
  }
  return [];
}

function resolveNpmCachePath(): string | undefined {
  try {
    return execFileSync("npm", ["config", "get", "cache"], { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

export const GITHUB_ISSUE_LABEL = "sandcastle";

export const GITHUB_MAX_ISSUES_FETCH = 50;

export const GITHUB_MAX_PRS_FETCH = 200;

export const MAX_TITLE_CHARS = 200;

// ── Validation ───────────────────────────────────────────────────────────────

export const MAX_STDERR_CHARS = 500;

export const VALIDATION_COMMAND =
  "npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2";

export const VALIDATION_TIMEOUT_MS = 300_000;

// ── Deduplication ────────────────────────────────────────────────────────────

export const CONTEXT_HASH_RADIUS = 3;

export const HASH_PREFIX_LENGTH = 16;
