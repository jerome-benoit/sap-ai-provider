export interface LockArtifact {
  integrity: string;
  name: string;
  resolved: null | string;
  version: string;
}

export interface LockArtifacts {
  artifacts: LockArtifact[];
  remoteSources: LockArtifact[];
}

export function extractLockArtifacts(lockValue: unknown): LockArtifacts;
export function findNewLockArtifacts(baseLock: unknown, currentLock: unknown): LockArtifact[];
export function inferPackageName(path: string, entry: Record<string, unknown>): string;
export function validateArtifactMetadata(
  artifact: LockArtifact,
  metadata: unknown,
  minimumAgeDays: number,
  nowMs: number,
): void;
export function validateMinimumReleaseAge(configuredAge: unknown): number;
