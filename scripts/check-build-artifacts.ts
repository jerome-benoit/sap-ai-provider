/** Verifies that a build produced every artifact required by its entrypoints. */
import { accessSync } from "node:fs";
import { resolve } from "node:path";

const artifactStems = {
  main: ["index", "index-v2", "index-v4"],
  v2: ["index-v2"],
  v4: ["index-v4"],
} as const;

const buildFamily = process.argv[2];
if (buildFamily !== "main" && buildFamily !== "v2" && buildFamily !== "v4") {
  throw new Error(`Expected build family main, v2, or v4; received ${buildFamily ?? "none"}`);
}

for (const stem of artifactStems[buildFamily]) {
  for (const extension of ["js", "cjs", "d.ts", "d.cts"]) {
    accessSync(resolve("dist", `${stem}.${extension}`));
  }
}

console.log(`Verified ${buildFamily} build artifacts.`);
