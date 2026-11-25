/**
 * Command-line entry of the standalone V2 package freeze gate.
 *
 * This file exists so that running the gate needs no guesswork. The library module can be imported
 * without executing anything, and this entry always executes: no comparison of `process.argv`
 * against the module URL can decide that a Windows short path, a symlinked checkout, or a mounted
 * root is "some other file" and let the gate exit 0 unchecked.
 */
import { spawnSync } from "node:child_process";

import {
  DEPRECATION_MESSAGE,
  fetchPackageDocument,
  FROZEN_VERSION,
  STANDALONE_PACKAGE_NAME,
  versionsAbove,
  versionsWithoutMessage,
} from "./v2-package-deprecation.js";

const [command = "check", ...flags] = process.argv.slice(2);

/**
 * Write the canonical deprecation message to every published version, then read the registry again.
 * @returns Versions still without the message
 */
async function applyDeprecation(): Promise<string[]> {
  const pending = versionsWithoutMessage(await fetchPackageDocument());
  if (pending.length > 0) {
    const result = spawnSync("npm", ["deprecate", STANDALONE_PACKAGE_NAME, DEPRECATION_MESSAGE], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return pending;
    }
  } else {
    console.log("Every version already carries the deprecation message: nothing to write.");
  }
  return versionsWithoutMessage(await fetchPackageDocument());
}

switch (command) {
  case "check": {
    const document = await fetchPackageDocument();
    const versions = Object.keys(document.versions);
    const unexpected = versionsAbove(versions, FROZEN_VERSION);
    const pending = versionsWithoutMessage(document).length;
    console.log(
      `${STANDALONE_PACKAGE_NAME}: ${String(versions.length)} published versions, ${String(versions.length - pending)} deprecated.`,
    );
    if (unexpected.length > 0) {
      console.error(
        `The standalone V2 package is frozen at ${FROZEN_VERSION}, but the registry also holds: ${unexpected.join(", ")}`,
      );
      process.exitCode = 1;
      break;
    }
    console.log(`Freeze holds: no version above ${FROZEN_VERSION}.`);
    if (pending > 0) {
      console.log(
        `Run npm run deprecate-v2-package -- --apply to store the message on ${String(pending)} versions.`,
      );
    }
    break;
  }
  case "deprecate": {
    if (!flags.every((flag) => flag === "--apply")) {
      console.error(
        `Unknown flag for deprecate: ${flags.filter((flag) => flag !== "--apply").join(", ")}`,
      );
      process.exitCode = 2;
      break;
    }
    const pending = versionsWithoutMessage(await fetchPackageDocument());
    if (pending.length === 0) {
      console.log("Nothing to do: every version is deprecated.");
      break;
    }
    if (!flags.includes("--apply")) {
      console.log(`Dry run: would write the message to ${String(pending.length)} versions.`);
      console.log(`Message: ${DEPRECATION_MESSAGE}`);
      console.log(
        "Re-run with --apply to write (needs an authenticated npm CLI and an OTP when 2FA is on).",
      );
      break;
    }
    const missing = await applyDeprecation();
    if (missing.length > 0) {
      console.error(`Still not deprecated after the write: ${missing.join(", ")}`);
      process.exitCode = 1;
      break;
    }
    console.log(`Deprecated every version of ${STANDALONE_PACKAGE_NAME}.`);
    break;
  }
  case "verify": {
    const missing = versionsWithoutMessage(await fetchPackageDocument());
    if (missing.length > 0) {
      console.error(`Deprecation message missing on: ${missing.join(", ")}`);
      process.exitCode = 1;
      break;
    }
    console.log(`Every published version of ${STANDALONE_PACKAGE_NAME} is deprecated.`);
    break;
  }
  default:
    console.error(`Expected command check, verify, or deprecate; received ${command}`);
    process.exitCode = 2;
}
