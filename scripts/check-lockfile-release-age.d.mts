export interface LockArtifact {
  inBundle: boolean;
  integrity: string;
  name: string;
  resolved: null | string;
  version: string;
}

export interface LockArtifacts {
  artifacts: LockArtifact[];
  remoteSources: LockArtifact[];
}

export type LockfileReleaseAgeMode =
  | {
      baseLockfilePath: string;
      headLockfilePath: string;
      mode: "trusted-files";
    }
  | { baseSha: string; mode: "differential" | "policy" }
  | { mode: "all" };

export type PackumentFetch = (
  input: URL,
  init: { headers: { accept: string }; redirect: "error"; signal: AbortSignal },
) => Promise<PackumentResponse>;

export interface PackumentResponse {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
  url: string;
}

/** Maximum number of unique registry artifacts accepted from one selection. */
export const MAXIMUM_ATTESTED_ARTIFACTS: number;
/** Maximum UTF-8 byte size accepted for every package-lock.json input. */
export const MAXIMUM_LOCKFILE_BYTES: number;
export const POLICY_BASE_SHA: string;

export function extractLockArtifacts(lockValue: unknown): LockArtifacts;
export function fetchPackagePackument(
  packageName: string,
  fetchImplementation?: PackumentFetch,
  externalSignal?: AbortSignal,
): Promise<Record<string, unknown>>;
export function findAllLockArtifacts(lockValue: unknown): LockArtifact[];
export function findNewLockArtifacts(baseLock: unknown, currentLock: unknown): LockArtifact[];
export function inferPackageName(path: string, entry: Record<string, unknown>): string;
export function loadLockfiles(
  mode: LockfileReleaseAgeMode,
  readCurrentLock?: () => string,
  readLockfile?: (lockfilePath: string, description: string) => string,
  showGitObject?: (objectName: string) => string,
): { baseLock?: unknown; currentLock: unknown };
export function parseCliArguments(args: string[]): LockfileReleaseAgeMode;
export function selectLockArtifacts(
  mode: LockfileReleaseAgeMode,
  currentLock: unknown,
  baseLock?: unknown,
): LockArtifact[];
export function validateArtifactMetadata(
  artifact: LockArtifact,
  packument: unknown,
  minimumAgeDays: number,
  nowMs: number,
): void;
export function validateArtifactsConcurrently(
  artifacts: LockArtifact[],
  minimumAgeDays: number,
  nowMs: number,
  fetchImplementation?: PackumentFetch,
): Promise<void>;
export function validateMinimumReleaseAge(configuredAge: unknown): number;
