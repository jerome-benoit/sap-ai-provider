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

/**
 * Reads and parses a JSON file.
 * @param path - Absolute path to the JSON file.
 * @returns The parsed JSON content.
 */
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 *
 */
function renameDistFiles(): void {
  for (const file of readdirSync(DIST)) {
    if (file.startsWith("index-v2")) {
      const newName = file.replace("index-v2", "index");
      renameSync(resolve(DIST, file), resolve(DIST, newName));
      console.log(`Renamed ${file} -> ${newName}`);
    }
  }
}

/**
 *
 */
function updatePackageJson(): void {
  const pkgPath = resolve(ROOT, "package.json");
  const pkg = readJson(pkgPath) as PackageJson;

  pkg.name = V2_OVERRIDES.name;
  pkg.description = V2_OVERRIDES.description;
  pkg.keywords = [...pkg.keywords, ...V2_OVERRIDES.additionalKeywords];

  writeJson(pkgPath, pkg);
  console.log("Updated package.json for V2");
}

/**
 *
 */
function updatePackageLockJson(): void {
  const lockPath = resolve(ROOT, "package-lock.json");
  if (!existsSync(lockPath)) {
    return;
  }

  const lock = readJson(lockPath) as PackageLockJson;

  lock.name = V2_OVERRIDES.name;
  lock.packages[""].name = V2_OVERRIDES.name;

  writeJson(lockPath, lock);
  console.log("Updated package-lock.json for V2");
}

/**
 * Writes data to a JSON file with pretty formatting.
 * @param path - Absolute path to the JSON file.
 * @param data - Data to serialize and write.
 */
function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

renameDistFiles();
updatePackageJson();
updatePackageLockJson();
