import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, "dist");

const V2_OVERRIDES = {
  additionalKeywords: ["v2", "LanguageModelV2", "EmbeddingModelV2"],
  description: "SAP AI Provider for Vercel AI SDK (LanguageModelV2/EmbeddingModelV2 interfaces)",
  name: "@jerome-benoit/sap-ai-provider-v2",
} as const;

interface PackageJson {
  [key: string]: unknown;
  description: string;
  keywords: string[];
  name: string;
}

interface PackageLockJson {
  name: string;
  packages: { "": { name: string } };
}

/** Prepares V2 package for publishing. */
function main(): void {
  renameDistFiles();
  updatePackageJson();
  updatePackageLockJson();
}

/**
 * Parses JSON file.
 * @template T - Expected type.
 * @param path - File path.
 * @returns Parsed content.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/** Renames `index-v2.*` to `index.*` in dist. */
function renameDistFiles(): void {
  for (const file of readdirSync(DIST)) {
    if (file.startsWith("index-v2")) {
      const newName = file.replace("index-v2", "index");
      renameSync(resolve(DIST, file), resolve(DIST, newName));
      console.log(`Renamed ${file} -> ${newName}`);
    }
  }
}

/** Patches package.json for V2. */
function updatePackageJson(): void {
  const pkgPath = resolve(ROOT, "package.json");
  const pkg = readJson<PackageJson>(pkgPath);

  pkg.name = V2_OVERRIDES.name;
  pkg.description = V2_OVERRIDES.description;
  pkg.keywords = [...pkg.keywords, ...V2_OVERRIDES.additionalKeywords];

  writeJson(pkgPath, pkg);
  console.log("Updated package.json for V2");
}

/** Patches package-lock.json for V2. */
function updatePackageLockJson(): void {
  const lockPath = resolve(ROOT, "package-lock.json");
  if (!existsSync(lockPath)) {
    return;
  }

  const lock = readJson<PackageLockJson>(lockPath);

  lock.name = V2_OVERRIDES.name;
  lock.packages[""].name = V2_OVERRIDES.name;

  writeJson(lockPath, lock);
  console.log("Updated package-lock.json for V2");
}

/**
 * Writes JSON file with formatting.
 * @template T - Data type.
 * @param path - File path.
 * @param data - Content to write.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function writeJson<T>(path: string, data: T): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

main();
