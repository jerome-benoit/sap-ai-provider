import { execFile } from "node:child_process";
import util from "node:util";

/** Model identifier used for implementation and critic agents. */
export const AGENT_MODEL = "github-copilot/claude-sonnet-4.6";

/** Number of context lines around a diff hunk used for hash computation. */
export const CONTEXT_HASH_RADIUS = 3;

/** Async execFile — does not block the event loop. Same error shape as execFileSync. */
export const execFileAsync = util.promisify(execFile);

/** Timeout in milliseconds for git operations. */
export const GIT_TIMEOUT_MS = 30_000;

/** Number of characters to retain from a SHA for display purposes. */
export const HASH_PREFIX_LENGTH = 16;

/** Maximum number of characters captured from stderr before truncation. */
export const MAX_STDERR_CHARS = 500;

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

/**
 * Returns the current HEAD commit SHA for the given working directory.
 * @param cwd - Absolute path to the git repository root.
 * @returns The full SHA string, or `null` if the command fails.
 */
export async function getHeadSha(cwd: string): Promise<null | string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Converts an unknown thrown value to a human-readable error message.
 * @param err - The caught value (may be an `Error` or any other type).
 * @returns The `message` property if `err` is an `Error`, otherwise `String(err)`.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
