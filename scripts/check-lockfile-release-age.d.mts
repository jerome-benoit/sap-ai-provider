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
  { baseSha: string; mode: "differential" | "policy" } | { mode: "all" };

export const POLICY_BASE_SHA: string;

export function extractLockArtifacts(lockValue: unknown): LockArtifacts;
export function findAllLockArtifacts(lockValue: unknown): LockArtifact[];
export function findNewLockArtifacts(baseLock: unknown, currentLock: unknown): LockArtifact[];
export function inferPackageName(path: string, entry: Record<string, unknown>): string;
export function parseCliArguments(args: string[]): LockfileReleaseAgeMode;
export function selectLockArtifacts(
  mode: LockfileReleaseAgeMode,
  currentLock: unknown,
  baseLock?: unknown,
): LockArtifact[];
export function validateArtifactMetadata(
  artifact: LockArtifact,
  metadata: unknown,
  minimumAgeDays: number,
  nowMs: number,
): void;
export function validateMinimumReleaseAge(configuredAge: unknown): number;
