import { execFile } from "node:child_process";
import util from "node:util";

/** Async execFile — does not block the event loop. Same error shape as execFileSync. */
export const execFileAsync = util.promisify(execFile);

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
