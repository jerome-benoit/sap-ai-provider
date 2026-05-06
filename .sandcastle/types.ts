import type * as sandcastle from "@ai-hero/sandcastle";

import { z } from "zod";

/** Zod schema for a single critic finding. */
export const FindingSchema = z.object({
  category: z.enum(["security", "logic", "performance", "architecture", "style"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  description: z.string(),
  file: z.string(),
  line: z.number().optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  suggestion: z.string().optional(),
  title: z.string(),
});

/** A single critic finding parsed from agent output. */
export type Finding = z.infer<typeof FindingSchema>;

/** Result returned by the refinement loop. */
export interface LoopResult {
  /** Outstanding findings from the last round. */
  lastFindings: Finding[];
  /** Number of rounds completed. */
  roundsCompleted: number;
  /** Termination status. */
  status: LoopStatus;
  /** Total commits produced across all rounds. */
  totalCommits: number;
}

/** Outcome status of the refinement loop. */
export type LoopStatus = "converged" | "exhausted" | "failed" | "skipped";

/** Type alias for a sandcastle sandbox instance. */
export type SandboxInstance = Awaited<ReturnType<typeof sandcastle.createSandbox>>;

/**
 * Configuration for a refinement loop strategy.
 * Defines prompts, argument builders, convergence, and finalization.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type StrategyConfig = {
  /** Path to the actor (implementer) prompt file. */
  actorPromptFile: string;
  /** Builds promptArgs for the actor run from task spec and previous findings. */
  buildActorArgs: (spec: TaskSpec, findings: Finding[]) => Record<string, string>;
  /** Builds promptArgs for the critic run from task spec and nonce. */
  buildCriticArgs: (spec: TaskSpec, nonce: string) => Record<string, string>;
  /** Path to the critic prompt file. */
  criticPromptFile: string;
  /** Finalizes the task after the loop completes. Returns success indicator. */
  finalize: (
    spec: TaskSpec,
    loopResult: LoopResult,
    sandbox: SandboxInstance,
    cwd: string,
  ) => Promise<{ success: boolean }>;
  /** Determines if the finalization result counts as completed work. */
  isWorkComplete: (finalizeResult: { success: boolean }) => boolean;
  /** Optional custom convergence check. When omitted, default loop logic applies. */
  shouldConverge?: (findings: Finding[], round: number, totalCommits: number) => boolean;
};

/** Specification for a task to be implemented. */
export interface TaskSpec {
  /** Sanitized issue body text. */
  body: string;
  /** Git branch name for this task. */
  branch: string;
  /** Task identifier (e.g. GitHub issue number as string). */
  id: string;
  /** Label names associated with the task. */
  labels: string[];
  /** Task title. */
  title: string;
}

/**
 * Parses a findings array with partial recovery — invalid entries are discarded.
 * @param data - Raw parsed JSON value to validate as a findings array.
 * @returns Array of valid findings (may be empty).
 */
export function parseFindingsSafe(data: unknown): Finding[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => FindingSchema.safeParse(entry))
    .filter((r): r is z.ZodSafeParseSuccess<Finding> => r.success)
    .map((r) => r.data);
}
