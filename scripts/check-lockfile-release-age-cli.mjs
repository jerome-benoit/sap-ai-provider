#!/usr/bin/env node
/**
 * Command-line entry of the package-lock release-age gate.
 *
 * This file exists so that running the gate needs no guesswork. The library module can be imported
 * without executing anything, and this entry always executes: no comparison of `process.argv`
 * against the module URL can decide that a Windows short path, a symlinked checkout, or a mounted
 * root is "some other file" and let the gate exit 0 without checking anything.
 */
import { main } from "./check-lockfile-release-age.mjs";

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
