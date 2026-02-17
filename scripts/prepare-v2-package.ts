import { copyFileSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, "dist");

interface PackageJson {
  [key: string]: unknown;
  description: string;
  exports: Record<string, unknown>;
  files: string[];
  main: string;
  module: string;
  name: string;
  peerDependencies?: Record<string, string>;
  types: string;
}

/**
 * Prepares the V2 package for publishing by:
 * 1. Renaming index-v2.* files to index.* in dist/
 * 2. Creating V2-specific package.json in dist/
 * 3. Copying README.md and LICENSE.md to dist/
 *
 * This script expects `npm run build:v2` to have been run first,
 * which outputs to dist/ (replacing any V3 build).
 */
function prepareV2Package(): void {
  const files = readdirSync(DIST);
  for (const file of files) {
    if (file.startsWith("index-v2")) {
      const newName = file.replace("index-v2", "index");
      renameSync(resolve(DIST, file), resolve(DIST, newName));
      console.log(`Renamed ${file} -> ${newName}`);
    }
  }

  const pkgPath = resolve(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;

  const v2Pkg: PackageJson = {
    ...pkg,
    description:
      "SAP AI Provider V2 for Vercel AI SDK 4.x (LanguageModelV2/EmbeddingModelV2 interfaces)",
    exports: {
      ".": {
        import: "./index.js",
        require: "./index.cjs",
        types: "./index.d.ts",
      },
    },
    files: ["**/*"],
    main: "./index.cjs",
    module: "./index.js",
    name: "@jerome-benoit/sap-ai-provider-v2",
    peerDependencies: {
      ai: "^4.0.0 || ^5.0.0",
    },
    types: "./index.d.ts",
  };

  delete v2Pkg.scripts;
  delete v2Pkg.devDependencies;
  delete v2Pkg.volta;
  delete v2Pkg.directories;

  const v2PkgPath = resolve(DIST, "package.json");
  writeFileSync(v2PkgPath, JSON.stringify(v2Pkg, null, 2) + "\n");
  console.log(`Created ${v2PkgPath}`);

  copyFileSync(resolve(ROOT, "README.md"), resolve(DIST, "README.md"));
  console.log("Copied README.md");

  copyFileSync(resolve(ROOT, "LICENSE.md"), resolve(DIST, "LICENSE.md"));
  console.log("Copied LICENSE.md");

  console.log("\nV2 package prepared successfully in dist/");
  console.log("To publish: cd dist && npm publish --provenance --access public");
}

prepareV2Package();
