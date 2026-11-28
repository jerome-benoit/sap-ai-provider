import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX_ENTRY = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const ARTIFACT_STEMS = ["index", "index-v2", "index-v4"];
const ARTIFACT_EXTENSIONS = ["js", "cjs", "d.ts", "d.cts"];

/**
 * Read the artifact-check command one published npm script runs.
 * @param script - Manifest script name to read
 * @returns Checker file resolved inside this repository, then its argument
 */
function publishedArtifactCommand(script: "check-build" | "check-build:v4"): string[] {
  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const [segment = ""] = (manifest.scripts[script] ?? "").split(" && ");
  const [runner = "", ...rest] = segment.split(" ");
  if (runner !== "tsx" || rest.length < 2) {
    throw new Error(`Expected ${script} to run the artifact checker through tsx`);
  }
  return rest.map((part) => (part.startsWith("scripts/") ? join(PROJECT_ROOT, part) : part));
}

/**
 * Run one artifact-check command against a project root.
 * @param args - Checker file and its argument
 * @param rootDirectory - Project root whose dist directory the checker inspects
 * @returns Exit status and both output streams
 */
function runArtifactCommand(
  args: readonly string[],
  rootDirectory: string,
): { status: null | number; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [TSX_ENTRY, ...args], {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("artifact checker command entry", () => {
  it("runs the published main command over every artifact family", () => {
    const root = mkdtempSync(join(tmpdir(), "sap-ai-build-entry-"));
    temporaryDirectories.push(root);
    const dist = join(root, "dist");
    mkdirSync(dist);
    for (const stem of ARTIFACT_STEMS) {
      for (const extension of ARTIFACT_EXTENSIONS) {
        writeFileSync(join(dist, `${stem}.${extension}`), "artifact");
      }
    }
    const args = publishedArtifactCommand("check-build");
    const complete = runArtifactCommand(args, root);
    expect(complete.status, `${complete.stdout}${complete.stderr}`).toBe(0);
    expect(complete.stdout).toContain("Verified main build artifacts.");

    rmSync(join(dist, "index-v2.d.cts"));
    const missing = runArtifactCommand(args, root);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("Expected build artifact file");
    expect(missing.stdout).not.toContain("Verified");
  });

  it("runs the published v4 command over the V4 family", () => {
    const run = runArtifactCommand(publishedArtifactCommand("check-build:v4"), createV4Artifacts());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Verified v4 build artifacts.");
  });

  it("refuses a build family the manifest no longer publishes", () => {
    const [checker = ""] = publishedArtifactCommand("check-build:v4");
    const run = runArtifactCommand([checker, "v2"], createV4Artifacts());
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("Expected build family main or v4; received v2");
  });
});
