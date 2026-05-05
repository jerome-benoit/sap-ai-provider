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

/** Zod schema for an array of critic findings. */
export const FindingsSchema = z.array(FindingSchema);

/** Result of post-loop finalization. */
export interface FinalizeResult {
  /** Whether the PR was marked as draft. */
  isDraft: boolean;
  /** Whether a PR was successfully created. */
  prCreated: boolean;
  /** Whether validation passed. */
  validationPassed: boolean;
}

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

/** Maximum implement↔critic rounds before giving up. */
export const MAX_CRITIC_ROUNDS = 5;

/** Token budget per round (decreasing). Index = round - 1. */
export const ITERATION_BUDGET = [100, 50, 25, 10, 10] as const;

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
