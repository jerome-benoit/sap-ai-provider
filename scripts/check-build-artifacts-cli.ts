/**
 * Command-line entry of the build artifact checker.
 *
 * This file exists so that running the checker needs no guesswork. The library module can be
 * imported without executing anything, and this entry always executes: no comparison of
 * `process.argv` against the module URL can decide that a Windows short path, a symlinked checkout,
 * or a mounted root is "some other file" and let the checker exit zero having verified nothing.
 */
import { verifyBuildArtifacts } from "./check-build-artifacts.js";

const buildFamily = process.argv[2];
if (buildFamily !== "main" && buildFamily !== "v4") {
  throw new Error(`Expected build family main or v4; received ${buildFamily ?? "none"}`);
}

verifyBuildArtifacts(buildFamily);
console.log(`Verified ${buildFamily} build artifacts.`);
