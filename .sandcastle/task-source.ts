import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { z } from "zod";

import type { TaskSpec } from "./types.js";

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
    const issuesJson = this.fetchAndSanitizeIssues();

    if (issuesJson.length === 0) {
      console.log("No issues with label '%s'. Exiting.", this.label);
      return [];
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      console.log(`\n=== Planner attempt ${String(attempt)}/${String(this.maxRetries)} ===\n`);

      const plan = await sandcastle.run({
        agent: sandcastle.opencode("github-copilot/claude-opus-4.6"),
        maxIterations: 1,
        name: "Planner",
        promptArgs: {
          BRANCH_PREFIX: this.branchPrefix,
          ISSUES_JSON: JSON.stringify(issuesJson, null, 2),
        },
        promptFile: "./.sandcastle/plan-prompt.md",
        sandbox: docker({ imageName: this.dockerImage }),
      });

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

    return [];
  }

  private fetchAndSanitizeIssues(): {
    body: string;
    labels: string[];
    number: number;
    title: string;
  }[] {
    let rawIssuesJson: string;
    try {
      rawIssuesJson = execFileSync(
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
        { encoding: "utf-8" },
      );
    } catch {
      console.error("Failed to fetch issues. Ensure gh is installed and authenticated.");
      process.exit(1);
    }

    let rawIssues: z.infer<typeof RawIssuesSchema>;
    try {
      rawIssues = RawIssuesSchema.parse(JSON.parse(rawIssuesJson));
    } catch {
      console.error("Failed to parse issues JSON. Unexpected format from gh CLI.");
      process.exit(1);
    }

    return rawIssues.map((i) => ({
      body: sanitizeForPrompt(i.body),
      labels: i.labels.map((l) => l.name),
      number: i.number,
      title: sanitizeForPrompt(i.title),
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
        (entry): entry is { body: string; branch: string; id: string; title: string } => {
          if (typeof entry !== "object" || entry === null) return false;
          const item = entry as Record<string, unknown>;
          if (typeof item.id !== "string" || !/^\d+$/.test(item.id)) return false;
          if (typeof item.branch !== "string" || !this.branchPattern.test(item.branch))
            return false;
          if (typeof item.title !== "string") return false;
          return true;
        },
      );

      return validated.map((v) => ({
        ...v,
        body: issuesJson.find((i) => String(i.number) === v.id)?.body ?? "",
        labels: issuesJson.find((i) => String(i.number) === v.id)?.labels ?? [],
      }));
    } catch {
      console.error("Planner produced invalid JSON. Retrying.");
      return null;
    }
  }
}

/**
 * Strips injection-prone tags from text.
 * @param text - Raw text to sanitize.
 * @returns Sanitized text safe for prompt injection.
 */
function sanitizeForPrompt(text: string): string {
  return text.replace(/<\/?(?:plan|findings[\w-]*|promise)[^>]*>/gi, "");
}
