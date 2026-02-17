import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, "dist");

interface PackageJson {
  [key: string]: unknown;
}

/**
 * Prepares the V2 package for publishing by:
 * 1. Renaming index-v2.* files to index.* in dist/
 * 2. Updating package.json with V2-specific fields
 *
 * This script expects `npm run build:v2` to have been run first.
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

  pkg.name = "@jerome-benoit/sap-ai-provider-v2";
  pkg.description =
    "SAP AI Provider for Vercel AI SDK (LanguageModelV2/EmbeddingModelV2 interfaces)";

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("Updated package.json for V2");
}

prepareV2Package();
