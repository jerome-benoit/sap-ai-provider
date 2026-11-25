/**
 * Command-line entry of the standalone V2 package freeze gate.
 *
 * This file exists so that running the gate needs no guesswork. The library module can be imported
 * without executing anything, and this entry always executes: no comparison of `process.argv`
 * against the module URL can decide that a Windows short path, a symlinked checkout, or a mounted
 * root is "some other file" and let the gate exit 0 unchecked.
 */
import { spawnSync } from "node:child_process";

import type { Invocation, PackageDocument } from "./v2-package-deprecation.js";

import {
  DEPRECATION_MESSAGE,
  fetchPackageDocument,
  FROZEN_VERSION,
  getNpmDeprecationInvocation,
  parseArguments,
  STANDALONE_PACKAGE_NAME,
  versionsAbove,
  versionsWithoutMessage,
} from "./v2-package-deprecation.js";

/**
 * Ask npm to store the canonical message, and report a refused write.
 *
 * Exit status zero proves that npm accepted the write. It does not prove that the public registry
 * document already shows it: that document is cached, `cache-control: public, max-age=300`, so
 * `verify` is the command that confirms coverage.
 */
function applyDeprecation(): void {
  const { args, command } = getNpmDeprecationInvocation();
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw new Error(`Unable to start npm deprecate: ${result.error.message}`);
  }
  if (result.signal !== null) {
    throw new Error(`npm deprecate terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm deprecate exited with status ${String(result.status ?? "unknown")}`);
  }
}

/**
 * Stop every command on a registry that no longer matches the freeze.
 * @param document - Validated registry document
 */
function assertFrozen(document: PackageDocument): void {
  const unexpected = versionsAbove(Object.keys(document.versions), FROZEN_VERSION);
  if (unexpected.length > 0) {
    throw new Error(
      `The standalone V2 package is frozen at ${FROZEN_VERSION}, but the registry also holds: ${unexpected.join(", ")}`,
    );
  }
}

/**
 * Run one gate command and turn every failure into a single diagnostic line.
 * @param args - Arguments after the Node and script entries
 * @returns Exit status: 0 success, 1 violation or operational failure, 2 invalid usage
 */
async function main(args: readonly string[]): Promise<0 | 1 | 2> {
  let invocation: Invocation;
  try {
    invocation = parseArguments(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    return await runCommand(invocation);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Run the validated command against the registry.
 * @param invocation - Validated command line
 * @returns Exit status of the command
 */
async function runCommand(invocation: Invocation): Promise<0 | 1> {
  const document = await fetchPackageDocument();
  assertFrozen(document);
  const versions = Object.keys(document.versions);
  const pending = versionsWithoutMessage(document);

  if (invocation.command === "check") {
    console.log(
      `Freeze holds: ${String(versions.length)} published versions, none above ${FROZEN_VERSION}.`,
    );
    console.log(
      `${String(versions.length - pending.length)} carry the canonical deprecation message; ${String(pending.length)} miss it or carry a different one.`,
    );
    if (pending.length > 0) {
      console.log("Run npm run deprecate-v2-package -- --apply to store the message.");
    }
    return 0;
  }

  if (invocation.command === "verify") {
    if (pending.length > 0) {
      console.error(`Canonical deprecation message missing on: ${pending.join(", ")}`);
      return 1;
    }
    console.log(
      `Every published version of ${STANDALONE_PACKAGE_NAME} carries the canonical deprecation message.`,
    );
    return 0;
  }

  if (pending.length === 0) {
    console.log("Nothing to write: every published version carries the canonical message.");
    return 0;
  }
  if (!invocation.apply) {
    console.log(`Dry run: would write the message to ${String(pending.length)} versions.`);
    console.log(`Message: ${DEPRECATION_MESSAGE}`);
    console.log(
      "Re-run with --apply to write (needs an authenticated npm CLI and an OTP when 2FA is on).",
    );
    return 0;
  }

  applyDeprecation();
  console.log(
    "npm accepted the write. The public registry document stays cached for up to five minutes, so run npm run verify-v2-package to confirm coverage.",
  );
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
