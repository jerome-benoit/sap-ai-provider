/** Verifies export routing and strict TypeScript compatibility of published declarations. */
import assert from "node:assert/strict";
import { accessSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

interface EntryPoint {
  specification: 2 | 3 | 4;
  specifier: string;
  stem: string;
}

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf-8")) as {
  exports: Record<string, unknown>;
  name: string;
};
const standaloneV2 = pkg.name === "@jerome-benoit/sap-ai-provider-v2";
assert.ok(standaloneV2 || pkg.name === "@jerome-benoit/sap-ai-provider", "Unexpected package name");

const entryPoints: EntryPoint[] = [
  { specification: standaloneV2 ? 2 : 3, specifier: pkg.name, stem: "index" },
];
if (!standaloneV2) {
  entryPoints.push(
    { specification: 2, specifier: `${pkg.name}/v2`, stem: "index-v2" },
    { specification: 3, specifier: `${pkg.name}/v3`, stem: "index" },
    { specification: 4, specifier: `${pkg.name}/v4`, stem: "index-v4" },
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
  return resolve(result.resolvedFileName);
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

const consumerFiles = ["cts", "mts"].map((extension) =>
  resolve(`package-export-check.${extension}`),
);
const consumerSource = entryPoints
  .map(({ specification, specifier }, index) => {
    const suffix = index.toString();
    const providerType = `ProviderV${specification.toString()}`;
    const contractModule =
      specification === 4 ? "@ai-sdk/provider" : `@ai-sdk/provider-v${specification.toString()}`;
    return [
      `import type { ${providerType} as Contract${suffix} } from ${JSON.stringify(contractModule)};`,
      `import { createSAPAIProvider as create${suffix}, sapAILanguageModelProviderOptions as optionsSchema${suffix} } from ${JSON.stringify(specifier)};`,
      `export const provider${suffix} = create${suffix}();`,
      `const checked${suffix}: Contract${suffix} = provider${suffix};`,
      `void checked${suffix};`,
      `export const model${suffix} = provider${suffix}("gpt-4.1");`,
      `export const generate${suffix} = model${suffix}.doGenerate.bind(model${suffix});`,
      `export const stream${suffix} = model${suffix}.doStream.bind(model${suffix});`,
      `export const embedding${suffix} = provider${suffix}.textEmbeddingModel("text-embedding-3-small");`,
      `export const embed${suffix} = embedding${suffix}.doEmbed.bind(embedding${suffix});`,
      `declare const options${suffix}: Parameters<typeof model${suffix}.doGenerate>[0];`,
      `export const tools${suffix} = options${suffix}.tools;`,
      `const tool${suffix} = options${suffix}.tools?.[0];`,
      `export const schema${suffix} = tool${suffix}?.type === "function" ? tool${suffix}.inputSchema : undefined;`,
      `export const providerOptions${suffix} = optionsSchema${suffix};`,
    ].join("\n");
  })
  .join("\n");
const checkOptions: ts.CompilerOptions = {
  ...compilerOptions,
  declaration: true,
  emitDeclarationOnly: true,
  skipLibCheck: false,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: ["node"],
};
const host = ts.createCompilerHost(checkOptions);
const getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
  consumerFiles.includes(resolve(fileName))
    ? ts.createSourceFile(fileName, consumerSource, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram(consumerFiles, checkOptions, host);
const diagnostics = [...ts.getPreEmitDiagnostics(program)];
const emitted = diagnostics.length === 0 ? program.emit(undefined, () => undefined) : undefined;
if (emitted !== undefined) diagnostics.push(...emitted.diagnostics);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
  }),
);
assert.equal(emitted?.emitSkipped, false, "Consumer declaration emission was skipped");

console.log(`Verified ESM and CommonJS exports and strict declarations for ${pkg.name}.`);
