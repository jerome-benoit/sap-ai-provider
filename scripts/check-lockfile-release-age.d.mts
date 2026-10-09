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
  init: { headers: { accept: string }; redirect: "error" },
) => Promise<PackumentResponse>;

export interface PackumentResponse {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
  url: string;
}

export const POLICY_BASE_SHA: string;

export function extractLockArtifacts(lockValue: unknown): LockArtifacts;
export function fetchPackagePackument(
  packageName: string,
  fetchImplementation?: PackumentFetch,
): Promise<Record<string, unknown>>;
export function findAllLockArtifacts(lockValue: unknown): LockArtifact[];
export function findNewLockArtifacts(baseLock: unknown, currentLock: unknown): LockArtifact[];
export function inferPackageName(path: string, entry: Record<string, unknown>): string;
export function loadLockfiles(
  mode: LockfileReleaseAgeMode,
  readCurrentLock?: () => string,
  readLockfile?: (lockfilePath: string) => string,
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
