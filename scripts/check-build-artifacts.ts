/** Verifies that a build produced every artifact required by its entrypoints. */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifactStems = {
  main: ["index", "index-v2", "index-v4"],
  v2: ["index-v2"],
  v4: ["index-v4"],
} as const;

/** Build artifact family accepted by the checker. */
export type BuildFamily = keyof typeof artifactStems;

/**
 * Verify that every required artifact exists as a regular file.
 * Symbolic links are followed, matching `test -f` semantics.
 * @param buildFamily - Artifact family to verify
 * @param rootDirectory - Directory containing the dist directory
 */
export function verifyBuildArtifacts(buildFamily: BuildFamily, rootDirectory = "."): void {
  for (const stem of artifactStems[buildFamily]) {
    for (const extension of ["js", "cjs", "d.ts", "d.cts"]) {
      const path = resolve(rootDirectory, "dist", `${stem}.${extension}`);
      if (statSync(path, { throwIfNoEntry: false })?.isFile() !== true) {
        throw new Error(`Expected build artifact file: ${path}`);
      }
    }
  }
}

/** Run the build artifact command-line checker. */
function main(): void {
  const buildFamily = process.argv[2];
  if (buildFamily !== "main" && buildFamily !== "v2" && buildFamily !== "v4") {
    throw new Error(`Expected build family main, v2, or v4; received ${buildFamily ?? "none"}`);
  }
  verifyBuildArtifacts(buildFamily);
  console.log(`Verified ${buildFamily} build artifacts.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
