import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";

import type { TaskSpec } from "./types.js";

import {
  execFileAsync,
  GIT_TIMEOUT_MS,
  MAX_TITLE_LENGTH,
  PLANNER_MODEL,
  TASK_TIMEOUT_MS,
  toErrorMessage,
} from "./constants.js";

const RawIssueSchema = z.object({
  body: z
    .string()
    .nullable()
    .transform((b) => b ?? ""),
  labels: z.array(z.object({ name: z.string() })),
  number: z.number(),
  title: z.string(),
});
const RawIssuesSchema = z.array(RawIssueSchema);

/** Configuration for the GitHub issue task source. */
export interface GithubIssueSourceConfig {
  /** Git branch prefix for issue branches. */
  branchPrefix: string;
  /** Docker image name for the sandbox. */
  dockerImage: string;
  /** GitHub issue label to filter by. */
  label: string;
  /** Maximum planner retries. */
  maxRetries?: number;
}

/** Interface for task discovery sources. */
export interface TaskSource {
  /** Discovers tasks to work on. */
  discover(): Promise<TaskSpec[]>;
}

/**
 * Task source that discovers work from GitHub issues via planner agent.
 */
export class GithubIssueSource implements TaskSource {
  private readonly branchPattern: RegExp;
  private readonly branchPrefix: string;
  private readonly dockerImage: string;
  private readonly label: string;
  private readonly maxRetries: number;

  /**
   * @param config - Configuration for the GitHub issue source.
   */
  constructor(config: GithubIssueSourceConfig) {
    this.branchPrefix = config.branchPrefix;
    this.dockerImage = config.dockerImage;
    this.label = config.label;
    this.maxRetries = config.maxRetries ?? 5;

    const escapedPrefix = this.branchPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    this.branchPattern = new RegExp(`^${escapedPrefix}-\\d+-[\\w-]+$`);
  }

  /**
   * Discovers tasks by fetching GitHub issues, running the planner, and validating the plan.
   * @returns Array of task specifications to implement.
   */
  async discover(): Promise<TaskSpec[]> {
    const issuesJson = await this.fetchAndSanitizeIssues();

    if (issuesJson.length === 0) {
      console.log("No issues with label '%s'. Exiting.", this.label);
      return [];
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      console.log(`\n=== Planner attempt ${String(attempt)}/${String(this.maxRetries)} ===\n`);

      const planPromise = sandcastle.run({
        agent: sandcastle.opencode(PLANNER_MODEL),
        maxIterations: 1,
        name: "Planner",
        promptArgs: {
          BRANCH_PREFIX: this.branchPrefix,
          ISSUES_JSON: JSON.stringify(issuesJson, null, 2),
        },
        promptFile: "./.sandcastle/plan-prompt.md",
        sandbox: docker({ imageName: this.dockerImage }),
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Planner timed out"));
        }, TASK_TIMEOUT_MS).unref();
      });
      timeoutPromise.catch(() => {
        /* suppress unhandled rejection when planner completes before timeout */
      });
      const plan = await Promise.race([planPromise, timeoutPromise]);

      const planMatches = [...plan.stdout.matchAll(/<plan>([\s\S]*?)<\/plan>/g)];
      const planMatch = planMatches.at(-1);
      if (!planMatch) {
        console.error("Planner did not produce a <plan> tag. Retrying.");
        continue;
      }

      const planContent = planMatch[1] ?? "";
      const tasks = this.validatePlan(planContent, issuesJson);
      if (tasks === null) {
        continue;
      }

      if (tasks.length === 0) {
        console.log("No actionable issues. Exiting.");
        return [];
      }

      console.log(`Plan: ${String(tasks.length)} issue(s) to work on:`);
      for (const task of tasks) {
        console.log(`  #${task.id}: ${task.title} → ${task.branch}`);
      }

      return tasks;
    }

    console.warn("Planner failed to produce a valid plan after all retries.");
    process.exitCode = 1;
    return [];
  }

  private async fetchAndSanitizeIssues(): Promise<
    {
      body: string;
      labels: string[];
      number: number;
      title: string;
    }[]
  > {
    let rawIssuesJson: string;
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "issue",
          "list",
          "--state",
          "open",
          "--json",
          "number,title,labels,body",
          "--limit",
          "50",
          "--label",
          this.label,
        ],
        { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      );
      rawIssuesJson = stdout;
    } catch (err) {
      console.error(
        `Failed to fetch issues: ${toErrorMessage(err)}. Ensure gh is installed and authenticated.`,
      );
      process.exit(1);
    }

    let rawIssues: z.infer<typeof RawIssuesSchema>;
    try {
      rawIssues = RawIssuesSchema.parse(JSON.parse(rawIssuesJson));
    } catch (err) {
      console.error(
        `Failed to parse issues JSON: ${toErrorMessage(err)}. Unexpected format from gh CLI.`,
      );
      process.exit(1);
    }

    return rawIssues.map((issue) => ({
      body: sanitizeForPrompt(issue.body),
      labels: issue.labels.map((label) => label.name),
      number: issue.number,
      title: sanitizeForPrompt(issue.title),
    }));
  }

  private validatePlan(
    planContent: string,
    issuesJson: { body: string; labels: string[]; number: number; title: string }[],
  ): null | TaskSpec[] {
    try {
      const parsed = JSON.parse(planContent) as { issues: unknown[] };
      if (!Array.isArray(parsed.issues)) {
        console.error("Planner output missing issues array. Retrying.");
        return null;
      }
      const validated = parsed.issues.filter(
        (entry): entry is { branch: string; id: string; title: string } => {
          if (typeof entry !== "object" || entry === null) return false;
          const item = entry as Record<string, unknown>;
          if (typeof item.id !== "string" || !/^\d+$/.test(item.id)) return false;
          if (typeof item.branch !== "string" || !this.branchPattern.test(item.branch))
            return false;
          if (typeof item.title !== "string") return false;
          if (item.title.length > MAX_TITLE_LENGTH) return false;
          // eslint-disable-next-line no-control-regex
          if (/[\x00-\x1f]/.test(item.title)) return false;
          return true;
        },
      );

      const issueMap = new Map(issuesJson.map((issue) => [String(issue.number), issue]));
      return validated
        .map((entry) => {
          const source = issueMap.get(entry.id);
          if (!source) return null;
          return {
            ...entry,
            body: source.body,
            labels: source.labels,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    } catch (err) {
      console.error(`Planner produced invalid JSON: ${toErrorMessage(err)}. Retrying.`);
      return null;
    }
  }
}

/**
 * Strips agent-control tags from text to reduce prompt-injection risk.
 * @param text - Raw text to sanitize.
 * @returns Text with plan/findings/promise tags removed.
 */
function sanitizeForPrompt(text: string): string {
  const normalized = text.normalize("NFKC");
  return normalized.replace(
    /<\/?(?:plan|findings|promise|system|code|instructions|implement|review|tool_call)[^>]*>/gi,
    "",
  );
}
