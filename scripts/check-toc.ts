import type { Token } from "markdown-it";

/** Validates Markdown tables of contents against rendered headings and list structure. */
import GithubSlugger from "github-slugger";
import MarkdownIt from "markdown-it";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Result of validating one document. */
export interface ValidationResult {
  errors: string[];
  skipped: boolean;
  valid: boolean;
}

interface Heading {
  level: number;
  slug: string;
  text: string;
}

interface HeadingNode {
  children: HeadingNode[];
  heading: Heading;
}

interface TocEntry {
  slug: string;
  text: string;
}

const markdown = new MarkdownIt({ html: true });

/**
 * Validate specified files, or Markdown files in the current directory by default.
 * @param args - File paths
 * @returns Nonzero when any document fails validation or cannot be read
 */
export function run(args: string[]): number {
  const files = args.length > 0 ? args : readdirSync(".").filter((file) => file.endsWith(".md"));
  let hasErrors = false;
  let checkedCount = 0;
  let skippedCount = 0;
  for (const file of files) {
    try {
      const result = validateToc(file);
      if (result.skipped) {
        skippedCount++;
        continue;
      }
      checkedCount++;
      if (!result.valid) {
        hasErrors = true;
        console.error(`FAIL ${file}`);
        for (const error of result.errors) console.error(`  - ${error}`);
      } else console.log(`OK ${file}`);
    } catch (error) {
      console.error(`FAIL ${file}: ${error instanceof Error ? error.message : String(error)}`);
      hasErrors = true;
    }
  }
  console.log(`Checked ${String(checkedCount)} file(s), skipped ${String(skippedCount)} (no ToC)`);
  return hasErrors ? 1 : 0;
}

/**
 * Validate a Markdown file.
 * @param filePath - Path to the document
 * @returns Validation result
 */
export function validateToc(filePath: string): ValidationResult {
  return validateTocContent(readFileSync(filePath, "utf-8"));
}

/**
 * Validate heading anchors, mandatory h2 coverage and expanded sibling coverage.
 * @param content - Markdown document
 * @returns Validation result; documents without a level-two ToC are skipped
 */
export function validateTocContent(content: string): ValidationResult {
  const { entries, hasToc, headings, parents } = extractDocument(markdown.parse(content, {}));
  if (!hasToc) return { errors: [], skipped: true, valid: true };

  const errors: string[] = [];
  const validSlugs = new Set(headings.map((heading) => heading.slug));
  const tocSlugs = new Set(entries.map((entry) => entry.slug));
  for (const entry of entries) {
    if (!validSlugs.has(entry.slug)) {
      errors.push(`ToC link "#${entry.slug}" (${entry.text}) has no matching heading`);
    }
  }
  for (const heading of headings) {
    if (heading.level === 2 && !tocSlugs.has(heading.slug)) {
      errors.push(`Heading "${heading.text}" (h2) is not in ToC`);
    }
  }
  errors.push(...findInconsistentSiblings(buildHeadingTree(headings), tocSlugs, parents));
  return { errors, skipped: false, valid: errors.length === 0 };
}

/**
 * Nest headings under their preceding nearest lower-level heading.
 * @param headings - Headings in document order
 * @returns Heading forest
 */
function buildHeadingTree(headings: Heading[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const heading of headings) {
    const node: HeadingNode = { children: [], heading };
    while (stack.length > 0) {
      const top = stack.at(-1);
      if (top === undefined || top.heading.level < heading.level) break;
      stack.pop();
    }
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/**
 * Collect headings and the first level-two ToC in one parsed document.
 * @param tokens - Block Markdown tokens
 * @returns Headings, ToC entries and explicit list parents
 */
function extractDocument(tokens: Token[]): {
  entries: TocEntry[];
  hasToc: boolean;
  headings: Heading[];
  parents: Set<string>;
} {
  const headings: Heading[] = [];
  const entries: TocEntry[] = [];
  const parents = new Set<string>();
  const slugger = new GithubSlugger();
  const listItems: string[][] = [];
  let hasToc = false;
  let inToc = false;

  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open") {
      const level = Number(token.tag.slice(1));
      const text = inlineText(tokens[index + 1]?.children ?? []);
      const slug = slugger.slug(text);
      const isToc = level === 2 && text.toLowerCase() === "table of contents";
      if (level <= 2) {
        inToc = isToc && !hasToc;
        if (inToc) hasToc = true;
        listItems.length = 0;
      }
      if (!isToc) headings.push({ level, slug, text });
      continue;
    }
    if (!inToc) continue;
    if (token.type === "list_item_open") listItems.push([]);
    else if (token.type === "list_item_close") listItems.pop();
    else if (token.type === "inline") {
      const children = token.children ?? [];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const href = child?.type === "link_open" ? child.attrGet("href") : null;
        if (typeof href !== "string" || !href.startsWith("#")) continue;
        let slug = href.slice(1);
        try {
          slug = decodeURIComponent(slug);
        } catch {
          // Keep malformed fragments so validation reports a broken link.
        }
        const start = ++index;
        while (index < children.length && children[index]?.type !== "link_close") index++;
        entries.push({ slug, text: inlineText(children.slice(start, index)) });
        listItems.at(-1)?.push(slug);
        for (const parent of listItems.at(-2) ?? []) parents.add(parent);
      }
    }
  }
  return { entries, hasToc, headings, parents };
}

/**
 * Expanded ToC parents require consistent coverage among same-level siblings.
 * @param roots - Document heading forest
 * @param tocSlugs - Listed heading anchors
 * @param parents - ToC entries with actual nested list entries
 * @returns Diagnostics for omitted siblings
 */
function findInconsistentSiblings(
  roots: HeadingNode[],
  tocSlugs: Set<string>,
  parents: Set<string>,
): string[] {
  const errors: string[] = [];

  /**
   * @param parent - Parent heading, if any
   * @param children - Siblings in one heading subtree
   */
  function check(parent: HeadingNode | undefined, children: HeadingNode[]): void {
    if (!parent || parents.has(parent.heading.slug)) {
      const byLevel = new Map<number, HeadingNode[]>();
      for (const child of children) {
        const level = child.heading.level;
        if (level <= 2) continue;
        const group = byLevel.get(level);
        if (group) group.push(child);
        else byLevel.set(level, [child]);
      }
      for (const [level, siblings] of byLevel) {
        if (!siblings.some((sibling) => tocSlugs.has(sibling.heading.slug))) continue;
        for (const sibling of siblings) {
          if (!tocSlugs.has(sibling.heading.slug)) {
            errors.push(
              `Heading "${sibling.heading.text}" (h${String(level)}) not in ToC, ` +
                `but sibling(s) under "${parent?.heading.text ?? "document root"}" are listed`,
            );
          }
        }
      }
    }
    for (const child of children) check(child, child.children);
  }

  check(undefined, roots);
  return errors;
}

/**
 * Extract rendered text; markup, HTML tags and image alt attributes are not text nodes.
 * @param tokens - Inline Markdown tokens
 * @returns Text used for GitHub heading anchors and diagnostics
 */
function inlineText(tokens: Token[]): string {
  let text = "";
  for (const token of tokens) {
    if (token.type === "text" || token.type === "code_inline") text += token.content;
    else if (token.type === "softbreak" || token.type === "hardbreak") text += "\n";
  }
  return text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
