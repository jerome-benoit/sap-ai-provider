import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyBuildArtifacts } from "./check-build-artifacts";

const temporaryDirectories: string[] = [];

/**
 * Create one complete V4 artifact family in a temporary directory.
 * @returns Temporary project root
 */
function createV4Artifacts(): string {
  const root = mkdtempSync(join(tmpdir(), "sap-ai-build-check-"));
  temporaryDirectories.push(root);
  const dist = join(root, "dist");
  mkdirSync(dist);
  for (const extension of ["js", "cjs", "d.ts", "d.cts"]) {
    writeFileSync(join(dist, `index-v4.${extension}`), "artifact");
  }
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("build artifact checker", () => {
  it("accepts regular files for an artifact family", () => {
    expect(() => {
      verifyBuildArtifacts("v4", createV4Artifacts());
    }).not.toThrow();
  });

  it("rejects a directory at an expected artifact path", () => {
    const root = createV4Artifacts();
    const path = join(root, "dist", "index-v4.js");
    rmSync(path);
    mkdirSync(path);
    expect(() => {
      verifyBuildArtifacts("v4", root);
    }).toThrow("Expected build artifact file");
  });
});
