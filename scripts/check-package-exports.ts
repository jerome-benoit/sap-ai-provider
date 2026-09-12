/** Verifies runtime and TypeScript declaration routing for the package being published. */
import assert from "node:assert/strict";
import { accessSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

interface EntryPoint {
  specifier: string;
  stem: string;
}

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8")) as {
  exports: Record<string, unknown>;
  name: string;
};
const standaloneV2 = pkg.name === "@jerome-benoit/sap-ai-provider-v2";
assert.ok(standaloneV2 || pkg.name === "@jerome-benoit/sap-ai-provider", "Unexpected package name");

const entryPoints: EntryPoint[] = [{ specifier: pkg.name, stem: "index" }];
if (!standaloneV2) {
  entryPoints.push(
    { specifier: `${pkg.name}/v2`, stem: "index-v2" },
    { specifier: `${pkg.name}/v3`, stem: "index" },
    { specifier: `${pkg.name}/v4`, stem: "index-v4" },
  );
}
assert.deepEqual(
  Object.keys(pkg.exports).sort(),
  entryPoints.map(({ specifier }) => `.${specifier.slice(pkg.name.length)}`).sort(),
  "Unexpected package exports",
);

const require = createRequire(resolve("package-export-check.cjs"));
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

/**
 * Resolves an entrypoint as an ESM or CommonJS TypeScript consumer.
 * @param entryPoint - Published package entrypoint.
 * @param mode - TypeScript resolution mode.
 * @param sourceExtension - Consumer source extension.
 * @returns The resolved declaration path.
 */
function resolveDeclaration(
  entryPoint: EntryPoint,
  mode: ts.ResolutionMode,
  sourceExtension: "cts" | "mts",
): string {
  const result = ts.resolveModuleName(
    entryPoint.specifier,
    resolve(`package-export-check.${sourceExtension}`),
    compilerOptions,
    ts.sys,
    undefined,
    undefined,
    mode,
  ).resolvedModule;
  if (result === undefined) {
    throw new Error(`Could not resolve ${entryPoint.specifier} for ${sourceExtension}`);
  }
  return result.resolvedFileName;
}

for (const entryPoint of entryPoints) {
  const esmRuntime = fileURLToPath(import.meta.resolve(entryPoint.specifier));
  accessSync(esmRuntime);
  assert.equal(
    esmRuntime,
    resolve("dist", `${entryPoint.stem}.js`),
    `${entryPoint.specifier} ESM runtime must resolve to its published artifact`,
  );
  assert.equal(
    require.resolve(entryPoint.specifier),
    resolve("dist", `${entryPoint.stem}.cjs`),
    `${entryPoint.specifier} CommonJS runtime must resolve to its published artifact`,
  );
  assert.equal(
    resolveDeclaration(entryPoint, ts.ModuleKind.ESNext, "mts"),
    resolve("dist", `${entryPoint.stem}.d.ts`),
    `${entryPoint.specifier} ESM types must resolve to their published declaration`,
  );
  assert.equal(
    resolveDeclaration(entryPoint, ts.ModuleKind.CommonJS, "cts"),
    resolve("dist", `${entryPoint.stem}.d.cts`),
    `${entryPoint.specifier} CommonJS types must resolve to their published declaration`,
  );
}

console.log(`Verified ESM and CommonJS runtime and declarations for ${pkg.name}.`);
