/** Verifies TypeScript declaration routing for every published entrypoint. */
import { resolve } from "node:path";
import ts from "typescript";

interface EntryPoint {
  cjsDeclaration: string;
  esmDeclaration: string;
  specifier: string;
}

const entryPoints: EntryPoint[] = [
  {
    cjsDeclaration: "index.d.cts",
    esmDeclaration: "index.d.ts",
    specifier: "@jerome-benoit/sap-ai-provider",
  },
  {
    cjsDeclaration: "index-v2.d.cts",
    esmDeclaration: "index-v2.d.ts",
    specifier: "@jerome-benoit/sap-ai-provider/v2",
  },
  {
    cjsDeclaration: "index-v4.d.cts",
    esmDeclaration: "index-v4.d.ts",
    specifier: "@jerome-benoit/sap-ai-provider/v4",
  },
];

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
  const esmDeclaration = resolveDeclaration(entryPoint, ts.ModuleKind.ESNext, "mts");
  const expectedEsmDeclaration = resolve("dist", entryPoint.esmDeclaration);
  if (esmDeclaration !== expectedEsmDeclaration) {
    throw new Error(
      `${entryPoint.specifier} ESM types resolved to ${esmDeclaration}; expected ${expectedEsmDeclaration}`,
    );
  }

  const cjsDeclaration = resolveDeclaration(entryPoint, ts.ModuleKind.CommonJS, "cts");
  const expectedCjsDeclaration = resolve("dist", entryPoint.cjsDeclaration);
  if (cjsDeclaration !== expectedCjsDeclaration) {
    throw new Error(
      `${entryPoint.specifier} CommonJS types resolved to ${cjsDeclaration}; expected ${expectedCjsDeclaration}`,
    );
  }
}

console.log(
  `Verified ESM and CommonJS declarations for ${String(entryPoints.length)} entrypoints.`,
);
